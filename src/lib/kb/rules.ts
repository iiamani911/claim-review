import type { AuditArea, RuleScope, Severity } from '../types';

export type RuleType = 'Official reference rule' | 'Hospital rule' | 'Insurer reference rule' | 'Historical pattern';

export interface RuleMeta {
  id: string;
  name: string;
  area: AuditArea;
  severity: Severity | 'varies';
  what: string;
  source: string;
  type?: RuleType;
  scope?: RuleScope | 'Per insurer';
  version?: string;
}

/** Version label of the hospital rule set authored in this tool. */
export const HOSPITAL_RULES_VERSION = 'Hospital rule set v2 · 2026-10-04';
export const DDF_VERSION = 'CHI DDF 12 Jan 2025 (file supplied by the hospital)';

export function ruleType(id: string): RuleType {
  if (/^DDX-00[1245]$/.test(id)) return 'Official reference rule';
  if (/^TEC-(PRICE|PA)/.test(id)) return 'Insurer reference rule';
  if (/^HIST/.test(id)) return 'Historical pattern';
  return 'Hospital rule';
}
export function ruleScope(id: string): RuleScope | 'Per insurer' {
  return /^TEC-(PRICE|PA)|^HIST/.test(id) ? 'Per insurer' : 'Shared';
}
export function ruleVersion(id: string): string {
  const t = ruleType(id);
  if (t === 'Official reference rule') return DDF_VERSION;
  if (t === 'Insurer reference rule') return 'Version of the uploaded insurer file';
  if (t === 'Historical pattern') return 'Recomputed from imported records';
  return HOSPITAL_RULES_VERSION;
}

/** Catalogue shown in the Rulebook. Severity is the default; some rules escalate per case. */
export const RULES: RuleMeta[] = [
  { id: 'DDX-001', name: 'Drug not indicated for any claim diagnosis', area: 'Drug ↔ Diagnosis', severity: 'critical', what: 'Every billed medication is resolved to its SFDA active ingredient and checked against the CHI Drug Formulary indication ICD list. High instead of critical when only symptom codes are present or the item is an IV vehicle.', source: 'CHI DDF (Jan 2025) · NPHIES MN-1-1 / PBM' },
  { id: 'DDX-002', name: 'Drug not listed in CHI formulary', area: 'Drug ↔ Diagnosis', severity: 'medium', what: 'Ingredient has no CHI indication list – routed to PBM review.', source: 'CHI DDF' },
  { id: 'DDX-003', name: 'Drug code not found in SFDA list', area: 'Drug ↔ Diagnosis', severity: 'low', what: 'Code/GTIN not matched to the SFDA registry, so checks cannot run.', source: 'NPHIES medication code-set' },
  { id: 'DDX-004', name: 'Inpatient-only indication on an outpatient claim', area: 'Drug ↔ Diagnosis', severity: 'medium', what: 'Matching indication is flagged IP in the DDF.', source: 'CHI DDF patient-type edit' },
  { id: 'DDX-005', name: 'DDF prescribing edit (PA / QL / MD)', area: 'Drug ↔ Diagnosis', severity: 'varies', what: 'Prior authorisation, quantity limit or specialist-prescriber restriction.', source: 'CHI DDF prescribing edits' },
  { id: 'DDX-006', name: 'Non-drug / excluded item', area: 'Drug ↔ Diagnosis', severity: 'high', what: 'Infant formula, cosmetics, supplements without a qualifying diagnosis.', source: 'CHI Unified Policy exclusions' },
  { id: 'SVC-001', name: 'Service not supported by any diagnosis', area: 'Diagnosis ↔ Service', severity: 'high', what: '60+ lab, imaging, procedure and dental rules map each service to the ICD groups that justify it.', source: 'ACR, NICE, IDSA, ADA, ACOG, AAO-HNS · NPHIES MN-1-1' },
  { id: 'SVC-002', name: 'Diagnosis supports the service only with documented findings', area: 'Diagnosis ↔ Service', severity: 'high', what: 'e.g. CBC with URTI needs fever ≥ 3 days / productive sputum; IV fluids need dehydration signs.', source: 'Guideline red-flag criteria' },
  { id: 'SVC-003', name: 'Supporting condition documented but not coded', area: 'Diagnosis ↔ Service', severity: 'high', what: 'The note mentions the indication (e.g. hypothyroidism) but the ICD is missing.', source: 'ACS 0002 additional diagnoses' },
  { id: 'SVC-004', name: 'Gender/age restriction on service', area: 'Diagnosis ↔ Service', severity: 'critical', what: 'e.g. β-hCG for a male, PSA for a female.', source: 'NPHIES edits' },
  { id: 'SVC-005', name: 'Coverage limitation', area: 'Diagnosis ↔ Service', severity: 'medium', what: 'Vitamin D screening, infertility work-up, allergy panels.', source: 'CHI Unified Policy' },
  { id: 'SVC-006', name: 'Service not indicated for the documented presentation', area: 'Diagnosis ↔ Service', severity: 'high', what: 'e.g. abdominal ultrasound for functional constipation in a child.', source: 'NASPGHAN/ESPGHAN' },
  { id: 'SVC-007', name: 'CT/MRI without pre-authorisation number', area: 'Diagnosis ↔ Service', severity: 'high', what: 'Advanced imaging without approval number.', source: 'NPHIES BE-1-4' },
  { id: 'SVC-008', name: 'Dental procedure without tooth number', area: 'Missing medical data', severity: 'high', what: 'FDI tooth number (and surfaces) required.', source: 'CHI dental benefit' },
  { id: 'SVC-009', name: 'Primary-tooth procedure inconsistent with tooth/age', area: 'Diagnosis ↔ Service', severity: 'medium', what: 'Primary teeth are 51–85.', source: 'FDI notation' },
  { id: 'SVC-010', name: 'Administration fee without injectable drug', area: 'Diagnosis ↔ Service', severity: 'high', what: 'IV/IM administration billed but no drug/fluid on claim.', source: 'NPHIES bundling' },
  { id: 'SVC-011', name: 'Justified by free text only (weak coding)', area: 'Diagnosis ↔ Service', severity: 'medium', what: 'The note supports the service but the codes do not – likely auto-rejected, then appealable.', source: 'Payer auto-adjudication' },
  { id: 'SEV-001', name: 'Injection/IV without documented severity', area: 'Severity / Justification', severity: 'high', what: 'Pain score, persistent vomiting, oral intolerance or failed oral therapy must be written.', source: 'CHI DDF EU edits · MN-1-1' },
  { id: 'SEV-002', name: 'Procedure without severity/grade', area: 'Severity / Justification', severity: 'medium', what: 'Grade, size or failed conservative care must be written.', source: 'MN-1-1' },
  { id: 'VIT-001', name: 'Fever documented/coded but temperature normal', area: 'Vital signs ↔ History', severity: 'high', what: '"Febrile" or R50 with triage temperature < 37.5 °C.', source: 'Documentation integrity' },
  { id: 'VIT-002', name: '"Afebrile" documented but temperature ≥ 38 °C', area: 'Vital signs ↔ History', severity: 'high', what: 'History contradicts vitals.', source: 'Documentation integrity' },
  { id: 'VIT-003', name: 'Measured fever not documented', area: 'Vital signs ↔ History', severity: 'low', what: 'Temperature ≥ 38 °C not used to justify services.', source: 'ACS 0002' },
  { id: 'VIT-004', name: 'Heart-rate statement contradicts pulse', area: 'Vital signs ↔ History', severity: 'medium', what: 'Age-adjusted (PALS) ranges.', source: 'PALS' },
  { id: 'VIT-005', name: 'Respiratory distress with normal RR', area: 'Vital signs ↔ History', severity: 'medium', what: 'Age-adjusted RR; SpO₂ expected.', source: 'PALS / NEWS2' },
  { id: 'VIT-006', name: 'Hypotension/shock with normal BP', area: 'Vital signs ↔ History', severity: 'high', what: 'History contradicts vitals.', source: 'Documentation integrity' },
  { id: 'VIT-007', name: 'Severe hypertension not addressed', area: 'Vital signs ↔ History', severity: 'medium', what: 'BP ≥ 180/110 without assessment.', source: 'ESH 2023' },
  { id: 'VIT-008', name: 'Dehydration claimed without signs', area: 'Vital signs ↔ History', severity: 'medium', what: 'Normal pulse/BP and no clinical signs.', source: 'WHO / NICE CG84' },
  { id: 'VIT-009', name: 'Vital signs missing', area: 'Vital signs ↔ History', severity: 'varies', what: 'Temperature, pulse, BP, RR.', source: 'CBAHI / CHI documentation' },
  { id: 'VIT-010', name: 'Implausible vital signs', area: 'Vital signs ↔ History', severity: 'high', what: 'Placeholder or impossible values (temp 1, BP 20/80).', source: 'Data quality' },
  { id: 'VIT-011', name: 'Child medicated without weight', area: 'Vital signs ↔ History', severity: 'high', what: 'Weight-based dosing.', source: 'BNF for Children' },
  { id: 'VIT-012', name: 'Nebulisation without SpO₂', area: 'Vital signs ↔ History', severity: 'medium', what: 'Objective justification.', source: 'GINA' },
  { id: 'DOC-001', name: 'History missing or too brief', area: 'Missing medical data', severity: 'high', what: 'One-line complaints cannot justify services.', source: 'CHI documentation' },
  { id: 'DOC-002', name: 'Duration of complaint missing', area: 'Missing medical data', severity: 'medium', what: 'Duration drives medical necessity.', source: 'Guideline duration criteria' },
  { id: 'DOC-003', name: 'Examination not documented', area: 'Missing medical data', severity: 'high', what: 'No examination findings in the record.', source: 'CHI documentation' },
  { id: 'DOC-004', name: 'Management plan not documented', area: 'Missing medical data', severity: 'medium', what: 'No treatment/advice/follow-up plan.', source: 'CHI documentation' },
  { id: 'DOC-005', name: 'Injury details missing (how / when / where / work-related)', area: 'Missing medical data', severity: 'high', what: 'Mechanism, date/time, place and work-related status are required for every injury.', source: 'CHI policy · ACS 2001' },
  { id: 'DOC-006', name: 'Work-related injury', area: 'Missing medical data', severity: 'critical', what: 'GOSI liability – not the health insurer.', source: 'GOSI Occupational Hazards' },
  { id: 'DOC-007', name: 'Road-traffic accident', area: 'Missing medical data', severity: 'high', what: 'Najm / police report required.', source: 'CHI policy – RTA' },
  { id: 'DOC-008', name: 'Assault', area: 'Missing medical data', severity: 'medium', what: 'Medico-legal documentation.', source: 'MOH medico-legal' },
  { id: 'DOC-009', name: 'Pregnancy without LMP / gestational age', area: 'Missing medical data', severity: 'medium', what: 'Needed for antenatal services.', source: 'NICE NG201' },
  { id: 'SAF-001', name: 'Drug interaction or therapeutic duplication', area: 'Drug safety & interactions', severity: 'varies', what: '40 clinically significant pairs: NSAID duplication, QT-prolonging combinations, chelation, serotonin syndrome, bleeding.', source: 'Lexicomp / Stockley · CredibleMeds' },
  { id: 'SAF-002', name: 'Drug–disease contraindication', area: 'Drug safety & interactions', severity: 'varies', what: 'NSAID with ulcer/CKD, decongestant with hypertension, antimuscarinic with BPH/glaucoma.', source: 'SFDA SPC' },
  { id: 'SAF-003', name: 'Drug to avoid in pregnancy', area: 'Drug safety & interactions', severity: 'varies', what: 'Tetracyclines, quinolones, NSAIDs > 20 wks, ACEi/ARB, statins…', source: 'FDA labelling · SFDA SPC' },
  { id: 'SAF-004', name: 'Age-inappropriate drug', area: 'Drug safety & interactions', severity: 'varies', what: 'Paediatric contraindications and Beers 2023 for ≥ 65 y, plus DDF AGE edits.', source: 'BNF-C · Beers 2023 · CHI DDF' },
  { id: 'SAF-005', name: 'Quantity above an acute course', area: 'Drug safety & interactions', severity: 'medium', what: '≥ 3 packs of the same item.', source: 'NPHIES CV-4-2' },
  { id: 'COD-001', name: 'No diagnosis code', area: 'ICD coding quality', severity: 'critical', what: 'Principal diagnosis required.', source: 'NPHIES' },
  { id: 'COD-002', name: 'Gender-specific code conflict', area: 'ICD coding quality', severity: 'critical', what: 'Obstetric/gynaecological code on a male or vice versa.', source: 'WHO ICD-10 sex edits' },
  { id: 'COD-003', name: 'Age-specific code conflict', area: 'ICD coding quality', severity: 'high', what: 'Perinatal code beyond infancy, obstetric code outside 10–60 y.', source: 'WHO ICD-10 age edits' },
  { id: 'COD-004', name: 'Category header code (incomplete)', area: 'ICD coding quality', severity: 'high', what: 'Codes needing 4th/5th character.', source: 'ICD-10-AM tabular' },
  { id: 'COD-005', name: 'Mutually exclusive codes (Excludes1)', area: 'ICD coding quality', severity: 'medium', what: 'e.g. J00 + J06, K29 + K30.', source: 'ICD-10 Excludes1' },
  { id: 'COD-006', name: 'Symptom coded with its definitive diagnosis', area: 'ICD coding quality', severity: 'low', what: 'e.g. R50 with J03.', source: 'ACS 0001/0002' },
  { id: 'COD-007', name: 'Non-covered or non-specific diagnosis', area: 'ICD coding quality', severity: 'varies', what: 'Routine check-up, fitness exam, infertility, cosmetic.', source: 'CHI Unified Policy' },
  { id: 'COD-008', name: 'Injury without external-cause code', area: 'ICD coding quality', severity: 'medium', what: 'V01–Y98 + place + activity.', source: 'ACS 2001' },
  { id: 'COD-009', name: 'Pregnancy: condition not coded to chapter 15', area: 'ICD coding quality', severity: 'high', what: 'UTI in pregnancy is O23, anaemia O99.0…', source: 'ACS 1500' },
  { id: 'FUP-001', name: 'Consultation within 14-day free follow-up', area: 'Technical & administrative', severity: 'varies', what: 'Same patient, same doctor/specialty, ≤ 14 days.', source: 'NPHIES CV-1-9' },
  { id: 'FUP-002', name: 'Duplicate service on the same invoice', area: 'Technical & administrative', severity: 'high', what: 'Same code twice.', source: 'NPHIES AD-2-4' },
  { id: 'FUP-003', name: 'Refill too soon', area: 'Technical & administrative', severity: 'medium', what: 'Same drug within 20 days.', source: 'PBM edit' },
  { id: 'TEC-PRICE-001', name: 'Service code not in the insurer price list', area: 'Technical & administrative', severity: 'high', what: 'Runs only when that insurer’s price list is uploaded under All files → Reference data; otherwise shown as “Unable to verify”.', source: 'Uploaded insurer price list' },
  { id: 'TEC-PRICE-002', name: 'Unit price differs from the insurer price list', area: 'Technical & administrative', severity: 'medium', what: 'Billed amount ÷ units compared with the contracted price.', source: 'Uploaded insurer price list' },
  { id: 'TEC-PA-001', name: 'Insurer approval required but no approval number', area: 'Technical & administrative', severity: 'high', what: 'Runs only with an uploaded approval list for that insurer.', source: 'Uploaded insurer approval list' },
  { id: 'TEC-FIN-001', name: 'Financial inconsistency on a line', area: 'Technical & administrative', severity: 'high', what: 'Net above billed, or negative net. No assumptions about discount formulas.', source: 'Hospital data-quality rule' },
  { id: 'TEC-GRP-001', name: 'Encounter grouping needs review', area: 'Technical & administrative', severity: 'medium', what: 'Rows grouped by insurer + MRN + service date + physician + encounter type show different complaints, diagnosis sets or repeated consultations.', source: 'Import grouping rule' },
  { id: 'HIST-001', name: 'Historical rejection pattern', area: 'Historical rejection pattern', severity: 'medium', what: `Shown when a service (optionally with the same 3-character diagnosis group) had ≥ 2 rejected out of ≥ 5 comparable submitted lines (≥ 20%) for the same insurer. Descriptive statistics only.`, source: 'Imported claims and linked rejections' },
];

export const ruleName = (id: string) => RULES.find((r) => r.id === id)?.name ?? id;

export const SOURCES: { name: string; use: string }[] = [
  { name: 'CHI Drug Formulary (DDF), 12 Jan 2025 – Indication & SFDA mapping sheets', use: '1,307 active ingredients, 6,904 SFDA products, ICD indications, prescribing edits (PA, QL, MD, AGE, ST, CU, EU), maximum daily doses' },
  { name: 'CHI Unified Health Insurance Policy', use: 'Exclusions (cosmetic, infertility, administrative exams, supplements), follow-up period, work injury and RTA rules' },
  { name: 'NPHIES rejection code set (MN, BE, CV, AD)', use: 'Rejection taxonomy and prevention mapping' },
  { name: 'ICD-10-AM & Australian Coding Standards (ACS 0001, 0002, 1500, 1901, 2001)', use: 'Principal/additional diagnosis, pregnancy precedence, injury and external-cause coding, sex/age edits' },
  { name: 'SFDA Summary of Product Characteristics', use: 'Age limits, pregnancy and disease contraindications' },
  { name: 'ACR Appropriateness Criteria, NICE (NG59, NG84, NG109, NG201, CG84), IDSA, ADA, ACOG, AAO-HNS, GINA, Maastricht VI', use: 'Medical-necessity criteria for labs, imaging and procedures' },
  { name: 'AGS Beers Criteria 2023, BNF for Children, CredibleMeds, Lexicomp/Stockley', use: 'Drug safety, elderly and paediatric prescribing, interaction severity' },
  { name: 'WAD Clinic payer statements (Tawuniya WAC826 07-2026, Bupa CLPROVSTM04 June 2026)', use: 'Observed payer behaviour used to calibrate rules' },
];
