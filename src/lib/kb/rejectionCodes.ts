import type { RejectionGroup } from '../types';

export interface Cause {
  id: string;
  label: string;
  group: RejectionGroup;
  match: RegExp;
  nphies: string;
  /** Prevention playbook shown on the analytics page. */
  prevent: string[];
  appeal: string;
}

/** Ordered: the first matching cause wins. */
export const CAUSES: Cause[] = [
  {
    id: 'MN-DRUG-DX', label: 'Drug not indicated for diagnosis', group: 'Medical', nphies: 'MN-1-1 / PBM',
    match: /not indicated with diagnosis|is not indicated|medication .* not indicated|drug.*diagnosis/i,
    prevent: [
      'Check every prescription against the CHI Drug Formulary (DDF) indication list before submission – this platform does it automatically (Drug ↔ Diagnosis audit).',
      'Code the condition the drug treats, not only the presenting symptom: e.g. pantoprazole needs K21/K25–K30 (not R51 headache or R53 fatigue); ondansetron needs R11 / A08–A09; fusidic-acid/betamethasone cream needs L20/L30 (not H60 otitis externa).',
      'Antibiotics need a bacterial diagnosis (J03.0, J02.0, J01.x, H66.x, L03.x, N39.0); never with J00/J06.9/viral codes.',
      'When a drug is used for a symptom (e.g. antiemetic for vomiting), add that symptom code as a secondary diagnosis.',
    ],
    appeal: 'Appeal only when the note proves an approved indication that was not coded – submit corrected ICD with the clinical note excerpt.',
  },
  {
    id: 'MN-AGE', label: 'Drug/service inconsistent with age or gender', group: 'Medical', nphies: 'MN-1-x / CV',
    match: /inconsistent with the patient'?s? (age|gender|sex)|age limit|not (indicated|allowed) for (age|gender)/i,
    prevent: ['Use paediatric-appropriate products and weight-based dosing; record weight for every child.', 'Respect SFDA/CHI age edits (domperidone < 12 y, metoclopramide < 18 y, codeine/tramadol < 12 y, fluoroquinolones < 18 y, tetracyclines < 8 y).'],
    appeal: 'Appeal with specialist justification and weight-based dose calculation.',
  },
  {
    id: 'MN-QTY', label: 'Quantity / duration exceeds limit', group: 'Medical', nphies: 'CV-4-2',
    match: /quantity|duration adjusted|exceeds the maximum|maximum limit|max(imum)? daily dose/i,
    prevent: ['Bill exactly dose × frequency × days for acute courses (max 7–10 days unless chronic).', 'Topical patches/gels: 1 pack per acute episode; chronic use needs documented chronic diagnosis.'],
    appeal: 'Appeal with documented dosing schedule and chronic diagnosis.',
  },
  {
    id: 'MN-REFILL', label: 'Refill too soon', group: 'Medical', nphies: 'PBM edit',
    match: /refill too soon|early refill|last refilled/i,
    prevent: ['Check the patient’s previous dispensing date (same drug within the course duration).', 'For IV fluids/diluents billed on consecutive visits, bill the volume actually used per visit.'],
    appeal: 'Appeal with documentation of lost medication, dose change or new episode.',
  },
  {
    id: 'MN-JUSTIFY', label: 'Not clinically justified (no supporting diagnosis)', group: 'Medical', nphies: 'MN-1-1',
    match: /not clinically justified|clinical practice guideline|supporting diagnosis|medical necessity|medically necessary|not justified/i,
    prevent: [
      'Every lab/imaging/procedure must answer a documented clinical question: code the diagnosis or red-flag symptom that justifies it.',
      'IV infusion/IV administration: document dehydration signs (pulse, mucosa, intake, number of vomits) and code E86.0 – not justified for URTI, pharyngitis, isolated fever.',
      'CBC/CRP in respiratory infections: document duration (> 5–7 days), fever ≥ 3 days, productive sputum, chest signs – or skip the test.',
      'Blood group/Rh: once per pregnancy at booking; code Z34.0x/Z34.8x + Z36 and write "booking visit".',
      'Abdominal ultrasound: code the suspected pathology (K80 gallstones, N20 stones, K35 appendicitis) and examination findings, not just R10.4.',
    ],
    appeal: 'Appeal with guideline citation + patient-specific findings (duration, vitals, exam) – generic guideline text alone is usually re-rejected.',
  },
  {
    id: 'TC-FOLLOWUP', label: 'Follow-up within free period / same physician', group: 'Technical', nphies: 'CV-1-9',
    match: /same physi|follow.?up period|free follow|within .*follow|14.?day/i,
    prevent: ['Do not bill a consultation for the same patient, same doctor/specialty and same complaint within 14 days.', 'If it is a new complaint, document “new complaint, unrelated to visit of DD/MM” with a different diagnosis code.', 'Configure the HIS to flag revisits within 14 days at registration.'],
    appeal: 'Appeal only for genuinely new conditions with a different diagnosis.',
  },
  {
    id: 'TC-PRICE', label: 'Out of price list / not in contract', group: 'Technical', nphies: 'BE-1-3',
    match: /out of price list|not part of the agreed price ?list|out of validity|price ?list|not in (the )?contract|non.?contract/i,
    prevent: ['Map every HIS item to the payer’s contracted price-list code (CHI/NPHIES service code) before go-live of a new item/brand.', 'Prefer contracted brands; for new SFDA products request price-list addition from the payer.', 'Audit the pharmacy master monthly against the payer price list.'],
    appeal: 'Appeal with contract annex showing the item/price; otherwise request price-list update.',
  },
  {
    id: 'TC-PREAUTH', label: 'Pre-authorisation missing / rejected', group: 'Technical', nphies: 'BE-1-4',
    match: /pre.?auth|preauthori|prior auth|approval (required|not obtained)|rejected\/cancelled at preauthorization/i,
    prevent: ['Request approval before services that need it (imaging, procedures, specialty drugs) and attach the approval number.', 'Do not bill services that were rejected at pre-authorisation unless re-approved.'],
    appeal: 'Appeal only with an approval number or emergency documentation.',
  },
  {
    id: 'TC-DUP', label: 'Duplicate billing', group: 'Technical', nphies: 'AD-2-4',
    match: /duplicate|repeated billing|already (billed|paid|settled)/i,
    prevent: ['Bill each service once per date; split visits must not repeat the same code.', 'Check for duplicate invoices before batch closure.'],
    appeal: 'Appeal with proof of two separate services (time, site, laterality).',
  },
  {
    id: 'TC-BILLING', label: 'Incorrect billing / invalid code', group: 'Technical', nphies: 'BE-1-x',
    match: /billing regime|incorrect billing|invalid (service )?code|wrong code|code not valid/i,
    prevent: ['Bill medications under the medication benefit (not as procedure/consumable) and use the SFDA code.', 'Validate service codes against the current NPHIES code-set.'],
    appeal: 'Re-submit with the correct code/benefit type.',
  },
  {
    id: 'TC-DEDUCT', label: 'Deductible / co-pay difference', group: 'Technical', nphies: 'BE-1-1',
    match: /co.?pay|deductible|patient share/i,
    prevent: ['Collect the policy co-pay at reception (per class and service type) and send it on the claim.', 'Keep the payer’s deductible table updated in the HIS.'],
    appeal: 'Not appealable – fix collection process.',
  },
  {
    id: 'TC-COVER', label: 'Not covered / policy exclusion', group: 'Technical', nphies: 'CV-x',
    match: /not covered|exclusion|excluded|benefit limit|outside coverage/i,
    prevent: ['Check eligibility & benefits in NPHIES before the service.', 'Bill excluded items (cosmetics, supplements, administrative exams) as cash with patient consent.'],
    appeal: 'Appeal only if the policy schedule shows the benefit.',
  },
  {
    id: 'TC-ELIG', label: 'Membership / eligibility', group: 'Technical', nphies: 'EL-x',
    match: /membership|eligib|inactive|terminated|not found/i,
    prevent: ['Run NPHIES eligibility check at every registration and store the response.'],
    appeal: 'Appeal with the eligibility response from the service date.',
  },
];

export const OTHER_CAUSE: Cause = {
  id: 'OTHER', label: 'Reason not stated / other', group: 'Technical', nphies: '—', match: /$^/,
  prevent: ['Ask the payer for the specific rejection code (NPHIES requires a coded reason).'],
  appeal: 'Request clarification.',
};

export function classify(reason: string, nphiesCode = ''): Cause {
  const text = `${reason} ${nphiesCode}`;
  for (const c of CAUSES) if (c.match.test(text)) return c;
  if (/^MN/i.test(nphiesCode)) return CAUSES.find((c) => c.id === 'MN-JUSTIFY')!;
  if (/^CV-1-9/i.test(nphiesCode)) return CAUSES.find((c) => c.id === 'TC-FOLLOWUP')!;
  if (/^BE-1-4/i.test(nphiesCode)) return CAUSES.find((c) => c.id === 'TC-PREAUTH')!;
  if (/^BE-1-3/i.test(nphiesCode)) return CAUSES.find((c) => c.id === 'TC-PRICE')!;
  if (/^AD/i.test(nphiesCode)) return CAUSES.find((c) => c.id === 'TC-DUP')!;
  return OTHER_CAUSE;
}

export const causeById = (id: string) => CAUSES.find((c) => c.id === id) ?? OTHER_CAUSE;
