import type { AuditArea, Claim, ClaimAudit, Finding, ServiceLine, Severity } from './types';
import { checkIndication, suggestIndications, type DrugMatch, type Formulary } from './formulary';
import { SERVICE_RULES, NON_COVERED_ICDS, type ServiceRule } from './kb/services';
import { AGE_RULES, DRUG_DISEASE, INTERACTIONS, NON_DRUG_ITEMS, PREGNANCY_AVOID, classesOf, isInjectable, isTopical, type DrugClass } from './kb/drugs';
import { EXCLUDES, INTEGRAL_SYMPTOMS, ageConflict, isExternalCause, isHeaderOnly, isInjury, sexConflict, FEVER_ICD, DEHYDRATION_ICD, HYPOTENSION_ICD } from './kb/icd';
import { TERMS, has, mention, snippet } from './text';

/** Approximate likelihood (%) that a finding of this severity alone triggers a rejection. */
export const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 55, high: 25, medium: 8, low: 2 };
export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

const starts = (code: string, prefixes: string[]) => prefixes.some((p) => code.startsWith(p));
const anyIcd = (icds: string[], prefixes: string[]) => icds.some((c) => starts(c, prefixes));
const lineAmount = (l: ServiceLine) => (l.net > 0 ? l.net : l.billed);

export const isDrugLine = (l: ServiceLine) => /medic|pharm|drug|inventory/i.test(l.category);
export const isConsultLine = (l: ServiceLine) => /consult|assessment|visit|supervision/i.test(l.category + ' ' + l.desc) && !/medic/i.test(l.category);
const isDentalClaim = (c: Claim) => /dent/i.test(c.specialty) || c.diagnoses.some((d) => /^K0[0-8]/.test(d.code));

function rulesForLine(l: ServiceLine): ServiceRule[] {
  const cat = l.category.toLowerCase();
  let pool = SERVICE_RULES;
  if (/lab/.test(cat)) pool = SERVICE_RULES.filter((r) => r.id.startsWith('LAB'));
  else if (/radio|imag|x-?ray/.test(cat)) pool = SERVICE_RULES.filter((r) => r.id.startsWith('RAD'));
  else if (/proced|operat|dental|surg|nurs|therap/.test(cat)) pool = SERVICE_RULES.filter((r) => r.id.startsWith('PRC') || r.id.startsWith('DEN') || r.id === 'RAD-DENTAL');
  else if (/medic|pharm|drug|consult|inventory|accommod|supervis/.test(cat)) return [];
  const hits = pool.filter((r) => r.match.test(l.desc));
  // Prefer the most specific site rule but always keep the MRI/CT pre-authorisation rule.
  const mri = hits.find((r) => r.id === 'RAD-MRI-CT');
  const others = hits.filter((r) => r.id !== 'RAD-MRI-CT');
  return [...(others.length ? [others[0]] : []), ...(mri ? [mri] : [])];
}

/** Paediatric-aware normal ranges (PALS). */
function hrRange(age: number | null): [number, number] {
  if (age === null || age >= 12) return [50, 100];
  if (age < 1) return [100, 160];
  if (age < 3) return [90, 150];
  if (age < 6) return [80, 140];
  return [70, 120];
}
function rrRange(age: number | null): [number, number] {
  if (age === null || age >= 12) return [10, 22];
  if (age < 1) return [30, 60];
  if (age < 3) return [24, 40];
  if (age < 6) return [22, 34];
  return [18, 30];
}

/** Age restrictions parsed from CHI DDF "AGE" edit notes. */
function ddfAgeLimit(m: DrugMatch): { min?: number; max?: number; note: string } | null {
  const rows = m.ingredient?.i ?? [];
  if (!rows.some((r) => /AGE/.test(r[2]))) return null;
  const note = (m.ingredient.notes.find((n) => /AGE/.test(n)) ?? '').toUpperCase();
  if (!note) return null;
  const neg = /AVOID|NOT RECOMMENDED|CONTRAINDICATED|NOT APPROVED|SHOULD NOT|NOT INDICATED|NOT BE USED|NOT USED/.test(note);
  const res: { min?: number; max?: number; note: string } = { note };
  const lt = note.match(/(?:LESS THAN|UNDER|BELOW|YOUNGER THAN|<)\s*(\d+)\s*(YEARS?|YRS?|MONTHS?)/);
  if (lt && neg) res.min = /MONTH/.test(lt[2]) ? +lt[1] / 12 : +lt[1];
  else if (/AVOID[^.]{0,30}PEDIATRIC|NOT[^.]{0,30}PEDIATRIC|USED IN ADULTS|ADULTS ONLY|FOR ADULTS/.test(note)) res.min = 18;
  if (/65 YEARS AND OLDER|OLDER ADULTS|ELDERLY/.test(note) && neg) res.max = 65;
  return res.min !== undefined || res.max !== undefined ? res : null;
}

interface Builder {
  add(f: Omit<Finding, 'id' | 'amountAtRisk'> & { amountAtRisk?: number }): void;
}

export function auditClaim(claim: Claim, formulary: Formulary | null, history: Claim[] = []): ClaimAudit {
  const findings: Finding[] = [];
  const lineById = new Map(claim.lines.map((l) => [l.id, l]));
  const b: Builder = {
    add(f) {
      const amt = f.amountAtRisk ?? (f.lineIds ?? []).reduce((s, id) => s + (lineById.get(id) ? lineAmount(lineById.get(id)!) : 0), 0);
      findings.push({ ...f, id: `${claim.id}-${findings.length + 1}`, amountAtRisk: Math.round(amt * 100) / 100 });
    },
  };
  const icds = claim.diagnoses.map((d) => d.code);
  const text = [claim.history, claim.examination, claim.plan].filter(Boolean).join(' . ');
  const age = claim.ageYears;
  const isFemale = claim.gender === 'F';
  const pregnant = isFemale && (anyIcd(icds, ['O', 'Z34', 'Z33', 'Z3A', 'Z36']) || has(text, TERMS.pregnant));
  const total = claim.lines.reduce((s, l) => s + lineAmount(l), 0);

  // ─────────────── ICD coding quality ───────────────
  if (icds.length === 0) {
    b.add({ ruleId: 'COD-001', area: 'ICD coding quality', severity: 'critical', title: 'No diagnosis code on the claim', detail: 'The claim has no ICD-10 code. NPHIES rejects every service line without a principal diagnosis.', fix: 'Add the principal diagnosis (ICD-10-AM) that explains the visit and every billed service.', amountAtRisk: total, refs: ['NPHIES claim validation', 'ACS 0001 Principal diagnosis'] });
  }
  for (const d of claim.diagnoses) {
    const sc = sexConflict(d.code, claim.gender);
    if (sc) b.add({ ruleId: 'COD-002', area: 'ICD coding quality', severity: 'critical', title: `Gender conflict: ${d.code} is ${sc}`, detail: `${d.code} ${d.desc} is a ${sc} code but the patient is ${claim.gender === 'M' ? 'male' : 'female'}.`, fix: 'Correct the diagnosis code or the patient gender in the registration.', amountAtRisk: total, refs: ['WHO ICD-10 Vol. 2 sex edits', 'NPHIES BE (invalid diagnosis for gender)'] });
    const ac = ageConflict(d.code, age);
    if (ac) b.add({ ruleId: 'COD-003', area: 'ICD coding quality', severity: 'high', title: `Age conflict: ${d.code}`, detail: `${ac} Patient age: ${claim.ageText || 'unknown'}.`, fix: 'Verify the code against the patient age; use the age-appropriate code.', refs: ['WHO ICD-10 Vol. 2 age edits'] });
    if (isHeaderOnly(d.code)) b.add({ ruleId: 'COD-004', area: 'ICD coding quality', severity: 'high', title: `Incomplete code ${d.code} (category header)`, detail: `${d.code} has mandatory 4th/5th characters in ICD-10-AM. Header codes fail NPHIES code validation and are read as "unspecified".`, fix: `Code to the highest specificity (e.g. ${d.code}.0–${d.code}.9 with laterality/site where applicable).`, amountAtRisk: total * 0.5, refs: ['ICD-10-AM Tabular List', 'NPHIES code-set validation'] });
    for (const nc of NON_COVERED_ICDS) {
      if (d.code.startsWith(nc.prefix)) b.add({ ruleId: 'COD-007', area: 'ICD coding quality', severity: nc.severity, title: `Non-covered / non-specific diagnosis: ${d.code} (${nc.label})`, detail: nc.why, fix: 'If a medical condition was treated, code that condition as principal diagnosis; otherwise bill as cash/self-pay.', amountAtRisk: nc.severity === 'critical' ? total : 0, refs: ['CHI Unified Health Insurance Policy – exclusions'] });
    }
  }
  for (const ex of EXCLUDES) {
    if (anyIcd(icds, [ex.a]) && anyIcd(icds, [ex.b])) b.add({ ruleId: 'COD-005', area: 'ICD coding quality', severity: 'medium', title: `Mutually exclusive codes: ${ex.a} + ${ex.b}`, detail: ex.note, fix: 'Remove the less specific code (ICD-10 Excludes1).', refs: ['ICD-10 Excludes1 notes'] });
  }
  for (const s of INTEGRAL_SYMPTOMS) {
    const sym = icds.find((c) => c.startsWith(s.symptom));
    const def = icds.find((c) => starts(c, s.definitive));
    if (sym && def) b.add({ ruleId: 'COD-006', area: 'ICD coding quality', severity: 'low', title: `Symptom code ${sym} with definitive diagnosis ${def}`, detail: `${sym} is integral to ${def}. Symptom codes are added only when not routinely associated with the diagnosis or when they alone justify a service.`, fix: `Keep ${sym} only if it is the reason for a specific service (e.g. antipyretic, test); otherwise remove.`, refs: ['ACS 0001 / 0002'] });
  }
  if (pregnant) {
    const PREG_MAP: [string[], string, string][] = [
      [['N39.0', 'N30', 'N10', 'N11', 'N12'], 'O23.x (infections of genitourinary tract in pregnancy)', 'UTI'],
      [['D50', 'D51', 'D52', 'D53', 'D64'], 'O99.0x (anaemia complicating pregnancy)', 'anaemia'],
      [['I10', 'I11', 'I12', 'I13', 'I15'], 'O10.x (pre-existing hypertension in pregnancy) / O13 gestational hypertension', 'hypertension'],
      [['E10', 'E11', 'E13', 'E14'], 'O24.x (diabetes in pregnancy)', 'diabetes'],
      [['E03', 'E05', 'E06', 'E07'], 'O99.2x + the thyroid code', 'thyroid disease'],
      [['K21', 'K29', 'K30'], 'O99.6x (digestive disease complicating pregnancy) + the GI code', 'GI disease'],
      [['R10.2', 'R10.3', 'R10.4'], 'O26.8x (other specified pregnancy-related conditions) / O26.89 pain in pregnancy', 'abdominal pain'],
      [['R11'], 'O21.x (excessive vomiting in pregnancy)', 'vomiting'],
    ];
    for (const [pre, use, what] of PREG_MAP) {
      const hit = icds.filter((c) => starts(c, pre));
      if (hit.length && !anyIcd(icds, [use.slice(0, 3)])) b.add({ ruleId: 'COD-009', area: 'ICD coding quality', severity: 'high', title: `Pregnant patient: ${hit.join(', ')} should be coded to chapter 15`, detail: `In a pregnant patient ${what} is classified to the obstetric chapter (O-codes take precedence). Payers reject tests/drugs linked to a non-obstetric code when Z34/O codes are present.`, fix: `Use ${use} as the reason for the related services, keeping the specific code as additional detail where the classification instructs.`, refs: ['ICD-10-AM ACS 1500 (diagnoses in pregnancy)', 'WHO ICD-10 chapter XV note'] });
    }
  }
  if (icds.some(isInjury) && !icds.some(isExternalCause)) {
    b.add({ ruleId: 'COD-008', area: 'ICD coding quality', severity: 'medium', title: 'Injury code without external-cause code', detail: `Injury code(s) ${icds.filter(isInjury).join(', ')} present but no external cause (V01–Y98), place (Y92) or activity code.`, fix: 'Add the external cause (e.g. W01 fall on same level, W22 striking against object, X10 contact with hot liquid), place of occurrence and activity.', refs: ['ICD-10-AM ACS 2001 External cause', 'CHI injury documentation'] });
  }

  // ─────────────── Drugs ───────────────
  type DrugInfo = { line: ServiceLine; match: DrugMatch | null; name: string; classes: Set<DrugClass>; topical: boolean; injectable: boolean };
  const drugs: DrugInfo[] = [];
  for (const l of claim.lines.filter(isDrugLine)) {
    const match = formulary ? formulary.lookup(l.code, l.gtin, l.desc) : null;
    const name = `${match?.scientific ?? ''} ${l.desc}`;
    const topical = isTopical(l.desc, match?.route ?? '');
    const classes = classesOf(name);
    if (topical) for (const c of ['NSAID', 'ANTIBIOTIC', 'CORTICOSTEROID_SYS', 'MACROLIDE', 'QUINOLONE', 'TETRACYCLINE', 'BETALACTAM', 'QT_PROLONGING', 'SEROTONERGIC', 'ANTICOAGULANT', 'PARACETAMOL'] as DrugClass[]) classes.delete(c);
    drugs.push({ line: l, match, name, classes, topical, injectable: isInjectable(l.desc, match?.route ?? '', match?.form ?? '') });
  }

  for (const d of drugs) {
    const l = d.line;
    // Non-drug items
    const nd = NON_DRUG_ITEMS.find((x) => x.re.test(l.desc) || /^COSM/i.test(l.code));
    if (nd && !(nd.icdOk && anyIcd(icds, nd.icdOk))) {
      b.add({ ruleId: 'DDX-006', area: 'Drug ↔ Diagnosis', severity: nd.label.startsWith('Cosmetic') ? 'critical' : 'high', title: `${nd.label}: ${l.desc}`, detail: nd.why, fix: nd.icdOk ? `If medically indicated, add the supporting diagnosis (${nd.icdOk.slice(0, 4).join(', ')}…) and specialist prescription; otherwise sell as cash.` : 'Remove from the insurance claim (cash item).', lineIds: [l.id], refs: ['CHI Unified Policy – exclusions'] });
      continue;
    }
    if (!d.match) {
      if (formulary) b.add({ ruleId: 'DDX-003', area: 'Drug ↔ Diagnosis', severity: 'low', title: `Drug code not found in SFDA/CHI list: ${l.code}`, detail: `"${l.desc}" (code ${l.code}${l.gtin ? `, GTIN ${l.gtin}` : ''}) could not be matched to the SFDA registry in the CHI formulary snapshot, so indication checks could not run.`, fix: 'Verify the SFDA registration number / GTIN in the pharmacy master; NPHIES requires the SFDA code for medications.', lineIds: [l.id], amountAtRisk: 0, refs: ['NPHIES medication code-set (SFDA)'] });
      continue;
    }
    const chk = checkIndication(d.match.ingredient, icds);
    if (chk.listed && chk.matched.length === 0 && icds.length) {
      const sug = suggestIndications(d.match.ingredient, text);
      const approvedList = d.match.ingredient.i.slice(0, 8).map((r) => `${r[1]} (${r[0].split(',').slice(0, 3).join(', ')})`).join('; ');
      // Symptom-only coding (R-chapter) for symptomatic drugs is the commonest fixable cause: the DDF lists the
      // underlying condition (e.g. paracetamol for J02/J03/H66/K04), not the symptom alone.
      const symptomOnly = icds.every((c) => c.startsWith('R'));
      const vehicle = /sodium chloride|dextrose|water for/i.test(d.match.scientific) && drugs.some((o) => o !== d && o.injectable && !/sodium chloride|dextrose|ringer/i.test(o.name));
      b.add({
        ruleId: 'DDX-001', area: 'Drug ↔ Diagnosis', severity: symptomOnly || vehicle ? 'high' : 'critical',
        title: `${d.match.scientific} not indicated for ${icds.join(', ')}`,
        detail: `${l.desc} → ${d.match.scientific} (matched by ${d.match.matchedBy}). None of the claim diagnoses is an approved CHI formulary indication. Approved indications include: ${approvedList}${d.match.ingredient.i.length > 8 ? '…' : ''}.`,
        fix: (vehicle ? 'Used as diluent/vehicle: payers still check it against the diagnosis – code the condition requiring IV therapy (e.g. E86.0 dehydration, A09.0) or bill it inside the IV drug administration. ' : '') + (symptomOnly ? 'Only symptom codes (R-chapter) are on the claim – add the underlying condition the doctor treated. ' : '') + (sug.length ? `If clinically true, document and add the supporting diagnosis: ${sug.map((r) => `${r[0].split(',')[0]} – ${r[1]}`).join(' | ')}. Otherwise remove the drug or replace it with one indicated for the coded diagnosis.` : 'Add the diagnosis this drug treats (see approved indications) or replace the drug with one indicated for the coded diagnosis.'),
        suggestedNote: sug.length ? `${d.match.scientific} prescribed for ${sug[0][1].toLowerCase()} (${sug[0][0].split(',')[0]}).` : undefined,
        lineIds: [l.id], refs: ['CHI Drug Formulary (DDF) indications', 'NPHIES MN-1-1 / PBM'],
      });
    } else if (!chk.listed && formulary) {
      b.add({ ruleId: 'DDX-002', area: 'Drug ↔ Diagnosis', severity: 'medium', title: `${d.match.scientific || l.desc} is not listed in the CHI formulary`, detail: 'The ingredient has no CHI DDF indication list – payers route it to PBM review and frequently decline it.', fix: 'Prefer a formulary alternative or attach a medical justification.', lineIds: [l.id], refs: ['CHI Drug Formulary (DDF)'] });
    } else if (chk.matched.length) {
      const edits = new Set(chk.matched.flatMap((m) => m.edits.split(/[,\s]+/).filter(Boolean)));
      const ipOnly = d.match.ingredient.i.filter((r) => chk.matched.some((m) => m.indication === r[1])).every((r) => r[5] === 1);
      if (ipOnly && claim.encounterType !== 'I') b.add({ ruleId: 'DDX-004', area: 'Drug ↔ Diagnosis', severity: 'medium', title: `${d.match.scientific}: indication approved for inpatients only`, detail: `The matching CHI indication (${chk.matched.map((m) => m.indication).join(', ')}) is flagged IP (inpatient).`, fix: 'Document emergency/observation use or use an outpatient alternative.', lineIds: [l.id], refs: ['CHI DDF patient-type edit'] });
      if (edits.has('PA') && !claim.approvalNo) b.add({ ruleId: 'DDX-005', area: 'Drug ↔ Diagnosis', severity: 'high', title: `${d.match.scientific} requires prior authorisation (CHI DDF "PA")`, detail: 'No approval number is recorded on the claim.', fix: 'Obtain pre-authorisation before dispensing and quote the approval number.', lineIds: [l.id], refs: ['CHI DDF prescribing edit PA', 'NPHIES BE-1-4'] });
      if (edits.has('QL') && l.units > 1) b.add({ ruleId: 'DDX-005', area: 'Drug ↔ Diagnosis', severity: 'medium', title: `${d.match.scientific}: quantity limit (CHI DDF "QL")`, detail: `Billed quantity ${l.units}. The formulary sets a quantity/duration limit for this indication.`, fix: 'Bill the quantity for the documented course only (dose × frequency × days).', lineIds: [l.id], refs: ['CHI DDF prescribing edit QL', 'NPHIES CV-4-2'] });
      if (edits.has('MD') && /emergency|general|gp|family/i.test(claim.specialty)) {
        const n = d.match.ingredient.notes.find((x) => /MD:/.test(x));
        b.add({ ruleId: 'DDX-005', area: 'Drug ↔ Diagnosis', severity: 'medium', title: `${d.match.scientific}: specialist prescriber restriction (CHI DDF "MD")`, detail: `Prescribed by ${claim.specialty}. ${n ? n.slice(0, 220) : ''}`, fix: 'Document specialist recommendation or refer.', lineIds: [l.id], refs: ['CHI DDF prescribing edit MD'] });
      }
    }

    // Age rules (curated + DDF)
    let ageFlagged = false;
    if (age !== null) {
      for (const r of AGE_RULES) {
        if (!r.re.test(d.name)) continue;
        if (r.injectableOnly && !d.injectable) continue;
        if (r.strengthRe && !r.strengthRe.test(l.desc)) continue;
        if ((r.minAge !== undefined && age < r.minAge) || (r.maxAge !== undefined && age >= r.maxAge)) {
          ageFlagged = true;
          b.add({ ruleId: 'SAF-004', area: 'Drug safety & interactions', severity: r.severity, title: `Age-inappropriate drug: ${d.match.scientific || l.desc} (patient ${claim.ageText})`, detail: r.effect, fix: r.maxAge ? 'Choose a safer alternative for older adults or document why benefit outweighs risk.' : 'Use an age-appropriate alternative and paediatric weight-based dose; document weight.', lineIds: [l.id], refs: ['SFDA SPC', 'BNF for Children', 'AGS Beers Criteria 2023'] });
          break;
        }
      }
      const ddf = ddfAgeLimit(d.match);
      if (!ageFlagged && ddf && ((ddf.min !== undefined && age < ddf.min) || (ddf.max !== undefined && age >= ddf.max))) {
        b.add({ ruleId: 'SAF-004', area: 'Drug safety & interactions', severity: 'medium', title: `CHI DDF age edit: ${d.match.scientific} (patient ${claim.ageText})`, detail: ddf.note.slice(0, 260), fix: 'Check the age restriction; document justification or use an alternative.', lineIds: [l.id], refs: ['CHI DDF prescribing edit AGE'] });
      }
    }

    // Pregnancy
    if (pregnant) {
      const p = PREGNANCY_AVOID.find((x) => (x.cls && d.classes.has(x.cls) && (!x.re || x.re.test(d.name))) || (!x.cls && x.re && x.re.test(d.name)));
      if (p && !d.topical) b.add({ ruleId: 'SAF-003', area: 'Drug safety & interactions', severity: p.severity, title: `Pregnancy: ${d.match.scientific || l.desc}`, detail: p.effect, fix: 'Use a pregnancy-compatible alternative (e.g. paracetamol, amoxicillin, cephalosporins) or document the risk-benefit decision.', lineIds: [l.id], refs: ['FDA pregnancy labelling', 'SFDA SPC'] });
    }

    // Drug–disease
    for (const dd of DRUG_DISEASE) {
      if (!d.classes.has(dd.cls)) continue;
      if (anyIcd(icds, dd.icd) || (dd.noteRe && has(text, dd.noteRe))) {
        b.add({ ruleId: 'SAF-002', area: 'Drug safety & interactions', severity: dd.severity, title: `Drug–disease conflict: ${d.match.scientific || l.desc}`, detail: dd.effect, fix: 'Choose an alternative compatible with the patient’s condition or document the precaution taken.', lineIds: [l.id], refs: ['SFDA SPC contraindications', 'Lexicomp'] });
        break;
      }
    }

    // Quantity
    if (l.units >= 3 && !/saline|ringer|dextrose|infusion|sodium chloride|water for/i.test(l.desc)) {
      b.add({ ruleId: 'SAF-005', area: 'Drug safety & interactions', severity: 'medium', title: `High quantity: ${l.units} × ${l.desc}`, detail: 'Quantity looks above an acute course. Payers adjust to the maximum daily dose × duration (e.g. Bupa CV-4-2 "quantity/duration exceeds maximum limit").', fix: 'Bill the exact course quantity and document dose, frequency and duration in the prescription.', lineIds: [l.id], refs: ['NPHIES CV-4-2', 'CHI DDF MDD'] });
    }
  }

  // Interactions / duplications
  const seenPairs = new Set<string>();
  for (let i = 0; i < drugs.length; i++) {
    for (let j = i + 1; j < drugs.length; j++) {
      const x = drugs[i], y = drugs[j];
      if (x.line.code && x.line.code === y.line.code) continue; // same item split into lines → handled as duplicate
      for (const it of INTERACTIONS) {
        const hit = (x.classes.has(it.a) && y.classes.has(it.b)) || (x.classes.has(it.b) && y.classes.has(it.a));
        if (!hit) continue;
        // IV fluids & diluents are not duplicates of each other for clinical purposes.
        const key = `${it.a}|${it.b}|${[x.line.id, y.line.id].sort().join()}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        const n1 = x.match?.scientific || x.line.desc, n2 = y.match?.scientific || y.line.desc;
        b.add({ ruleId: 'SAF-001', area: 'Drug safety & interactions', severity: it.severity, title: `${it.a === it.b ? 'Duplication' : 'Interaction'}: ${n1} + ${n2}`, detail: it.effect, fix: it.action, lineIds: [x.line.id, y.line.id], amountAtRisk: Math.min(lineAmount(x.line), lineAmount(y.line)), refs: ['Lexicomp / Stockley interaction severity', 'CredibleMeds QT list'] });
        break;
      }
    }
  }

  // ─────────────── Diagnosis ↔ Service (labs, imaging, procedures) ───────────────
  for (const l of claim.lines) {
    for (const r of rulesForLine(l)) {
      if (r.gender && claim.gender && r.gender !== claim.gender) {
        b.add({ ruleId: 'SVC-004', area: 'Diagnosis ↔ Service', severity: 'critical', title: `${r.label} billed for a ${claim.gender === 'M' ? 'male' : 'female'} patient`, detail: `${l.desc} is ${r.gender === 'F' ? 'female' : 'male'}-specific.`, fix: 'Correct the service or patient gender.', lineIds: [l.id], refs: ['NPHIES gender edit'] });
        continue;
      }
      if (age !== null && ((r.minAge !== undefined && age < r.minAge) || (r.maxAge !== undefined && age > r.maxAge))) {
        b.add({ ruleId: 'SVC-004', area: 'Diagnosis ↔ Service', severity: 'high', title: `${r.label}: unusual for age ${claim.ageText}`, detail: `${l.desc} is normally indicated for ages ${r.minAge ?? 0}–${r.maxAge ?? '∞'}.`, fix: 'Document the specific reason.', lineIds: [l.id], refs: ['Clinical practice guideline age criteria'] });
      }
      if (r.id === 'RAD-MRI-CT' && !claim.approvalNo) {
        b.add({ ruleId: 'SVC-007', area: 'Diagnosis ↔ Service', severity: 'high', title: `${l.desc}: no pre-authorisation number`, detail: 'CT/MRI require pre-authorisation under Saudi payer contracts. No approval number is recorded.', fix: 'Obtain approval before the scan and record the approval number on the claim.', lineIds: [l.id], refs: ['NPHIES BE-1-4 Pre-authorisation required'] });
      }
      if (r.coverageNote) b.add({ ruleId: 'SVC-005', area: 'Diagnosis ↔ Service', severity: 'medium', title: `${r.label}: coverage limitation`, detail: r.coverageNote + ' ' + r.why, fix: r.suggest, lineIds: [l.id], amountAtRisk: 0, refs: r.refs });
      if (r.contra && has(text, r.contra.re) && (r.contra.maxAge === undefined || (age !== null && age < r.contra.maxAge))) {
        b.add({ ruleId: 'SVC-006', area: 'Diagnosis ↔ Service', severity: 'high', title: `${r.label}: not indicated for the documented presentation`, detail: `${l.desc}: "${snippet(text, r.contra.re, 30)}". ${r.contra.why}`, fix: r.suggest, lineIds: [l.id], refs: r.refs });
        continue;
      }
      const strong = anyIcd(icds, r.icd);
      if (strong) continue;
      const cond = (r.conditional ?? []).find((c) => anyIcd(icds, c.icd));
      if (cond) {
        if (!mentionPositiveAny(text, cond.needs)) {
          b.add({ ruleId: 'SVC-002', area: 'Diagnosis ↔ Service', severity: 'high', title: `${r.label} not justified by documentation for ${icds.join(', ')}`, detail: `${l.desc}: the coded diagnosis supports this service only when the note documents ${cond.needsLabel}. ${r.why}`, fix: r.suggest, lineIds: [l.id], refs: r.refs });
        } else if (r.id !== 'PRC-INJ' && r.id !== 'RAD-MRI-CT') {
          b.add({ ruleId: 'SVC-011', area: 'Diagnosis ↔ Service', severity: 'medium', title: `${r.label}: justified only by free text – coding is weak`, detail: `${l.desc}: the note documents ${cond.needsLabel}, but the codes (${icds.join(', ')}) do not carry it. Payer auto-adjudication reads codes first (MN-1-1), so this line is likely rejected and needs an appeal.`, fix: r.suggest, lineIds: [l.id], amountAtRisk: 0, refs: r.refs });
        }
        continue;
      }
      const hint = r.noteHint && has(text, r.noteHint);
      b.add({
        ruleId: hint ? 'SVC-003' : 'SVC-001', area: 'Diagnosis ↔ Service', severity: 'high',
        title: hint ? `${r.label}: supporting diagnosis documented but not coded` : `${r.label} not supported by any diagnosis (${icds.join(', ') || 'none'})`,
        detail: `${l.desc}. ${r.why}${hint ? ` The note mentions "${snippet(text, r.noteHint!, 30)}".` : ''}`,
        fix: r.suggest, lineIds: [l.id], refs: r.refs,
      });
    }

    // Dental: tooth number
    if (/proced|dental/i.test(l.category) && /extract|restor|filling|composite|root canal|pulp|crown|periapical|amalgam|scaling/i.test(l.desc)) {
      if (!l.tooth && !/#\s?\d{2}|tooth\s*(no\.?|number)?\s*\d{2}/i.test(text)) {
        b.add({ ruleId: 'SVC-008', area: 'Missing medical data', severity: 'high', title: `Tooth number missing: ${l.desc}`, detail: 'Dental procedures must state the FDI tooth number (and surfaces for restorations).', fix: 'Record the tooth number (FDI 11–48 permanent, 51–85 primary) and surfaces.', lineIds: [l.id], refs: ['CHI dental benefit', 'FDI notation'] });
      } else if (/primary|decid/i.test(l.desc)) {
        const teeth = (l.tooth || '').match(/\d{2}/g) ?? [];
        if (teeth.some((t) => +t[0] <= 4) || (age !== null && age > 14)) {
          b.add({ ruleId: 'SVC-009', area: 'Diagnosis ↔ Service', severity: 'medium', title: `Primary-tooth procedure inconsistent with tooth/age`, detail: `Tooth ${l.tooth || '?'} / age ${claim.ageText}: primary teeth are numbered 51–85 and usually exfoliate by age 12–13.`, fix: 'Correct the tooth number or the procedure code (permanent tooth extraction).', lineIds: [l.id], refs: ['FDI notation'] });
        }
      }
    }
  }

  // Injection administration billed without an injectable drug
  const adminLines = claim.lines.filter((l) => /injection \(without|i\.?v\.? infusion|iv admin|infusion mon|im injection|infusion pump/i.test(l.desc));
  const injDrugs = drugs.filter((d) => d.injectable);
  if (adminLines.length && injDrugs.length === 0) {
    b.add({ ruleId: 'SVC-010', area: 'Diagnosis ↔ Service', severity: 'high', title: 'Administration fee without an injectable medication', detail: `${adminLines.map((l) => l.desc).join(', ')} billed but no injectable drug or IV fluid appears on the claim.`, fix: 'Bill the administered drug/fluid on the same claim or remove the administration fee.', lineIds: adminLines.map((l) => l.id), refs: ['NPHIES bundling / AD rules'] });
  }

  // ─────────────── Severity / justification ───────────────
  const severityDocumented = has(text, TERMS.severeOnly) || /\b([7-9]|10)\s*\/\s*10\b/.test(text);
  const parenteral = [...injDrugs.map((d) => d.line), ...adminLines];
  if (parenteral.length && !severityDocumented) {
    b.add({ ruleId: 'SEV-001', area: 'Severity / Justification', severity: 'high', title: 'Injection/IV given but severity not documented', detail: `Parenteral items: ${[...new Set(parenteral.map((l) => l.desc))].slice(0, 5).join('; ')}. The note does not state severity (pain score, persistent vomiting, inability to tolerate oral, failed oral therapy).`, fix: 'Document severity and why the oral route was not appropriate.', suggestedNote: 'Severe pain (score __/10) / persistent vomiting (__ episodes), unable to tolerate oral medication; parenteral route required for rapid relief.', lineIds: parenteral.map((l) => l.id), refs: ['CHI DDF EU (emergency use) edits', 'NPHIES MN-1-1'] });
  }
  const procLines = claim.lines.filter((l) => /proced|operat/i.test(l.category) && !adminLines.includes(l) && !/x-?ray|panoram|periapical/i.test(l.desc));
  if (procLines.length && !has(text, TERMS.severity) && !isDentalClaim(claim)) {
    b.add({ ruleId: 'SEV-002', area: 'Severity / Justification', severity: 'medium', title: 'Procedure billed without severity/grade documented', detail: `${procLines.map((l) => l.desc).slice(0, 4).join('; ')} – no severity, grade or failed conservative treatment documented.`, fix: 'Document severity/grade (e.g. Grade II–III ingrown nail, wound size, degree of burn) and why the procedure was needed today.', lineIds: procLines.map((l) => l.id), refs: ['NPHIES MN-1-1'] });
  }

  // ─────────────── Vital signs ↔ History ───────────────
  const v = claim.vitals;
  const dental = isDentalClaim(claim);
  const missing = [!v.temp && 'temperature', !v.pulse && 'pulse', !v.bpSys && 'blood pressure', !v.rr && 'respiratory rate'].filter(Boolean) as string[];
  if (missing.length && !dental) {
    const sev: Severity = missing.length >= 3 || parenteral.length || /emerg/i.test(claim.specialty) ? 'high' : 'medium';
    b.add({ ruleId: 'VIT-009', area: 'Vital signs ↔ History', severity: sev, title: `Vital signs missing: ${missing.join(', ')}`, detail: 'Payers use vital signs to verify fever, dehydration, distress and emergency status.', fix: 'Record full vital signs at triage for every visit.', refs: ['CHI clinical documentation standard', 'CBAHI'] });
  }
  const implausible: string[] = [];
  if (v.temp && (v.temp < 34 || v.temp > 42.5)) implausible.push(`temperature ${v.temp}`);
  if (v.pulse && (v.pulse < 30 || v.pulse > 220)) implausible.push(`pulse ${v.pulse}`);
  if (v.rr && (v.rr < 6 || v.rr > 80)) implausible.push(`RR ${v.rr}`);
  if (v.bpSys && (v.bpSys < 60 || v.bpSys > 260 || (v.bpDia ?? 0) >= v.bpSys)) implausible.push(`BP ${v.bpSys}/${v.bpDia}`);
  if (v.weight && age !== null && age >= 16 && (v.weight < 25 || v.weight > 300)) implausible.push(`weight ${v.weight} kg`);
  if (v.height && age !== null && age >= 16 && (v.height < 120 || v.height > 230)) implausible.push(`height ${v.height} cm`);
  if (implausible.length) b.add({ ruleId: 'VIT-010', area: 'Vital signs ↔ History', severity: 'high', title: `Implausible vital signs: ${implausible.join(', ')}`, detail: 'Values outside physiological limits look like data-entry errors and undermine the whole record.', fix: 'Correct the triage entry.', refs: ['Data quality'] });

  const t = v.temp;
  const feverMention = mention(text, TERMS.feverPos);
  const feverCoded = anyIcd(icds, FEVER_ICD);
  if (t && t < 37.5) {
    const strongClaim = has(text, TERMS.feverMeasuredHigh);
    const reported = feverMention === 'positive' && TERMS.feverReported.test(text);
    if (strongClaim) {
      b.add({ ruleId: 'VIT-001', area: 'Vital signs ↔ History', severity: 'high', title: `"Febrile/high-grade fever" documented but temperature ${t}°C`, detail: `History: "${snippet(text, TERMS.feverMeasuredHigh, 40)}". Measured temperature is normal.`, fix: 'Write "history of fever, last antipyretic at __:__ (drug)" or correct the temperature; do not describe the patient as febrile when afebrile at triage.', suggestedNote: `Reported fever at home (max __ °C), took __ at __:__; afebrile at triage (${t} °C).`, refs: ['Clinical documentation integrity'] });
    } else if (feverCoded) {
      b.add({ ruleId: 'VIT-001', area: 'Vital signs ↔ History', severity: 'high', title: `Fever coded (${icds.filter((c) => starts(c, FEVER_ICD)).join(', ')}) but temperature ${t}°C`, detail: reported ? 'Fever is only reported by history; the payer sees a normal temperature with a fever code.' : feverMention === 'positive' ? `History mentions fever ("${snippet(text, TERMS.feverPos, 30)}") but gives no maximum temperature or antipyretic timing; the payer sees R50 with a normal triage temperature.` : 'No fever documented and temperature normal.', fix: reported || feverMention === 'positive' ? 'Document the reported maximum temperature and antipyretic timing, or remove R50.' : 'Remove R50.x or correct the temperature.', suggestedNote: reported || feverMention === 'positive' ? `History of fever up to __ °C for __ days; antipyretic (__) taken __ h before arrival; temp at triage ${t} °C.` : undefined, refs: ['ICD-10 R50 definition', 'Observed: Tawuniya rejections with R50.9 + normal temp'] });
    } else if (feverMention === 'positive' && !TERMS.feverReported.test(text)) {
      b.add({ ruleId: 'VIT-001', area: 'Vital signs ↔ History', severity: 'medium', title: `Fever described but temperature ${t}°C`, detail: `"${snippet(text, TERMS.feverPos, 40)}"`, fix: 'Clarify that fever was reported (subjective / at home) and antipyretic timing.', refs: ['Clinical documentation integrity'] });
    }
  }
  if (t && t >= 38 && has(text, TERMS.afebrile)) {
    b.add({ ruleId: 'VIT-002', area: 'Vital signs ↔ History', severity: 'high', title: `"Afebrile / no fever" documented but temperature ${t}°C`, detail: `"${snippet(text, TERMS.afebrile, 40)}"`, fix: 'Correct the history or the recorded temperature, and add R50.9 if fever is real.', refs: ['Clinical documentation integrity'] });
  } else if (t && t >= 38 && feverMention !== 'positive' && !feverCoded) {
    b.add({ ruleId: 'VIT-003', area: 'Vital signs ↔ History', severity: 'low', title: `Temperature ${t}°C not reflected in history or codes`, detail: 'A measured fever supports tests/antipyretics/antibiotics – but only if documented and coded.', fix: 'Mention the fever in the history and add R50.9 if it is a reason for services.', refs: ['ACS 0002 Additional diagnoses'] });
  }
  const [hrLo, hrHi] = hrRange(age);
  if (has(text, TERMS.tachycardia) && v.pulse && v.pulse <= hrHi) {
    b.add({ ruleId: 'VIT-004', area: 'Vital signs ↔ History', severity: 'medium', title: `Tachycardia/palpitations documented but pulse ${v.pulse}`, detail: `Normal for age is ${hrLo}–${hrHi}/min.`, fix: 'If palpitations are a symptom, write "complains of palpitations, HR normal at triage"; otherwise correct.', refs: ['PALS normal ranges'] });
  }
  if (has(text, TERMS.bradycardia) && v.pulse && v.pulse >= 60) b.add({ ruleId: 'VIT-004', area: 'Vital signs ↔ History', severity: 'medium', title: `Bradycardia documented but pulse ${v.pulse}`, detail: 'History contradicts vitals.', fix: 'Correct history or vitals.', refs: ['Clinical documentation integrity'] });
  const [rrLo, rrHi] = rrRange(age);
  if (has(text, TERMS.tachypnea) && v.rr && v.rr <= rrHi && !has(text, /\bon exertion\b|\bexertional\b/i)) {
    b.add({ ruleId: 'VIT-005', area: 'Vital signs ↔ History', severity: 'medium', title: `Respiratory distress / SOB documented but RR ${v.rr}`, detail: `Normal RR for age is ${rrLo}–${rrHi}/min${v.spo2 ? `; SpO₂ ${v.spo2}%` : '; SpO₂ not recorded'}.`, fix: 'Document SpO₂, work of breathing (retractions) and auscultation; correct RR if wrong.', refs: ['PALS / NEWS2'] });
  }
  if ((has(text, TERMS.hypotension) || anyIcd(icds, HYPOTENSION_ICD)) && v.bpSys && v.bpSys >= 100) {
    b.add({ ruleId: 'VIT-006', area: 'Vital signs ↔ History', severity: 'high', title: `Hypotension/shock documented but BP ${v.bpSys}/${v.bpDia}`, detail: 'History/codes contradict the recorded blood pressure.', fix: 'Correct the BP or the history.', refs: ['Clinical documentation integrity'] });
  }
  if (v.bpSys && (v.bpSys >= 180 || (v.bpDia ?? 0) >= 110) && !has(text, TERMS.hypertension)) {
    b.add({ ruleId: 'VIT-007', area: 'Vital signs ↔ History', severity: 'medium', title: `Severely raised BP ${v.bpSys}/${v.bpDia} not addressed`, detail: 'A BP ≥ 180/110 should be documented (repeat reading) and managed or referred.', fix: 'Repeat BP, document assessment and plan; code I10/R03.0 if appropriate.', refs: ['ESH 2023 hypertension guideline'] });
  }
  const dehydrationClaimed = anyIcd(icds, DEHYDRATION_ICD) || has(text, TERMS.dehydration);
  if (dehydrationClaimed && v.pulse && v.pulse <= hrHi && (!v.bpSys || v.bpSys >= 100) && !/dry|sunken|capillary|turgor|oliguri|reduced urine/i.test(text)) {
    b.add({ ruleId: 'VIT-008', area: 'Vital signs ↔ History', severity: 'medium', title: 'Dehydration claimed without supporting signs', detail: `Pulse ${v.pulse}, BP ${v.bpSys ?? '?'}/${v.bpDia ?? '?'} and no examination signs of dehydration documented.`, fix: 'Document mucous membranes, skin turgor, capillary refill, urine output and degree of dehydration (WHO mild/some/severe).', refs: ['WHO dehydration assessment', 'NICE CG84'] });
  }
  if (age !== null && age < 14 && drugs.length && !v.weight) {
    b.add({ ruleId: 'VIT-011', area: 'Vital signs ↔ History', severity: 'high', title: 'Child prescribed medication without recorded weight', detail: 'Paediatric doses are weight-based; payers check dose against weight.', fix: 'Record weight (kg) at triage.', lineIds: drugs.map((d) => d.line.id), amountAtRisk: 0, refs: ['BNF for Children'] });
  }
  if (claim.lines.some((l) => /nebul/i.test(l.desc)) && !v.spo2) {
    b.add({ ruleId: 'VIT-012', area: 'Vital signs ↔ History', severity: 'medium', title: 'Nebulisation without SpO₂', detail: 'Oxygen saturation before/after nebulisation is the objective justification.', fix: 'Record SpO₂ and RR before and after treatment.', refs: ['GINA 2025'] });
  }

  // ─────────────── Missing medical data ───────────────
  const hist = claim.history.trim();
  if (hist.length < 25) {
    b.add({ ruleId: 'DOC-001', area: 'Missing medical data', severity: hist.length === 0 ? 'critical' : 'high', title: hist.length === 0 ? 'No history / chief complaint' : `History too brief: "${hist}"`, detail: 'Payers judge medical necessity from the history. A one-line complaint cannot support investigations or medications.', fix: 'Write chief complaint + onset/duration + associated symptoms + relevant negatives + past history.', suggestedNote: 'C/O __ for __ days, associated with __; no __. PMH: __. Drug allergy: __.', amountAtRisk: hist.length === 0 ? total : 0, refs: ['CHI clinical documentation', 'NPHIES supporting info'] });
  } else if (!TERMS.duration.test(text) && !dental) {
    b.add({ ruleId: 'DOC-002', area: 'Missing medical data', severity: 'medium', title: 'Duration / onset of complaint not documented', detail: 'Duration drives medical necessity (e.g. cough > 3 weeks for CXR, back pain > 6 weeks for imaging, fever > 3 days for CBC).', fix: 'State onset and duration ("for 3 days", "since yesterday").', refs: ['Clinical guidelines – duration criteria'] });
  }
  const examText = claim.examination || text;
  const needsJustification = claim.lines.some((l) => /lab|radio|imag|proced|operat/i.test(l.category)) || injDrugs.length > 0;
  if (!TERMS.exam.test(examText)) {
    b.add({ ruleId: 'DOC-003', area: 'Missing medical data', severity: needsJustification ? 'high' : 'medium', title: 'Examination findings not documented', detail: claim.examination ? 'Examination field has no clinical findings.' : 'No examination findings found in the record sent with the claim (history only).', fix: 'Document focused examination relevant to the complaint (e.g. throat/tonsils, chest auscultation, abdominal tenderness, ear drum, tooth/percussion).', suggestedNote: 'O/E: general condition __, (system) __; positive findings __; relevant negatives __.', refs: ['CHI clinical documentation', 'NPHIES MN-1-1'] });
  }
  if (!TERMS.plan.test(claim.plan || text)) {
    b.add({ ruleId: 'DOC-004', area: 'Missing medical data', severity: 'medium', title: 'Management plan not documented', detail: 'No plan (treatment, investigations rationale, advice, follow-up) is recorded.', fix: 'Write the plan: medications with dose/duration, investigations and why, advice, follow-up/red-flag instructions.', suggestedNote: 'Plan: __ (dose/frequency/duration); investigations: __ to rule out __; advice: __; follow-up in __ days or earlier if __.', refs: ['CHI clinical documentation'] });
  }
  const traumaText = has(text, TERMS.trauma);
  const traumaCoded = icds.some(isInjury);
  if (traumaText || traumaCoded) {
    const miss: string[] = [];
    if (!TERMS.mechanism.test(text)) miss.push('HOW (mechanism)');
    if (!TERMS.when.test(text)) miss.push('WHEN (date/time)');
    if (!TERMS.where.test(text)) miss.push('WHERE (place)');
    if (!TERMS.workStatus.test(text) && (age === null || age >= 15)) miss.push('WORK-RELATED? (yes/no)');
    if (miss.length) b.add({ ruleId: 'DOC-005', area: 'Missing medical data', severity: 'high', title: `Injury details missing: ${miss.join(', ')}`, detail: `Injury ${traumaCoded ? `coded (${icds.filter(isInjury).join(', ')})` : 'mentioned'} – payers require mechanism, date/time, place and whether it is work-related or an RTA before paying.`, fix: 'Complete the injury documentation.', suggestedNote: 'Injury: (how) __ on (date/time) __ at (place) __; NOT work-related / work-related; not RTA.', amountAtRisk: total, refs: ['CHI Unified Policy – work injuries (GOSI) & RTA', 'ICD-10-AM ACS 2001'] });
    if (has(text, TERMS.workPositive) && !has(text, TERMS.workNegative)) {
      b.add({ ruleId: 'DOC-006', area: 'Missing medical data', severity: 'critical', title: 'Work-related injury', detail: `"${snippet(text, TERMS.workPositive, 40)}". Occupational injuries are the responsibility of GOSI (Occupational Hazards Branch), not the health insurer.`, fix: 'Bill GOSI / employer per occupational-hazards process, or document clearly that the injury is not work-related.', amountAtRisk: total, refs: ['GOSI Occupational Hazards', 'CHI Unified Policy exclusions'] });
    }
    if (has(text, TERMS.rta)) b.add({ ruleId: 'DOC-007', area: 'Missing medical data', severity: 'high', title: 'Road-traffic accident', detail: 'RTA injuries are covered by motor insurance; health insurers request the Najm / traffic police report and may recover costs.', fix: 'Attach the Najm/police report number and document the vehicle/occupant details.', amountAtRisk: total, refs: ['CHI Unified Policy – RTA', 'Najm'] });
    if (has(text, TERMS.assault)) b.add({ ruleId: 'DOC-008', area: 'Missing medical data', severity: 'medium', title: 'Assault-related injury', detail: 'Medico-legal case – police notification documentation is expected.', fix: 'Document police notification / medico-legal report number.', refs: ['MOH medico-legal regulations'] });
  }
  if (pregnant && !claim.lmp && !/lmp|gestation|\bga\b|\d+\s*(wks?|weeks)/i.test(text)) {
    b.add({ ruleId: 'DOC-009', area: 'Missing medical data', severity: 'medium', title: 'Pregnancy without LMP / gestational age', detail: 'Antenatal services (scans, OGTT, serology) depend on gestational age.', fix: 'Record LMP and gestational age (weeks + days).', refs: ['NICE NG201'] });
  }

  // ─────────────── Follow-up & duplicates ───────────────
  const consult = claim.lines.find(isConsultLine);
  if (consult && claim.serviceDate) {
    const prior = history
      .filter((h) => h.id !== claim.id && h.mrn && h.mrn === claim.mrn && h.serviceDate && h.serviceDate < claim.serviceDate && h.lines.some(isConsultLine))
      .map((h) => ({ h, days: (Date.parse(claim.serviceDate) - Date.parse(h.serviceDate)) / 86400000 }))
      .filter((x) => x.days > 0 && x.days <= 14)
      .sort((a, b) => b.h.serviceDate.localeCompare(a.h.serviceDate));
    const same = prior.find((x) => x.h.physician === claim.physician) ?? prior.find((x) => x.h.specialty === claim.specialty);
    if (same) {
      const shared = same.h.diagnoses.some((d) => icds.some((c) => c.slice(0, 3) === d.code.slice(0, 3)));
      b.add({ ruleId: 'FUP-001', area: 'Follow-up & duplicates', severity: shared ? 'high' : 'medium', title: `Consultation within free follow-up period (${Math.round(same.days)} days after claim ${same.h.claimNo})`, detail: `Previous visit ${same.h.serviceDate} with ${same.h.physician} (${same.h.specialty}) – ${shared ? 'same diagnosis group' : 'different diagnosis'}. Payers apply the 14-day free follow-up rule (NPHIES CV-1-9, Tawuniya "Same Physician").`, fix: shared ? 'Do not bill a new consultation for follow-up of the same condition within 14 days (bill services only).' : 'Document that this is a NEW complaint unrelated to the previous visit and code it clearly.', lineIds: [consult.id], refs: ['CHI Unified Policy – follow-up visits', 'NPHIES CV-1-9'] });
    }
  }
  const codeCount = new Map<string, ServiceLine[]>();
  for (const l of claim.lines) {
    if (!l.code || isDrugLine(l)) continue;
    const k = `${l.code}|${l.invoice}`;
    codeCount.set(k, [...(codeCount.get(k) ?? []), l]);
  }
  for (const ls of codeCount.values()) {
    if (ls.length > 1) b.add({ ruleId: 'FUP-002', area: 'Follow-up & duplicates', severity: 'high', title: `Duplicate service: ${ls[0].desc} ×${ls.length}`, detail: 'The same service code is billed more than once on the same invoice/date (NPHIES AD-2-4).', fix: 'Remove the duplicate or use the units field with documented reason (e.g. bilateral).', lineIds: ls.slice(1).map((l) => l.id), refs: ['NPHIES AD-2-4 duplicate service'] });
  }
  if (claim.mrn && claim.serviceDate) {
    for (const d of drugs) {
      const prev = history.find((h) => h.id !== claim.id && h.mrn === claim.mrn && h.serviceDate && h.serviceDate < claim.serviceDate && (Date.parse(claim.serviceDate) - Date.parse(h.serviceDate)) / 86400000 < 20 && h.lines.some((l) => isDrugLine(l) && l.code === d.line.code));
      if (prev && !d.injectable) b.add({ ruleId: 'FUP-003', area: 'Follow-up & duplicates', severity: 'medium', title: `Refill too soon: ${d.line.desc}`, detail: `Same drug dispensed on ${prev.serviceDate} (claim ${prev.claimNo}).`, fix: 'Check remaining supply; document loss/dose change if a new pack is necessary.', lineIds: [d.line.id], refs: ['PBM refill-too-soon edit'] });
    }
  }

  return finalize(claim, findings);
}

/** Score, worst severity and SAR at risk for a set of findings on one claim. */
export function finalize(claim: Claim, all: Finding[]): ClaimAudit {
  const findings = [...all].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const total = claim.lines.reduce((s, l) => s + lineAmount(l), 0);
  // Probability-style score: each finding independently adds its severity's rejection likelihood.
  const score = Math.round(100 * (1 - findings.reduce((p, f) => p * (1 - SEVERITY_WEIGHT[f.severity] / 100), 1)));
  const serious = findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
  const flagged = new Set(serious.flatMap((f) => f.lineIds ?? []));
  const claimLevel = serious.filter((f) => !f.lineIds?.length).reduce((m, f) => Math.max(m, f.amountAtRisk), 0);
  const lineRisk = claim.lines.filter((l) => flagged.has(l.id)).reduce((s, l) => s + lineAmount(l), 0);
  const amountAtRisk = Math.round(Math.min(total, Math.max(claimLevel, lineRisk)) * 100) / 100;
  return { claim, findings, score, amountAtRisk, worst: findings[0]?.severity ?? null };
}

/** Rules about contracts, codes, approvals and billing mechanics – shown in the Technical audit. */
export const TECHNICAL_RULES = new Set(['FUP-001', 'FUP-002', 'FUP-003', 'SVC-007', 'DDX-003', 'DDX-005', 'COD-001', 'COD-004', 'SVC-010']);
export type AuditView = 'medical' | 'technical' | 'all';

export function viewAudit(a: ClaimAudit, view: AuditView): ClaimAudit {
  if (view === 'all') return a;
  return finalize(a.claim, a.findings.filter((f) => (view === 'technical') === TECHNICAL_RULES.has(f.ruleId)));
}

function mentionPositiveAny(text: string, re: RegExp): boolean {
  return mention(text, re) === 'positive';
}

export function auditAll(claims: Claim[], formulary: Formulary | null): ClaimAudit[] {
  // Follow-up and refill checks only look at the same patient: index by MRN so large files stay fast.
  const byMrn = new Map<string, Claim[]>();
  for (const c of claims) if (c.mrn) byMrn.set(c.mrn, [...(byMrn.get(c.mrn) ?? []), c]);
  return claims.map((c) => {
    try {
      return auditClaim(c, formulary, c.mrn ? byMrn.get(c.mrn)! : []);
    } catch (e) {
      // One malformed row must never blank the whole audit.
      return finalize(c, [{ id: `${c.id}-err`, ruleId: 'SYS-001', area: 'ICD coding quality', severity: 'low', title: 'Encounter could not be fully audited', detail: String(e), fix: 'Check this encounter’s rows in the source file.', amountAtRisk: 0, refs: [] }]);
    }
  });
}

export const AREAS: AuditArea[] = ['Diagnosis ↔ Service', 'Drug ↔ Diagnosis', 'Drug safety & interactions', 'Vital signs ↔ History', 'Missing medical data', 'Severity / Justification', 'ICD coding quality', 'Follow-up & duplicates'];
