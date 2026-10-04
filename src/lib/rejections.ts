import type { Claim, FinancialAdjustment, LinkStatus, Payer, Rejection, RejectionGroup } from './types';
import { isPlaceholder, money, norm, parseDate, type Layout, type Mapping } from './parse';

// ───────────── Classification ─────────────

export interface Cause {
  id: string;
  label: string;
  group: RejectionGroup;
  subcategory: string;
  match: RegExp;
  /** Payer reason codes that identify this cause, with the payer they belong to. */
  codes: { code: string; scope: 'NPHIES' | Payer }[];
  prevent: string[];
  appeal: string;
}

const C = (code: string, scope: 'NPHIES' | Payer = 'NPHIES') => ({ code, scope });

/** Ordered: the first cause whose description pattern matches wins; codes are checked first when present. */
export const CAUSES: Cause[] = [
  {
    id: 'MN-DRUG-DX', label: 'Drug not indicated for diagnosis', group: 'Medical', subcategory: 'Drug indication',
    match: /not indicated with diagnosis|medication .* not indicated|is not indicated/i, codes: [],
    prevent: ['Check each prescription against the CHI Drug Formulary indication list (Drug ↔ ICD checker).', 'Code the condition the drug treats, not only the presenting symptom; add the symptom code when a drug treats a symptom (e.g. R11 for an antiemetic).'],
    appeal: 'Appeal only when the note documents an approved indication that was not coded; submit the corrected ICD with the note excerpt.',
  },
  {
    id: 'MN-AGE', label: 'Inconsistent with age or gender', group: 'Medical', subcategory: 'Clinical appropriateness (age/gender)',
    match: /inconsistent with the patient'?s? (age|gender|sex)|age limit|not (indicated|allowed) for (age|gender)/i, codes: [],
    prevent: ['Use age-appropriate products and weight-based paediatric dosing; record weight for every child.'],
    appeal: 'Appeal with specialist justification and weight-based dose calculation.',
  },
  {
    id: 'MN-QTY', label: 'Quantity / duration exceeds limit', group: 'Medical', subcategory: 'Dose, quantity & duration',
    match: /quantity|duration adjusted|exceeds the maximum|maximum limit|inappropriate medication duration/i, codes: [C('CV-4-2'), C('323', 'Bupa')],
    prevent: ['Bill dose × frequency × days for acute courses; document chronic use when longer courses are needed.'],
    appeal: 'Appeal with the documented dosing schedule.',
  },
  {
    id: 'MN-COVER', label: 'Not covered / policy exclusion', group: 'Medical', subcategory: 'Coverage & benefit',
    match: /not covered|exclusion|excluded|benefit limit|outside coverage/i, codes: [],
    prevent: ['Check eligibility and benefits before the service; bill excluded items as cash with patient consent.'],
    appeal: 'Appeal only if the policy schedule includes the benefit.',
  },
  {
    id: 'MN-JUSTIFY', label: 'Not clinically justified', group: 'Medical', subcategory: 'Clinical justification',
    match: /not clinically justified|clinical practice guideline|supporting diagnosis|medical necessity|medically necessary|not justified/i, codes: [C('MN-1-1'), C('230.6', 'Bupa')],
    prevent: ['Every lab, imaging and procedure must answer a documented clinical question: code the diagnosis or red-flag symptom that justifies it and document the findings (duration, vitals, examination).'],
    appeal: 'Appeal with patient-specific findings (duration, vitals, examination) plus the guideline – guideline text alone is usually re-rejected.',
  },
  {
    id: 'TC-FOLLOWUP', label: 'Follow-up within free period / same physician', group: 'Technical/Administrative', subcategory: 'Administrative – follow-up period',
    match: /same physi|follow.?up period|free follow|within .*follow|14.?day/i, codes: [C('CV-1-9'), C('23', 'Bupa')],
    prevent: ['Do not bill a consultation for the same patient, doctor/specialty and complaint within the free follow-up period; document a new complaint when it is one.'],
    appeal: 'Appeal only for a genuinely new condition with a different diagnosis.',
  },
  {
    id: 'TC-PA-DENIED', label: 'Billed after pre-authorisation was rejected or cancelled', group: 'Technical/Administrative', subcategory: 'Authorization – denied/cancelled at pre-auth',
    match: /rejected\/?cancell?ed at pre.?auth|already rejected.*pre.?auth|cancell?ed at pre.?auth/i, codes: [C('142', 'Bupa')],
    prevent: ['Do not bill services whose pre-authorisation was rejected or cancelled unless a new approval is obtained; review the pre-auth rejection reason (often medical).'],
    appeal: 'Appeal the pre-authorisation decision itself with clinical evidence, then re-bill with the approval number.',
  },
  {
    id: 'TC-PA-MISSING', label: 'Pre-authorisation required but not obtained', group: 'Technical/Administrative', subcategory: 'Authorization – not obtained',
    match: /pre.?auth\w* (is )?required|required and was not obtained|prior auth|approval (required|not obtained)|without (pre.?)?approval/i, codes: [C('BE-1-4')],
    prevent: ['Request approval before services on the insurer’s approval list and record the approval number on the claim.'],
    appeal: 'Appeal only with an approval number or emergency documentation.',
  },
  {
    id: 'TC-PRICE', label: 'Not in contracted price list', group: 'Technical/Administrative', subcategory: 'Pricing – price list',
    match: /out of price list|not part of the agreed price ?list|price ?list|out of validity|not in (the )?contract|non.?contract/i, codes: [C('25', 'Bupa'), C('26', 'Bupa')],
    prevent: ['Map each HIS item to the insurer’s contracted price-list code and keep the pharmacy master aligned with the current price list (upload it as reference data to check before submission).'],
    appeal: 'Appeal with the contract annex showing the item and price; otherwise request a price-list update.',
  },
  {
    id: 'TC-CODE', label: 'Invalid or unmapped service code', group: 'Technical/Administrative', subcategory: 'Coding & mapping',
    match: /invalid (service )?code|wrong code|code not valid|unmapped/i, codes: [],
    prevent: ['Validate service codes against the current NPHIES code set and the insurer mapping.'],
    appeal: 'Re-submit with the correct code.',
  },
  {
    id: 'TC-DUP', label: 'Duplicate billing', group: 'Technical/Administrative', subcategory: 'Billing – duplicate',
    match: /duplicate|repeated billing|already (billed|paid|settled)/i, codes: [C('AD-2-4'), C('36', 'Bupa')],
    prevent: ['Bill each service once per date; split visits must not repeat the same code.'],
    appeal: 'Appeal with proof of two separate services (time, site, laterality).',
  },
  {
    id: 'TC-BILLING', label: 'Incorrect billing regime', group: 'Technical/Administrative', subcategory: 'Billing – benefit/regime',
    match: /billing regime|incorrect billing/i, codes: [],
    prevent: ['Bill medications under the medication benefit with the SFDA code, not as procedures or consumables.'],
    appeal: 'Re-submit under the correct benefit type.',
  },
  {
    id: 'TC-REFILL', label: 'Refill too soon', group: 'Technical/Administrative', subcategory: 'Dispensing – refill interval',
    match: /refill too soon|early refill|last refilled/i, codes: [],
    prevent: ['Check the previous dispensing date of the same drug before dispensing again.'],
    appeal: 'Appeal with documentation of lost medication, dose change or a new episode.',
  },
  {
    id: 'TC-ELIG', label: 'Membership / eligibility', group: 'Technical/Administrative', subcategory: 'Administrative – eligibility',
    match: /membership|eligib|inactive member|terminated/i, codes: [],
    prevent: ['Run the NPHIES eligibility check at registration and keep the response.'],
    appeal: 'Appeal with the eligibility response from the service date.',
  },
];

export const NEEDS_REVIEW: Cause = {
  id: 'NEEDS-REVIEW', label: 'Needs review (reason not stated or not recognised)', group: 'Needs review', subcategory: 'Unclassified', match: /$^/, codes: [],
  prevent: ['Ask the insurer for the coded rejection reason; correct the classification here once known.'],
  appeal: 'Request clarification from the insurer.',
};

/** Financial differences that are not rejections (patient share, deductible, discounts). */
const FINANCIAL = /deductible|co.?pay|patient share|discount difference|difference in computation/i;

export const causeById = (id: string) => CAUSES.find((c) => c.id === id) ?? NEEDS_REVIEW;

export function classify(reason: string, codes: string[], payer: Payer): { cause: Cause; confidence: Rejection['confidence'] } {
  const byCode = CAUSES.filter((c) => c.codes.some((k) => codes.some((x) => x && x.toUpperCase().startsWith(k.code.toUpperCase())) && (k.scope === 'NPHIES' || k.scope === payer)));
  const byText = CAUSES.find((c) => c.match.test(reason));
  // A specific description (e.g. drug not indicated) refines a generic code (MN-1-1).
  if (byText && (byCode.length === 0 || byCode.some((c) => c.group === byText.group))) return { cause: byText, confidence: byCode.length ? 'code' : 'description' };
  if (byCode.length) return { cause: byCode[0], confidence: 'code' };
  return { cause: NEEDS_REVIEW, confidence: 'none' };
}

// ───────────── Parsing statements ─────────────

export function inferCategory(desc: string, code = ''): string {
  const d = desc.toLowerCase();
  if (/consult|assessment|office visit|follow.?up visit/.test(d)) return 'Dr. Consultations';
  if (/x-?ray|radiograph|u\/s|ultra ?sound|sonar|\bmri\b|\bct\b|scan|mammo|doppler/.test(d)) return 'Radiology';
  if (/tablet|capsule|injection|\binj\b|syrup|suspension|cream|ointment|gel|spray|drops?|sachet|ampoule|vial|bottle|\bmg\b|\bml\b|patch|tape|solution|powder|suppositor|inhaler|lozenge/.test(d) || /^\d{10}$|^\d{1,3}-\d{2,4}-\d{2}$/.test(code.trim())) return 'Medicine';
  if (/count|test|analysis|typing|glucose|culture|hba1c|serum|blood|urine|stool|level|antigen|antibod|profile|tsh|vitamin|crp|esr|ferritin|creatinin|urea|bilirubin|enzyme|pcr|swab|smear/.test(d)) return 'Laboratory';
  if (/dressing|suture|injection admin|i\.?v|infusion|nebul|extraction|restoration|wash|procedure|ecg|excision|incision|drainage/.test(d)) return 'Procedures';
  return 'Other';
}

export interface ParsedStatement {
  rejections: Rejection[];
  adjustments: FinancialAdjustment[];
  informational: number; // lines with no rejected amount and no reason
  errors: string[];
}

/** rec is keyed by original header; we read known layouts through normalised header names. */
export function parseStatementRow(layout: Layout, rec: Record<string, string>, mapping: Mapping | null, ctx: { importId: string; rowNo: number; payer: Payer; source: string; period: string }): Rejection | FinancialAdjustment | 'info' | null {
  const n: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) n[norm(k)] = (v ?? '').trim();
  const g = (...keys: string[]) => { for (const k of keys) { const v = n[k]; if (v !== undefined && !isPlaceholder(v)) return v; } return ''; };
  const m = (k: string) => (mapping && mapping[k] ? (rec[mapping[k]] ?? '').trim() : '');
  let r: Omit<Rejection, 'causeId' | 'cause' | 'group' | 'subcategory' | 'confidence' | 'overridden' | 'category' | 'icdsNamed' | 'link'>;
  const base = { id: `${ctx.importId}#${ctx.rowNo}`, importId: ctx.importId, rowNo: ctx.rowNo, payer: ctx.payer, source: ctx.source, doctor: '', specialty: '' };
  if (layout === 'tawuniya-waseel') {
    r = {
      ...base, batch: g('waseelbatch'), claimRef: g('claimno'), invoice: g('invoicenumber', 'providerref'), serviceCode: g('servicecode'), serviceDesc: g('service'),
      amount: money(g('rejectedamount')), vat: null, priceExcess: money(g('exceedprice')),
      reasonRaw: [g('reason'), g('nphiesrejectiondescription'), g('tawuniyareply'), g('payercomment')].filter(Boolean).join(' — '),
      reasonCode: '', nphiesCode: g('nphiesrejectioncode'), icd: '', serviceDate: '', period: ctx.period,
      appealStatus: g('status').toUpperCase(), appealText: g('comments'),
    };
  } else if (layout === 'bupa-clprovstm') {
    const date = parseDate(g('incurdatefrom', 'invdate'));
    r = {
      ...base, batch: g('batchid'), claimRef: g('claimid'), invoice: g('invno'), serviceCode: g('servcode'), serviceDesc: g('servdesc'),
      amount: money(g('rejectamount')), vat: n.vatrejamt !== undefined && n.vatrejamt !== '' ? money(n.vatrejamt) : null, priceExcess: 0,
      reasonRaw: [g('rejdesc'), g('nphiesdenialdescription')].filter(Boolean).join(' — '), reasonCode: g('rejcode'), nphiesCode: g('nphiesrejectioncode'),
      icd: g('icdcode'), serviceDate: date, period: date.slice(0, 7) || ctx.period, appealStatus: '', appealText: '',
    };
    if (!r.claimRef && !r.serviceDesc) {
      // Batch-level row such as "Deductible difference".
      const label = Object.values(n).find((v) => /[a-z]/i.test(v)) ?? 'Batch adjustment';
      if (FINANCIAL.test(label) || /deduct/i.test(r.reasonRaw)) return { id: base.id, importId: ctx.importId, rowNo: ctx.rowNo, payer: ctx.payer, period: ctx.period, label, amount: r.amount, vat: r.vat };
    }
  } else {
    const date = parseDate(m('date'));
    r = {
      ...base, batch: '', claimRef: m('claimRef'), invoice: m('invoice'), serviceCode: m('serviceCode'), serviceDesc: m('serviceDesc'),
      amount: money(m('amount')), vat: m('vat') ? money(m('vat')) : null, priceExcess: 0, reasonRaw: m('reason'), reasonCode: m('reasonCode'), nphiesCode: m('nphiesCode'),
      icd: m('icd'), serviceDate: date, period: date.slice(0, 7) || ctx.period, appealStatus: '', appealText: '',
    };
  }
  if (r.amount <= 0 && !r.reasonRaw) {
    // Only a price difference: a pricing adjustment, reported separately from rejections.
    if (r.priceExcess > 0) return { id: base.id, importId: ctx.importId, rowNo: ctx.rowNo, payer: ctx.payer, period: r.period, label: `Price excess over contracted price – ${r.serviceDesc}`.slice(0, 120), amount: r.priceExcess, vat: null };
    return 'info';
  }
  if (FINANCIAL.test(r.reasonRaw) && !/not clinically|not indicated/i.test(r.reasonRaw)) {
    return { id: base.id, importId: ctx.importId, rowNo: ctx.rowNo, payer: ctx.payer, period: r.period, label: r.reasonRaw.slice(0, 80), amount: r.amount, vat: r.vat };
  }
  const { cause, confidence } = classify(r.reasonRaw, [r.nphiesCode, r.reasonCode], ctx.payer);
  const icdsNamed = [...new Set((r.reasonRaw.match(/diagnosis code\s+([A-Z]\d{2}(?:\.\d{1,3})?)/gi) ?? []).map((x) => x.split(/\s+/).pop()!.toUpperCase()))];
  return { ...r, causeId: cause.id, cause: cause.label, group: cause.group, subcategory: cause.subcategory, confidence, overridden: false, category: inferCategory(r.serviceDesc, r.serviceCode), icdsNamed, link: 'unmatched' };
}

export function applyOverride(r: Rejection, causeId: string | undefined): Rejection {
  if (!causeId) return r;
  const c = causeById(causeId);
  return { ...r, causeId: c.id, cause: c.label, group: c.group, subcategory: c.subcategory, overridden: true };
}

// ───────────── Linking to claim lines ─────────────

const invKey = (s: string) => (s || '').replace(/\D/g, '').slice(-10);
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);

/** Links rejection lines to encounters/lines of the same insurer. Uncertain links are labelled, never forced. */
export function linkRejections(rejections: Rejection[], claims: Claim[]): Rejection[] {
  const byInv = new Map<string, Claim[]>();
  for (const c of claims) for (const inv of c.invoices) {
    const k = `${c.payer}|${invKey(inv)}`;
    byInv.set(k, [...(byInv.get(k) ?? []), c]);
  }
  return rejections.map((r) => {
    const k = invKey(r.invoice);
    const cands = k ? byInv.get(`${r.payer}|${k}`) ?? [] : [];
    if (!cands.length) return { ...r, link: 'unmatched' as LinkStatus, linkedClaim: undefined, linkedLine: undefined };
    const c = cands[cands.length - 1];
    const onInv = c.lines.filter((l) => invKey(l.invoice) === k);
    let line = onInv.find((l) => l.code && r.serviceCode && l.code.replace(/\s/g, '') === r.serviceCode.replace(/\s/g, ''));
    let link: LinkStatus = line ? 'linked' : 'invoice-only';
    if (!line) {
      const rw = words(r.serviceDesc);
      const scored = onInv.map((l) => ({ l, s: [...words(l.desc)].filter((w) => rw.has(w)).length })).sort((a, b) => b.s - a.s);
      if (scored[0] && scored[0].s >= Math.min(2, rw.size) && scored[0].s > (scored[1]?.s ?? 0)) { line = scored[0].l; link = 'probable'; }
      else if (onInv.length === 1) { line = onInv[0]; link = 'probable'; }
    }
    return {
      ...r,
      link,
      linkedClaim: c.id,
      linkedLine: line?.id,
      doctor: c.physician,
      specialty: c.specialty,
      icd: r.icd || c.diagnoses.map((d) => d.code).join(', '),
      category: line?.category ?? r.category,
      serviceDate: r.serviceDate || c.serviceDate,
      period: r.serviceDate ? r.period : c.period || r.period,
    };
  });
}
