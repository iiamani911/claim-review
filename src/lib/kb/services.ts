/**
 * Diagnosis ↔ service medical-necessity knowledge base for outpatient / ER services.
 *
 * Each rule says which ICD-10 groups justify a service, which ICDs justify it only when the note documents
 * specific findings, and what the doctor should add. Sources: CHI Unified Health Insurance Policy (medical
 * necessity clause), NPHIES rejection code MN-1-1, ICD-10-AM/ACS coding standards, NICE / ACR Appropriateness
 * Criteria / IDSA / ACOG / Maastricht VI guidance, and payer behaviour observed in WAD Clinic statements.
 */

export interface Conditional {
  icd: string[];
  /** Note must document one of these findings. */
  needs: RegExp;
  needsLabel: string;
}

export interface ServiceRule {
  id: string;
  /** Note content that makes the service NOT indicated (e.g. imaging for functional constipation in a child). */
  contra?: { re: RegExp; maxAge?: number; why: string };
  label: string;
  match: RegExp;
  /** ICD prefixes that justify the service on their own. */
  icd: string[];
  conditional?: Conditional[];
  /** Clinical words in the note that would justify it if the right ICD were added. */
  noteHint?: RegExp;
  suggest: string;
  why: string;
  refs: string[];
  gender?: 'F' | 'M';
  minAge?: number;
  maxAge?: number;
  /** Frequently non-covered or needs pre-authorisation under CHI policy. */
  coverageNote?: string;
}

const FEVER_RED_FLAGS = /(fever|febrile|temp(erature)?)[^.]{0,40}(\b([3-9]|1\d)\s*(days?|d)\b|week|persistent|high[- ]grade)|(\b([5-9]|1\d)\s*days?|week|weeks)[^.]{0,60}(fever|cough|symptom)|toxic|lethargic|sepsis|productive|sputum|crepitation|crackles|consolidation|petechia|immunocomp|neutropen|hypoxi|spo2\s*(8\d|9[0-3])/i;
const ACUTE_ABD = /sever|guarding|rebound|rigid|rlq|right iliac|mcburney|tender|blood|melena|bleed|weight loss|anemi|anaemi|pale|jaundice|mass|distension|persistent|recurrent|chronic|\b([2-9]|\d{2})\s*(weeks?|months?)\b/i;
const DEHYDRATION = /dehydrat|dry (mucosa|mouth|tongue)|sunken|poor (oral )?intake|unable to (tolerate|keep|drink)|not tolerating|decreased oral|reduced oral|persistent vomit|repeated vomit|multiple (episodes|times)|intractable|tachycard|hypotens|capillary refill|oliguri|lethargic|weak pulse|\b([4-9]|\d{2})\s*(episodes|times)\b/i;
const SEVERE = /sever|intense|excruciating|unbearable|intractable|\b([7-9]|10)\s*\/\s*10\b|pain score\s*[7-9]|unable to (tolerate|swallow|walk|move)|distress|status|failed oral|not responding|no response|vomiting/i;

export const SERVICE_RULES: ServiceRule[] = [
  // ───────────────────────── LABORATORY ─────────────────────────
  {
    id: 'LAB-CBC', label: 'Complete blood count (CBC)', match: /\bcbc\b|complete blood|blood (cell )?count|haemogram|hemogram/i,
    icd: ['D5', 'D6', 'D7', 'D8', 'C', 'J12', 'J13', 'J14', 'J15', 'J16', 'J17', 'J18', 'J85', 'J86', 'K35', 'K36', 'K37', 'K50', 'K51', 'K57', 'K92', 'K65', 'N10', 'N12', 'L03', 'L02', 'A0', 'A1', 'A4', 'A9', 'B5', 'B15', 'B16', 'B17', 'O', 'Z34', 'Z36', 'Z01.81', 'Z01.818', 'R58', 'R23.3', 'R59', 'R63.4', 'N92', 'M05', 'M06', 'M32', 'I33', 'T78', 'E86', 'Z79'],
    conditional: [
      { icd: ['R50', 'J00', 'J01', 'J02', 'J03', 'J04', 'J06', 'J20', 'J21', 'J22', 'R05', 'J40', 'J45', 'A08', 'A09'], needs: FEVER_RED_FLAGS, needsLabel: 'fever > 3 days, symptoms ≥ 5–7 days, productive sputum, chest signs, toxic look' },
      { icd: ['R10', 'K59', 'K29', 'K30', 'R11'], needs: ACUTE_ABD, needsLabel: 'severe/localised tenderness, guarding, bleeding, weight loss or pallor' },
      { icd: ['R53', 'R42', 'R55', 'L65'], needs: /pale|pallor|anemi|anaemi|fatig|weak|menorrh|heavy (menses|period)|weight loss|\b([2-9]|\d{2})\s*(weeks?|months?)\b/i, needsLabel: 'pallor, heavy menses, chronic fatigue ≥ 2 weeks' },
    ],
    noteHint: /pale|pallor|anemi|anaemi|bleed|infection|pus|abscess|pre.?op|surgery|planned for/i,
    suggest: 'Add the condition the CBC answers: e.g. J18.9 pneumonia (crepitations), J03.9 + R50.9 with fever ≥ 3 days, D64.9 anaemia (pallor), K35.8 suspected appendicitis, R63.4 weight loss.',
    why: 'Routine CBC in uncomplicated viral URTI, common cold, 1-day fever or acute gastroenteritis is not supported by NICE NG84/CG69 & IDSA; payer applies MN-1-1 unless red flags or a haematological/infective indication are coded.',
    refs: ['CHI Unified Policy – medical necessity', 'NPHIES MN-1-1', 'NICE NG84 / CG160 (fever in under 5s)', 'IDSA pharyngitis guideline'],
  },
  {
    id: 'LAB-CRP', label: 'CRP / ESR', match: /\bcrp\b|c-?reactive|\besr\b|sedimentation/i,
    icd: ['M05', 'M06', 'M08', 'M30', 'M31', 'M32', 'M33', 'M34', 'M35', 'M45', 'M46', 'M00', 'M86', 'K50', 'K51', 'J12', 'J13', 'J14', 'J15', 'J16', 'J18', 'N10', 'L03', 'L02', 'K35', 'K36', 'K37', 'I30', 'I33', 'A4', 'M10', 'M13', 'C'],
    conditional: [
      { icd: ['R50', 'J02', 'J03', 'J06', 'J20', 'J01', 'A09', 'R10', 'M25', 'M79', 'R52', 'M54'], needs: new RegExp(FEVER_RED_FLAGS.source + '|swelling|swollen|warm joint|morning stiffness|inflammat|night pain', 'i'), needsLabel: 'persistent fever, joint swelling/morning stiffness, suspected bacterial infection' },
    ],
    suggest: 'Code the inflammatory/bacterial condition suspected (e.g. M06.9 RA, M13.0 polyarthritis, J18.9, L03.x) and document duration and inflammatory signs.',
    why: 'CRP/ESR are acceptable to separate bacterial from viral illness only with red flags; as a routine test for URTI/myalgia they are rejected (MN-1-1).',
    refs: ['NICE NG143 / NG237', 'NPHIES MN-1-1'],
  },
  {
    id: 'LAB-BLOODGROUP', label: 'Blood group & Rh typing', match: /blood (group|typing)|\babo\b|rh (typing|phenotyp)|grouping/i,
    icd: ['Z36', 'O36.0', 'O36.1', 'O20', 'O46', 'O67', 'O72', 'O00', 'O03', 'O08', 'Z01.81', 'Z01.818', 'D5', 'D6', 'R58', 'K92', 'N92'],
    conditional: [{ icd: ['Z34', 'Z33', 'Z35', 'Z3A', 'O', 'Z32'], needs: /booking|first (antenatal|anc|visit)|1st (anc|visit)|initial (antenatal|visit)|new pregnan|blood group (is )?(not known|unknown)|unknown blood group|no previous (blood group|record)|rh negative|rh -ve/i, needsLabel: 'first antenatal booking visit / blood group unknown (payers pay once per pregnancy)' }],
    suggest: 'For antenatal booking code Z34.0x/Z34.8x (specific trimester) + Z36 antenatal screening and write "first antenatal booking visit – blood group/Rh unknown". Once per pregnancy only.',
    why: 'ACOG/NICE NG201: ABO & Rh typing is a booking-visit test. Payers reject repeats and claims coded only Z34.9 without booking documentation; outside pregnancy it needs pre-op/transfusion/bleeding indication.',
    refs: ['NICE NG201 Antenatal care', 'ACOG Practice Bulletin 181', 'Observed: Tawuniya MN-1-1 ×3 (Z34.9)'],
  },
  {
    id: 'LAB-UA', label: 'Urinalysis', match: /urine ?analysis|urinalysis|urine (routine|r\/m|re\b|exam)|\bu\/?a\b|urine dip/i,
    icd: ['N', 'R30', 'R31', 'R32', 'R33', 'R34', 'R35', 'R36', 'R39', 'R10', 'O', 'Z34', 'Z36', 'E10', 'E11', 'E13', 'E14', 'I10', 'I15', 'R50', 'R82', 'A56', 'M54.5', 'R60', 'Z01.81', 'D59', 'M32'],
    suggest: 'Add N39.0 UTI, R30.0 dysuria, N23 renal colic, R10.2/R10.3 lower abdominal pain or the pregnancy code.',
    why: 'Urinalysis must be linked to urinary symptoms, abdominal/flank pain, fever without focus, pregnancy, diabetes or hypertension follow-up.',
    refs: ['NICE NG109 UTI', 'NPHIES MN-1-1'],
  },
  {
    id: 'LAB-UCULT', label: 'Urine culture & sensitivity', match: /urine (culture|c\/s|c&s|sensitiv)|culture.*urine/i,
    icd: ['N10', 'N11', 'N12', 'N13', 'N15', 'N30', 'N34', 'N39.0', 'N41', 'O23', 'O86.2', 'N20', 'N13'],
    conditional: [
      { icd: ['R30', 'R35', 'R39', 'R50', 'Z34', 'O'], needs: /dysuri|burning|frequen|urgen|suprapubic|flank|loin|fever|recurrent|pyuria|nitrite|leucocyte|leukocyte|pus cells|bacteriuria|asymptomatic bacteriuria/i, needsLabel: 'urinary symptoms, positive dipstick (nitrite/leucocytes) or antenatal screening' },
    ],
    suggest: 'Code N39.0 / N30.0 / O23.x (UTI in pregnancy) and document dipstick or symptoms; for antenatal screening document "routine antenatal asymptomatic bacteriuria screening".',
    why: 'Culture is justified for complicated/recurrent UTI, pregnancy, men, children and pyelonephritis — not for symptom codes alone.',
    refs: ['NICE NG109', 'IDSA asymptomatic bacteriuria 2019'],
  },
  {
    id: 'LAB-STOOL', label: 'Stool analysis / culture', match: /stool|fecal|faecal|occult blood|\bfob\b/i,
    icd: ['A0', 'K52', 'K58', 'K59.1', 'K92', 'K50', 'K51', 'K90', 'B6', 'B7', 'B8', 'D50', 'R19.4', 'R19.5', 'R19.7', 'K62.5', 'K63'],
    conditional: [{ icd: ['R10', 'R11', 'K30', 'K29'], needs: /diarr|loose|watery|blood|mucus|worm|parasite/i, needsLabel: 'diarrhoea, blood/mucus or parasites' }],
    suggest: 'Code A09.x/K52.9 diarrhoea or R19.5 positive occult blood; document number of stools/day and blood/mucus.',
    why: 'Stool tests require diarrhoea, GI bleeding or parasitic suspicion.',
    refs: ['WHO diarrhoea guideline', 'NPHIES MN-1-1'],
  },
  {
    id: 'LAB-HBA1C', label: 'HbA1c', match: /hba1c|glycated|glycosylated/i,
    icd: ['E10', 'E11', 'E12', 'E13', 'E14', 'R73', 'O24', 'E28.2', 'Z86.32'],
    conditional: [{ icd: ['E66', 'E78', 'I10', 'Z83.3', 'R63', 'R35', 'L83', 'N18'], needs: /diabet|family history|fh\b|obes|bmi|polyuria|polydips|prediab|acanthosis|weight/i, needsLabel: 'diabetes risk factor (obesity, family history, prediabetes)' }],
    suggest: 'Code E11.x (known diabetes) or R73.0x prediabetes; for screening document the risk factor (BMI, family history).',
    why: 'ADA Standards: HbA1c for diagnosis/monitoring (every 3 months if uncontrolled, 6 months if stable). Without diabetes/risk-factor coding it is treated as screening (often excluded).',
    refs: ['ADA Standards of Care 2026', 'CHI policy – screening exclusions'],
  },
  {
    id: 'LAB-GLU', label: 'Blood glucose', match: /glucose|\brbs\b|\bfbs\b|blood sugar/i,
    icd: ['E10', 'E11', 'E12', 'E13', 'E14', 'R73', 'O24', 'E16', 'R55', 'R40', 'R35', 'R63.1', 'E66', 'Z34', 'O', 'E28.2', 'R56', 'R42', 'R53', 'E86', 'A09', 'R11', 'I10'],
    suggest: 'Code diabetes / R73 / syncope / dizziness or document why glucose was measured.',
    why: 'Point-of-care glucose is accepted with diabetes, altered consciousness, dizziness, vomiting in children or pregnancy.',
    refs: ['ADA Standards of Care'],
  },
  {
    id: 'LAB-LIPID', label: 'Lipid profile', match: /lipid|cholesterol|triglycer|\bldl\b|\bhdl\b/i,
    icd: ['E78', 'E10', 'E11', 'E13', 'E14', 'I10', 'I11', 'I12', 'I13', 'I15', 'I20', 'I21', 'I22', 'I24', 'I25', 'I63', 'I64', 'I70', 'I73', 'E66', 'Z82.4', 'Z83.42', 'N18', 'E03', 'K76.0', 'E28.2'],
    suggest: 'Code E78.x, diabetes, hypertension or cardiovascular disease; for screening document risk factors.',
    why: 'Lipid testing is accepted for cardiovascular risk management; on acute visits without risk coding it is rejected.',
    refs: ['ESC/EAS dyslipidaemia guideline', 'NPHIES MN-1-1'],
  },
  {
    id: 'LAB-THYROID', label: 'Thyroid function (TSH / FT4 / FT3)', match: /\btsh\b|thyroid stim|\bft4\b|\bft3\b|free thyrox|thyroxine|\bt3\b|\bt4\b/i,
    icd: ['E00', 'E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E07', 'E89.0', 'C73', 'Z85.85', 'N91', 'N92', 'N93', 'N97', 'E28', 'R00', 'R63', 'O99.2', 'R94.6', 'E23', 'L65', 'F32', 'F41', 'R61', 'G56.0', 'E66', 'R62', 'E34.3', 'Z79.899'],
    conditional: [{ icd: ['R53', 'R42', 'Z34', 'O', 'K59', 'R50', 'L60'], needs: /fatig|weight (gain|loss)|cold intoleran|heat intoleran|palpitat|tremor|goit|neck swell|hair loss|constipat|thyroid|levothyrox|euthyrox|carbimazole|menstrual|irregular/i, needsLabel: 'thyroid symptoms (fatigue+weight change, palpitations, goitre) or thyroid history/treatment' }],
    noteHint: /thyroid|levothyrox|euthyrox|goit|hypothyroid|hyperthyroid/i,
    suggest: 'Code the thyroid disorder (E03.9 hypothyroidism, E05.x, E04.x goitre, E89.0 post-ablation, Z79.899 on levothyroxine) or the symptom complex.',
    why: 'TSH is justified for thyroid disease follow-up and for specific symptoms; ordering it with unrelated diagnoses (URTI, gastritis) triggers MN-1-1.',
    refs: ['ATA/AACE hypothyroidism guideline', 'NPHIES MN-1-1'],
  },
  {
    id: 'LAB-VITD', label: 'Vitamin D (25-OH)', match: /vitamin d|25.?hydroxy|25.?oh|calciferol/i,
    icd: ['E55', 'E20', 'E21', 'E83.5', 'M80', 'M81', 'M82', 'M83', 'N18', 'N25.0', 'K90', 'K50', 'K51', 'E66.01', 'Z79.52', 'Z79.899', 'E64.3', 'M88', 'K91.2'],
    suggest: 'Code E55.9 (known deficiency on treatment – follow-up), M81.x osteoporosis, N18.x CKD or K90.x malabsorption, and document the risk factor.',
    why: 'Endocrine Society & Choosing Wisely: no population screening for vitamin D. Most Saudi payers cover it only for documented deficiency follow-up or high-risk conditions.',
    refs: ['Endocrine Society 2024 Vitamin D guideline', 'Choosing Wisely', 'CHI policy – screening exclusions'],
    coverageNote: 'Frequently excluded as screening.',
  },
  {
    id: 'LAB-B12', label: 'Vitamin B12 / folate', match: /b12|cobalamin|folate|folic/i,
    icd: ['D51', 'D52', 'D53', 'G62', 'G63', 'E53', 'K90', 'K29.4', 'K29.5', 'R20', 'R41', 'F03', 'Z79.84', 'D64.9', 'G60', 'K91.2', 'G95.89', 'R26'],
    conditional: [{ icd: ['R53', 'R42', 'E11', 'K21', 'K30'], needs: /numb|tingl|paraesthe|paresthe|burning (sensation|feet)|neuropath|metformin|ppi|vegan|macrocyt|memory/i, needsLabel: 'neuropathy symptoms, metformin/PPI long-term use or macrocytosis' }],
    suggest: 'Code D51.x / D53.x anaemia, G62.9 neuropathy or R20.2 paraesthesia, and document the risk (metformin, PPI, vegan diet).',
    why: 'B12 testing needs a haematological/neurological indication or a documented risk factor.',
    refs: ['BSH Cobalamin & folate guideline', 'NPHIES MN-1-1'],
  },
  {
    id: 'LAB-IRON', label: 'Iron / ferritin / TIBC', match: /ferritin|\biron\b|\btibc\b|transferrin/i,
    icd: ['D50', 'D63', 'D64', 'D56', 'D57', 'D58', 'O99.0', 'N92', 'N93', 'K90', 'K92', 'E83.1', 'L65', 'N18', 'R63', 'K50', 'K51'],
    conditional: [{ icd: ['R53', 'R42', 'Z34', 'O', 'L60'], needs: /pale|pallor|anemi|anaemi|fatig|heavy|menorrh|hair loss|low (hb|hemoglobin|haemoglobin)/i, needsLabel: 'pallor, low Hb, heavy menses or hair loss' }],
    suggest: 'Code D50.9 iron-deficiency anaemia, N92.0 menorrhagia or O99.0 anaemia in pregnancy.',
    why: 'Iron studies require suspected iron deficiency or iron overload.',
    refs: ['BSG iron deficiency guideline 2021'],
  },
  {
    id: 'LAB-RENAL', label: 'Renal function (creatinine / urea / electrolytes)', match: /creatinin|\burea\b(?!\s*breath)|\bbun\b|renal function|kidney function|\brft\b|\bkft\b|electrolyt|sodium|potassium|\bu&e\b/i,
    icd: ['N0', 'N1', 'N2', 'I10', 'I11', 'I12', 'I13', 'I15', 'I50', 'E10', 'E11', 'E13', 'E14', 'E86', 'E87', 'A0', 'R34', 'R60', 'R11', 'O14', 'O21', 'M10', 'Z79', 'Z01.81', 'E27', 'E24', 'T50', 'D59', 'M32', 'G93'],
    conditional: [{ icd: ['R10', 'K29', 'K30', 'R42', 'R53', 'J06', 'R50'], needs: DEHYDRATION, needsLabel: 'dehydration signs, persistent vomiting/diarrhoea or nephrotoxic drug use' }],
    suggest: 'Code E86.0 dehydration, N23 renal colic, I10 hypertension or Z79.1 long-term NSAID use, with the clinical sign.',
    why: 'Renal tests are needed for CKD/HTN/DM monitoring, dehydration, renal colic, pre-contrast and nephrotoxic drugs.',
    refs: ['KDIGO 2024', 'NPHIES MN-1-1'],
  },
  {
    id: 'LAB-LFT', label: 'Liver function tests', match: /\balt\b|\bast\b|sgpt|sgot|alanine|aspartate|bilirubin|alkaline phosph|\balp\b|\bggt\b|liver function|\blft\b|albumin/i,
    icd: ['K70', 'K71', 'K72', 'K73', 'K74', 'K75', 'K76', 'K77', 'K80', 'K81', 'K82', 'K83', 'K85', 'K86', 'B15', 'B16', 'B17', 'B18', 'B19', 'R17', 'R16', 'R74', 'R10.1', 'R10.11', 'E66', 'E78', 'Z79', 'O26.6', 'O99.6', 'C22', 'D58', 'P59', 'E83.0', 'E83.1'],
    conditional: [{ icd: ['R10', 'R11', 'K29', 'K30', 'R53', 'A09'], needs: /jaundice|yellow|dark urine|right (upper|hypochond)|rt\.? hypochond|ruq|hepat|liver|fatty|alcohol|pale stool/i, needsLabel: 'RUQ pain, jaundice, dark urine or known liver disease' }],
    suggest: 'Code R10.11/R10.1 RUQ pain, K76.0 fatty liver, K80.x gallstones, R17 jaundice or Z79.899 drug monitoring.',
    why: 'LFTs need hepatobiliary symptoms, liver disease or hepatotoxic-drug monitoring.',
    refs: ['ACG abnormal liver chemistry guideline 2017'],
  },
  {
    id: 'LAB-URIC', label: 'Uric acid', match: /uric acid|urate/i,
    icd: ['M10', 'M1A', 'N20', 'E79', 'N18', 'C9', 'O14', 'M13', 'M25.57', 'M25.47', 'M79.67', 'E88.3'],
    conditional: [{ icd: ['M25', 'M79', 'M77'], needs: /gout|big toe|first mtp|hallux|swelling|swollen|red|hot joint|tophi/i, needsLabel: 'acute monoarthritis / big toe swelling' }],
    suggest: 'Code M10.x gout or N20.x urolithiasis; document joint swelling/redness.',
    why: 'Uric acid is not a screening test; ACR gout guideline links it to gout diagnosis/management.',
    refs: ['ACR Gout guideline 2020'],
  },
  {
    id: 'LAB-HORM', label: 'Reproductive hormones (Prolactin / FSH / LH / AMH / Estradiol / Testosterone)', match: /prolactin|\bfsh\b|\blh\b|follicle stim|luteiniz|\bamh\b|anti.?mull|estradiol|oestradiol|testosterone|progesteron/i,
    icd: ['N91', 'N92', 'N93', 'N94', 'N95', 'N64.3', 'E22', 'E23', 'E28', 'E29', 'E30', 'E34.3', 'L68', 'L65', 'N52', 'R62.5', 'E66', 'D35.2', 'O02', 'O03', 'O20', 'O26.2'],
    conditional: [{ icd: ['N97', 'N46', 'Z31'], needs: /./, needsLabel: 'infertility work-up' }],
    suggest: 'Code N91.x amenorrhoea/oligomenorrhoea, E28.2 PCOS, N64.3 galactorrhoea, L68.0 hirsutism.',
    why: 'Hormone panels need a menstrual/endocrine indication. Infertility work-up (N97/N46/Z31) is excluded under the CHI Unified Policy unless the policy has an explicit benefit.',
    refs: ['CHI Unified Policy – exclusions (infertility)', 'Endocrine Society PCOS / hyperprolactinaemia guideline'],
    coverageNote: 'Infertility investigations are a CHI policy exclusion.',
  },
  {
    id: 'LAB-HCG', label: 'Pregnancy test (β-hCG)', match: /hcg|pregnancy test|\bupt\b|beta.?h/i,
    icd: ['O', 'Z32', 'Z33', 'Z34', 'Z3A', 'N91', 'N92', 'N93', 'N94', 'N95', 'R10', 'N83', 'N70', 'N73', 'R11', 'Z01.81', 'Z30', 'D39.2'],
    gender: 'F', minAge: 9, maxAge: 60,
    suggest: 'Code N91.x amenorrhoea, Z32.0x pregnancy test or O-code; document LMP.',
    why: 'β-hCG needs a pregnancy question (missed period, pain in reproductive-age female, pre-procedure). Quantitative β-hCG serial testing needs O00–O03 suspicion.',
    refs: ['ACOG Practice Bulletin 193 (ectopic)'],
  },
  {
    id: 'LAB-HPYLORI', label: 'H. pylori test', match: /pylori|\bubt\b|urea breath/i,
    icd: ['K25', 'K26', 'K27', 'K28', 'K29', 'K30', 'K31.8', 'R10.1', 'R10.13', 'D50', 'C16', 'C88.4', 'Z86.010', 'D69.3', 'B96.81'],
    suggest: 'Code K30 functional dyspepsia / K29.x gastritis / R10.13 epigastric pain. Prefer urea breath test or stool antigen; serology (IgG) is not recommended for active infection.',
    why: 'Maastricht VI/Florence: test-and-treat for dyspepsia/peptic ulcer; not for GERD (K21) alone. Serology cannot confirm active infection or eradication.',
    refs: ['Maastricht VI/Florence consensus 2022', 'ACG H. pylori guideline 2024'],
  },
  {
    id: 'LAB-SEROLOGY', label: 'Hepatitis / HIV / Rubella serology', match: /hbs ?ag|hepatitis|\bhcv\b|\bhiv\b|rubella|toxoplasm|\btorch\b|vdrl|syphil/i,
    icd: ['O', 'Z34', 'Z36', 'Z3A', 'B15', 'B16', 'B17', 'B18', 'B19', 'B20', 'R17', 'R74', 'K70', 'K71', 'K72', 'K73', 'K74', 'K75', 'K76', 'Z01.81', 'Z20', 'Z11', 'Z31', 'Z32', 'A50', 'A51', 'A52', 'A53', 'D69.6', 'N18.6', 'Z99.2'],
    suggest: 'Code the antenatal visit (Z34.x + Z36), the exposure (Z20.x) or abnormal LFT (R74.0).',
    why: 'Viral serology is justified for antenatal screening, exposure, abnormal LFT or pre-procedure policy.',
    refs: ['NICE NG201 Antenatal care', 'WHO hepatitis B guideline'],
  },
  {
    id: 'LAB-COAG', label: 'Coagulation (PT/INR/aPTT)', match: /\bpt\b|\binr\b|aptt|\bptt\b|prothrombin|thromboplastin|coagulation|d.?dimer|fibrinogen/i,
    icd: ['D65', 'D66', 'D67', 'D68', 'D69', 'Z79.01', 'Z79.02', 'K70', 'K72', 'K74', 'K76', 'Z01.81', 'Z01.818', 'R58', 'R04', 'N92', 'I26', 'I80', 'I82', 'I48', 'O', 'R23.3', 'T45.5', 'K92'],
    noteHint: /pre.?op|surgery|surgical|planned for|adenotonsillectomy|tonsillectomy|operation|bleeding tendency|easy bruis/i,
    suggest: 'Code Z79.01 long-term anticoagulant, D68.x/D69.x, pre-operative Z01.81 or bleeding (R04.0 recurrent epistaxis, N92.0).',
    why: 'Coagulation screens are rejected as routine tests; need anticoagulation, bleeding history, liver disease or a planned procedure.',
    refs: ['BSH pre-operative bleeding assessment guideline', 'Choosing Wisely'],
  },
  {
    id: 'LAB-CARDIAC', label: 'Cardiac markers (troponin/CK-MB)', match: /troponin|ck.?mb|cardiac enzym/i,
    icd: ['I20', 'I21', 'I22', 'I24', 'I25', 'I30', 'I40', 'I48', 'I49', 'I50', 'R07', 'R00', 'R06', 'R55', 'R94.31', 'T81'],
    suggest: 'Code R07.4 chest pain / I20.x and document the pain character and ECG.',
    why: 'Troponin needs suspected ACS / myocarditis.',
    refs: ['ESC NSTE-ACS guideline 2023'],
  },
  {
    id: 'LAB-RHEUM', label: 'RF / ASO / ANA / anti-CCP', match: /\bana\b|antinuclear|rheumatoid factor|\brf\b|anti.?ccp|\baso\b|antistreptolysin|hla.?b27/i,
    icd: ['M05', 'M06', 'M08', 'M13', 'M32', 'M33', 'M34', 'M35', 'M45', 'M02', 'I00', 'I01', 'I02', 'N00', 'N05', 'L93', 'J02.0', 'J03.0', 'M25.5', 'M79.7', 'R76'],
    suggest: 'Code M13.0 polyarthritis / M06.9 / M25.5x with documented joint swelling or morning stiffness ≥ 6 weeks.',
    why: 'Autoimmune serology is for suspected inflammatory arthritis/CTD (ACR/EULAR 2010), not for non-specific aches.',
    refs: ['ACR/EULAR RA classification 2010'],
  },
  {
    id: 'LAB-PSA', label: 'PSA', match: /\bpsa\b|prostate specific/i,
    icd: ['N40', 'N41', 'N42', 'C61', 'R39', 'R31', 'R97.2', 'Z12.5', 'Z80.42', 'N13.8'], gender: 'M', minAge: 40,
    suggest: 'Code N40.x/R39.1 LUTS or Z12.5 with shared decision documented (age 50–69).',
    why: 'PSA is male-only and needs LUTS, follow-up or documented screening discussion (EAU/AUA).',
    refs: ['EAU prostate cancer guideline 2025', 'AUA'],
  },
  {
    id: 'LAB-ALLERGY', label: 'Allergy / IgE panel', match: /\bige\b|allergy (panel|test)|immunocap|\brast\b|skin prick/i,
    icd: ['J45', 'J30', 'L50', 'L20', 'T78', 'K52.2', 'Z91.0', 'L23', 'T88.6', 'K20.0'],
    suggest: 'Code J30.x/J45.x/L20.x with documented failure of avoidance/first-line treatment.',
    why: 'Total IgE and broad panels without a defined allergic disease are rejected; many policies limit allergy testing.',
    refs: ['EAACI/AAAAI practice parameters'], coverageNote: 'Often limited by policy benefit.',
  },
  {
    id: 'LAB-STREP', label: 'Throat swab / rapid strep / culture', match: /throat (swab|culture)|rapid strep|strep (a|test)|\bgas\b antigen/i,
    icd: ['J02', 'J03', 'J35', 'J36', 'B95.0', 'Z22.3'],
    suggest: 'Code J02.9/J03.9 and document Centor/McIsaac score ≥ 2.',
    why: 'IDSA: test only when clinical features suggest GAS (Centor ≥ 2); not for viral features (cough, rhinorrhoea).',
    refs: ['IDSA GAS pharyngitis 2012'],
  },
  {
    id: 'LAB-RESP', label: 'Respiratory virus PCR / influenza / COVID test', match: /covid|sars|influenza|\bflu\b|\brsv\b|respiratory (panel|pcr)|pcr/i,
    icd: ['U07', 'J09', 'J10', 'J11', 'J12', 'J18', 'J21', 'Z20.8', 'Z20.822', 'J22'],
    conditional: [{ icd: ['R50', 'J06', 'J02', 'R05', 'J20', 'B34'], needs: /high risk|elderly|pregnan|immuno|chronic|asthma|copd|diabet|contact|outbreak|hospital|sever|spo2|hypox/i, needsLabel: 'high-risk patient, contact/outbreak or severe illness' }],
    suggest: 'Code J10/J11 influenza suspicion or Z20.8 contact, and document the risk factor.',
    why: 'IDSA influenza 2018: test when the result changes management (high-risk, hospitalised).',
    refs: ['IDSA influenza guideline 2018'],
  },
  {
    id: 'LAB-OGTT', label: 'OGTT', match: /\bogtt\b|glucose tolerance|\bgtt\b/i,
    icd: ['O24', 'Z34', 'O09', 'R73', 'E28.2', 'Z3A'],
    suggest: 'Code Z34.x with gestational age 24–28 weeks or O09.x high-risk pregnancy.',
    why: 'OGTT is the GDM screen at 24–28 weeks (earlier if high risk).',
    refs: ['ADA / IADPSG'],
  },
  {
    id: 'LAB-SEMEN', label: 'Semen analysis', match: /semen|seminal/i,
    icd: ['N46', 'Z31', 'N50', 'E29', 'Z98.52'], gender: 'M',
    suggest: 'Only post-vasectomy (Z98.52) or a covered infertility benefit.',
    why: 'Infertility investigation is excluded under the CHI Unified Policy.',
    refs: ['CHI Unified Policy – exclusions'],
    coverageNote: 'Infertility exclusion.',
  },

  // ───────────────────────── RADIOLOGY ─────────────────────────
  {
    id: 'RAD-CXR', label: 'Chest X-ray', match: /chest|\bcxr\b|thora/i,
    icd: ['J1', 'J2', 'J4', 'J6', 'J8', 'J9', 'A15', 'A16', 'R05', 'R06', 'R07', 'R09', 'R04.2', 'I50', 'I26', 'C34', 'S2', 'T17', 'Z01.81', 'Z11.1', 'R91', 'D86', 'J45'],
    conditional: [{ icd: ['J00', 'J06', 'J02', 'J03', 'R50', 'J30'], needs: /crepitat|crackles|wheez|reduced air|bronchial breath|tachypn|shortness|sob|dyspn|spo2|hypox|chest pain|cough[^.]{0,40}(\b([7-9]|\d{2})\s*days?|week|weeks|productive|persistent)|haemopt|hemopt/i, needsLabel: 'chest signs, hypoxia, dyspnoea or cough > 3 weeks' }],
    suggest: 'Code J18.9 / J20.9 / R05 chronic cough / R06.0 dyspnoea / R07.4 chest pain and document chest findings.',
    why: 'ACR Appropriateness: CXR not indicated for uncomplicated URTI/acute bronchitis without abnormal vital signs or chest signs.',
    refs: ['ACR Appropriateness Criteria – acute respiratory illness'],
  },
  {
    id: 'RAD-PREG-US', label: 'Obstetric ultrasound', match: /pregnan|obstet|fetal|foetal|\bnt\b scan|anomaly scan|dating scan/i,
    icd: ['O', 'Z34', 'Z33', 'Z36', 'Z3A', 'Z32.01', 'N96', 'O09'], gender: 'F',
    suggest: 'Code the pregnancy with trimester (Z34.0x/Z34.8x) + Z36 screening, or the complication (O20.0 threatened abortion, O26.8 pain in pregnancy).',
    why: 'Routine obstetric scans: dating 11–14 wks, anomaly 18–22 wks (NICE NG201). Extra scans need an obstetric complication. Some contracts require pre-authorisation for ultrasound.',
    refs: ['NICE NG201', 'ISUOG practice guidelines', 'Observed: Bupa BE-1-4 (U/S pregnancy pre-auth)'],
  },
  {
    id: 'RAD-ABD-US', label: 'Abdominal / pelvic ultrasound', match: /(u\/?s|ultra ?sound|sonar|sonograph).*(abd|pelvi|kub|renal|kidney|liver|gall|hepat|bladder|uterus|ovar|transvag)|transvaginal|\btvs\b|abdom.*(u\/?s|ultra)/i,
    icd: ['K35', 'K37', 'K40', 'K42', 'K43', 'K56', 'K57', 'K70', 'K71', 'K72', 'K73', 'K74', 'K75', 'K76', 'K80', 'K81', 'K82', 'K83', 'K85', 'K86', 'N1', 'N2', 'N3', 'N4', 'N7', 'N8', 'N9', 'R10.1', 'R10.11', 'R10.3', 'R10.2', 'R10.0', 'R16', 'R17', 'R18', 'R19.0', 'R31', 'R33', 'R74', 'O', 'Z34', 'C', 'D25', 'D27', 'E28.2', 'Q6', 'I71', 'Z90'],
    conditional: [{ icd: ['R10', 'K59', 'K29', 'K30', 'K58', 'R11', 'R63'], needs: ACUTE_ABD, needsLabel: 'localised tenderness, mass, guarding, RUQ pain, bleeding, weight loss or failed treatment' }],
    contra: { re: /constipat|infrequ\w* (defecation|stool|bowel)|hard stool|straining|no (bowel motion|stool) for/i, maxAge: 18, why: 'NASPGHAN/ESPGHAN 2014: abdominal ultrasound is not recommended to diagnose functional constipation in children – code K59.0 and treat; image only with red flags (bilious vomiting, distension, failure to thrive).' },
    suggest: 'Code the specific suspicion (K80.20 gallstones, N20.0 renal stone, N83.2 ovarian cyst, K35.80 appendicitis) — not the vague R10.4/R10.0 alone — and document the examination finding that made the scan necessary.',
    why: 'ACR: imaging must answer a defined question. "Abdominal pain" alone (R10.4) or functional constipation in a well child is not an indication; payer applies MN-1-1.',
    refs: ['ACR Appropriateness – acute abdominal pain', 'NASPGHAN constipation guideline (no routine imaging)', 'Observed: Tawuniya MN-1-1 ×2 (R10.0/R10.4)'],
  },
  {
    id: 'RAD-SPINE-C', label: 'Cervical spine imaging', match: /cervical (spine|vert)|c.?spine/i,
    icd: ['M47.1', 'M47.2', 'M47.81', 'M47.8', 'M48.0', 'M50', 'M53.0', 'M53.1', 'M43', 'M54.1', 'M54.2', 'M54.12', 'S12', 'S13', 'S14', 'S16', 'M46', 'C79.5', 'Q76', 'R29.8', 'G54.2', 'G55', 'M79.1'],
    noteHint: /neck|cervical/i,
    suggest: 'Code M54.2 cervicalgia / M50.x / M47.x / S13.4 with duration ≥ 6 weeks or red flags (trauma, neuro deficit).',
    why: 'ACR/NICE: neck pain < 6 weeks without trauma/red flags does not need X-ray.',
    refs: ['ACR Appropriateness – cervical neck pain', 'NEXUS / Canadian C-spine rule'],
  },
  {
    id: 'RAD-SPINE-L', label: 'Lumbosacral spine imaging', match: /lumb|lumbo|sacr|l\.?s spine|\bls\b|dorsal spine|thoracic spine|dorso/i,
    icd: ['M51', 'M47', 'M48', 'M43', 'M45', 'M46', 'M53.2', 'M53.3', 'M54.1', 'M54.3', 'M54.4', 'M54.5', 'M54.6', 'M54.16', 'M54.17', 'S22', 'S23', 'S32', 'S33', 'S34', 'M80', 'M81', 'C79.5', 'Q76', 'M40', 'M41'],
    conditional: [],
    suggest: 'Code M54.5x/M54.4x/M51.x and document duration > 6 weeks of failed conservative treatment or a red flag (trauma, age > 50 with new pain, fever, weight loss, neuro deficit, cancer history).',
    why: 'ACR / NICE NG59: no routine imaging for acute low back pain < 6 weeks without red flags. Payers reject or require pre-authorisation for MRI/CT.',
    refs: ['NICE NG59', 'ACR Appropriateness – low back pain', 'ACP 2017'],
  },
  {
    id: 'RAD-KNEE', label: 'Knee X-ray', match: /knee/i,
    icd: ['M17', 'M22', 'M23', 'M24.06', 'M25.06', 'M25.36', 'M25.46', 'M25.56', 'M25.66', 'M25.86', 'M25.96', 'M76.5', 'M70.4', 'M70.5', 'M76', 'M71.2', 'M00', 'M10', 'M06', 'M13', 'M19', 'M25.5', 'M25.4', 'M25.6', 'S80', 'S81', 'S82', 'S83', 'S86', 'S89', 'M89', 'Q74', 'M92.5', 'M79.66', 'M79.6'],
    suggest: 'Code the knee-specific diagnosis (M17.x OA, M25.56x knee pain, S83.x sprain, S80.0 contusion) and apply Ottawa knee rule for trauma.',
    why: 'Imaged site must match the coded site (ICD site digit). Ottawa knee rule for acute trauma.',
    refs: ['Ottawa knee rule', 'ACR – acute knee pain'],
  },
  {
    id: 'RAD-FOOT', label: 'Foot / ankle X-ray', match: /foot|feet|ankle|calcane|toe|heel|metatars/i,
    icd: ['M20', 'M21.4', 'M21.6', 'M24.27', 'M24.17', 'S82.5', 'S82.6', 'S82.8', 'S82.3', 'S82.9', 'M25.07', 'M25.37', 'M25.47', 'M25.57', 'M25.67', 'M25.87', 'M76.6', 'M76.7', 'M77.3', 'M77.4', 'M77.5', 'M72.2', 'M79.67', 'M79.6', 'M10', 'M19.07', 'M19', 'M14.6', 'S90', 'S91', 'S92', 'S93', 'S96', 'S97', 'S99', 'E11.5', 'E11.6', 'E10.5', 'L97', 'M86', 'Q66', 'M92.6', 'M92.7', 'L60', 'M25.5'],
    suggest: 'Code the foot/ankle diagnosis (S93.4 ankle sprain, M72.2 plantar fasciitis, M77.3 calcaneal spur, M25.57x) and apply Ottawa ankle rule.',
    why: 'Ottawa ankle/foot rules: X-ray only with bony tenderness or inability to bear weight. Site must match ICD.',
    refs: ['Ottawa ankle rules', 'ACR – acute ankle/foot trauma'],
  },
  {
    id: 'RAD-HAND', label: 'Hand / wrist X-ray', match: /hand|wrist|finger|thumb|carp|scaphoid|metacarp/i,
    icd: ['M25.53', 'M25.54', 'M25.33', 'M25.34', 'M25.43', 'M25.44', 'M65', 'M67.4', 'M18', 'M19.04', 'M19.03', 'M19', 'M05', 'M06', 'M13', 'M79.64', 'M79.63', 'M79.6', 'G56', 'M72.0', 'S60', 'S61', 'S62', 'S63', 'S66', 'S67', 'S68', 'S69', 'M25.5', 'M77.0', 'M77.1', 'M20.0', 'L03.0'],
    suggest: 'Code the hand/wrist diagnosis and the injury mechanism; Amsterdam wrist rules for trauma.',
    why: 'Imaged site must match the coded site.',
    refs: ['Amsterdam wrist rules', 'ACR – acute hand & wrist trauma'],
  },
  {
    id: 'RAD-SHOULDER', label: 'Shoulder X-ray', match: /shoulder|clavic|scapul|humer/i,
    icd: ['M75', 'M25.51', 'M25.31', 'M25.41', 'M19.01', 'M19.1', 'M19', 'M24.41', 'S40', 'S41', 'S42', 'S43', 'S46', 'S49', 'M79.62', 'M25.5', 'M89', 'M06', 'M13', 'M54.2'],
    suggest: 'Code M75.x, M25.51x shoulder pain or S4x injury.',
    why: 'Imaged site must match the coded site.', refs: ['ACR – shoulder pain'],
  },
  {
    id: 'RAD-HIP', label: 'Hip / pelvis X-ray', match: /\bhip\b|pelvis x|femur|femoral/i,
    icd: ['M16', 'M25.55', 'M25.35', 'M25.45', 'M24.15', 'M87.05', 'M87.1', 'M87.3', 'M70.6', 'M76.0', 'M76.1', 'M80', 'M81', 'S70', 'S71', 'S72', 'S73', 'S76', 'S32', 'Q65', 'M91', 'M93.0', 'M25.5', 'M54.4', 'M54.5', 'M79.65'],
    suggest: 'Code M16.x, M25.55x hip pain or S7x injury.', why: 'Imaged site must match the coded site.', refs: ['ACR – chronic hip pain'],
  },
  {
    id: 'RAD-ELBOW', label: 'Elbow / forearm X-ray', match: /elbow|forearm|radius|ulna|olecran/i,
    icd: ['M77.0', 'M77.1', 'M25.52', 'M25.32', 'M25.42', 'M70.2', 'M19.02', 'M19', 'S50', 'S51', 'S52', 'S53', 'S56', 'S59', 'M25.5', 'G56.2', 'M79.63'],
    suggest: 'Code M77.x epicondylitis, M25.52x or S5x injury.', why: 'Imaged site must match the coded site.', refs: ['ACR – elbow pain'],
  },
  {
    id: 'RAD-ADENOID', label: 'Nasopharynx / adenoid X-ray', match: /nasopharyn|adenoid|post.?nasal space|soft tissue neck/i,
    icd: ['J35.2', 'J35.3', 'J35.8', 'J35.9', 'R06.5', 'R06.83', 'G47.3', 'G47.33', 'J34.89', 'J31', 'H65', 'H66', 'H68', 'J32', 'J39.2', 'R09.81'],
    suggest: 'Code J35.2 adenoid hypertrophy / R06.5 mouth breathing / G47.33 OSA and document snoring, mouth breathing, apnoea.',
    why: 'Lateral neck X-ray is for suspected adenoid hypertrophy in children with obstructive symptoms.',
    refs: ['AAO-HNS tonsillectomy guideline 2019'],
  },
  {
    id: 'RAD-SINUS', label: 'Paranasal sinus X-ray/CT', match: /sinus|paranasal|water.?s view|\bpns\b/i,
    icd: ['J01', 'J32', 'J33', 'J34', 'J30', 'S02', 'R51', 'C30', 'C31', 'D14.0'],
    suggest: 'Code J32.x chronic sinusitis (> 12 weeks) or complication; acute sinusitis does not need imaging.',
    why: 'AAO-HNS adult sinusitis guideline: no imaging for uncomplicated acute rhinosinusitis.',
    refs: ['AAO-HNS adult sinusitis 2015'],
  },
  {
    id: 'RAD-SKULL', label: 'Skull / facial X-ray', match: /skull|facial bone|nasal bone|mandib|orbit|tmj/i,
    icd: ['S00', 'S01', 'S02', 'S03', 'S06', 'S09', 'M26.6', 'M26', 'K07', 'K10', 'J34.2', 'J34', 'H05', 'Q67', 'Q75'],
    suggest: 'Code the head/face injury (S02.x) with external cause, or TMJ disorder (M26.6x).',
    why: 'Skull X-ray has little role in head injury (NICE NG232 → CT when indicated).',
    refs: ['NICE NG232 Head injury'],
  },
  {
    id: 'RAD-DENTAL', label: 'Dental radiograph (panoramic / periapical / bitewing)', match: /panoram|\bopg\b|periapical|bitewing|occlusal film|dental x/i,
    icd: ['K00', 'K01', 'K02', 'K03', 'K04', 'K05', 'K06', 'K07', 'K08', 'K09', 'K10', 'S02.5', 'S03.2', 'M26', 'M27', 'Z01.2', 'Z46.4'],
    suggest: 'Code the dental diagnosis (K02.x caries, K04.x pulp/periapical, K05.x periodontal, K01.1 impacted tooth) and write the tooth number.',
    why: 'Dental radiographs need a dental ICD and tooth number (periapical); panoramic for multiple teeth, impaction or ortho.',
    refs: ['ADA/FDA dental radiograph selection criteria'],
  },
  {
    id: 'RAD-MRI-CT', label: 'MRI / CT', match: /\bmri\b|magnetic resonance|\bct\b|computed tomog|ct scan/i,
    icd: [],
    conditional: [{ icd: ['M', 'S', 'G', 'R51', 'I6', 'C', 'D', 'K', 'N', 'J', 'H', 'R10', 'R2', 'R4', 'R5', 'Q', 'T'], needs: /red flag|neuro|deficit|weakness|numb|radiat|sciatica|failed|no improvement|not improv|despite|physiother|\b([6-9]|\d{2})\s*weeks?|\b([2-9]|\d{2})\s*months?|trauma|fracture|tumou?r|mass|cancer|fever|weight loss|bladder|bowel|saddle|sudden|worst headache|seizure|vomit/i, needsLabel: 'red flags, neurological deficit or ≥ 6 weeks failed conservative care (and a pre-authorisation number)' }],
    suggest: 'Document red flags / neurological findings / failed conservative treatment duration, and quote the approval (pre-auth) number.',
    why: 'CT/MRI are pre-authorisation services under virtually all Saudi payer contracts (NPHIES BE-1-4) and must meet ACR appropriateness.',
    refs: ['ACR Appropriateness Criteria', 'NPHIES BE-1-4 pre-authorisation'],
  },

  // ───────────────────────── PROCEDURES ─────────────────────────
  {
    id: 'PRC-IVFLUID', label: 'IV infusion / IV fluids administration', match: /i\.?v\.? infusion|infusion mon|iv admin|electrolyte \(i|infusion pump|i\.?v\.? fluid|drip/i,
    icd: ['E86', 'E87', 'A00', 'A01', 'A02', 'A03', 'A04', 'A05', 'A08', 'A09', 'R57', 'T67', 'E10.1', 'E11.1', 'E16', 'N23', 'N20', 'O21', 'R11.1', 'R11.2', 'K85', 'R55', 'G43', 'T78', 'K56', 'A90', 'A91', 'D57.0', 'I95'],
    conditional: [{ icd: ['J', 'R50', 'R51', 'R10', 'K29', 'K30', 'K21', 'R11', 'R42', 'R53', 'B34', 'M54'], needs: DEHYDRATION, needsLabel: 'dehydration signs (tachycardia, dry mucosa, poor intake, ≥ 4 vomits, oliguria) or inability to take oral medication' }],
    suggest: 'If clinically true, document dehydration signs (pulse, mucosa, capillary refill, urine output, number of vomits) and add E86.0 dehydration; otherwise give oral rehydration/oral medication.',
    why: 'IV fluids/IV route are not justified for URTI, pharyngitis, fever or mild gastritis in a patient who tolerates oral intake (WHO/NICE CG84; NICE NG29). Payer rejected IV administration ×7 in July for J00/J02/J06/R50/K21.',
    refs: ['NICE CG84 gastroenteritis in children', 'NICE NG29 IV fluids', 'Observed: Tawuniya MN-1-1 ×7 (IV admin)'],
  },
  {
    id: 'PRC-INJ', label: 'IM / IV injection administration', match: /i\.?m\.? injection|i\.?v\.? injection|injection \(without|intramuscular|im inj|iv inj/i,
    icd: [],
    conditional: [{ icd: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'Z'], needs: SEVERE, needsLabel: 'severity (pain score ≥ 7/10, persistent vomiting, unable to take oral, acute distress)' }],
    suggest: 'Document why the parenteral route was needed: pain score, vomiting/unable to tolerate oral, failed oral therapy, need for rapid action.',
    why: 'Oral route is first line in ambulatory care; parenteral administration requires documented severity or oral intolerance (CHI formulary EU edits; NPHIES MN-1-1).',
    refs: ['CHI DDF – EU (emergency use) edits', 'NPHIES MN-1-1'],
  },
  {
    id: 'PRC-NEB', label: 'Nebulisation', match: /nebuli|inhalation therapy(?!.*steam)|nebuliz/i,
    icd: ['J45', 'J44', 'J21', 'J05.0', 'J20', 'J46', 'R06.2', 'J98.01', 'J40', 'J18', 'J12', 'T78.3', 'J38.5', 'J41', 'J42', 'P22', 'J84'],
    conditional: [{ icd: ['R05', 'J06', 'J00', 'J02', 'J03', 'R06'], needs: /wheez|bronchospasm|tight chest|chest tight|crepit|prolonged expir|retraction|recession|tachypn|spo2|sob|shortness|dyspn|stridor/i, needsLabel: 'wheeze, retractions, tachypnoea or low SpO2' }],
    suggest: 'Code J45.x/J21.x/J20.x/R06.2 and document wheeze, RR and SpO2 before & after.',
    why: 'GINA / NICE NG245: bronchodilator nebulisation is for bronchospasm, not for simple cough/URTI.',
    refs: ['GINA 2025', 'NICE NG245'],
  },
  {
    id: 'PRC-STEAM', label: 'Steam inhalation', match: /steam/i,
    icd: ['J00', 'J01', 'J04', 'J05', 'J06', 'J20', 'J21', 'J30', 'J31', 'J32', 'J37', 'J38'],
    suggest: 'Link to J00/J01/J04/J06 with nasal congestion documented — evidence is weak; avoid routine billing.',
    why: 'Cochrane (2017): steam inhalation shows no proven benefit for the common cold; many payers treat it as non-essential.',
    refs: ['Cochrane Review CD001728'],
  },
  {
    id: 'PRC-ECG', label: 'ECG', match: /\becg\b|\bekg\b|electrocardio/i,
    icd: ['I', 'R00', 'R01', 'R07', 'R06', 'R55', 'R42', 'R94.31', 'E87', 'Z01.81', 'Z01.810', 'Z01.818', 'T50', 'T46', 'E05', 'R07.4', 'Z79.899', 'R40', 'O'],
    suggest: 'Code R07.4 chest pain, R00.2 palpitations, R55 syncope, or Z01.810 pre-procedural, and document the symptom.',
    why: 'ECG needs cardiac symptoms, cardiovascular disease, electrolyte disorder, QT-prolonging drugs or pre-op protocol.',
    refs: ['ACC/AHA perioperative guideline 2024'],
  },
  {
    id: 'PRC-WOUND', label: 'Wound dressing / suturing / burn care', match: /dressing|sutur|stitch|wound|burn|laceration repair|debridement/i,
    icd: ['S', 'T2', 'T3', 'T14', 'L02', 'L03', 'L08', 'L89', 'L97', 'L98.4', 'E10.5', 'E10.6', 'E11.5', 'E11.6', 'E11.62', 'E13.6', 'E14.5', 'E14.6', 'Z48', 'T81', 'T79', 'O90', 'L72', 'L05', 'L60', 'Z98', 'I83', 'I87.2'],
    suggest: 'Code the wound (S01–S91 open wound / T2x burn / L97 ulcer / Z48.0 dressing change) plus the external cause, and document size, site, mechanism and date of injury.',
    why: 'Wound care needs a wound/injury/ulcer code. Injury claims require mechanism, place, date and work-related status (CHI injury documentation).',
    refs: ['ICD-10-AM ACS 1901/2001 (injury & external cause)', 'CHI Unified Policy – injuries'],
  },
  {
    id: 'PRC-EAR', label: 'Ear wash / ear wick / ear packing', match: /ear (wash|wick|packing|syringing|irrigat|toilet|suction)|aural toilet|cerumen|wax remov/i,
    icd: ['H61.2', 'H60', 'H62', 'H61.0', 'H61.1', 'H61.8', 'H66', 'H72', 'H92', 'H93.1', 'H91', 'T16', 'B36', 'H74', 'H70'],
    suggest: 'Code H61.2x impacted cerumen or H60.x otitis externa, and document the otoscopy finding.',
    why: 'Ear irrigation/microsuction needs impacted wax or otitis externa on otoscopy (AAO-HNS cerumen guideline).',
    refs: ['AAO-HNS cerumen impaction 2017'],
  },
  {
    id: 'PRC-AUDIO', label: 'Audiometry / tympanometry', match: /audiometr|tympanometr|\bpta\b|hearing test|\boae\b|otoacoustic|\bbera\b/i,
    icd: ['H65', 'H66', 'H67', 'H68', 'H69', 'H71', 'H72', 'H74', 'H80', 'H81', 'H83', 'H90', 'H91', 'H93', 'H92', 'J35.2', 'J35.3', 'R62', 'F80', 'Z01.1', 'Z01.10', 'Z01.11', 'R42'],
    suggest: 'Code H65.x OME / H90-H91 hearing loss / H93.1 tinnitus / J35.2 adenoid hypertrophy with ear symptoms.',
    why: 'Hearing tests need a hearing complaint, middle-ear effusion or vertigo.',
    refs: ['AAO-HNS OME guideline 2016'],
  },
  {
    id: 'PRC-SCOPE', label: 'Laryngoscopy / nasal endoscopy', match: /laryngoscop|nasal endoscop|nasendoscop|nasopharyngoscop|fibreoptic|fiberoptic/i,
    icd: ['R49', 'J37', 'J38', 'R13', 'K21', 'J35', 'J34', 'J32', 'J33', 'J31', 'R04.0', 'R06.1', 'R06.5', 'G47.3', 'C32', 'C11', 'R22.1', 'T17', 'R07.0', 'H65', 'H69', 'J30', 'R09.8'],
    suggest: 'Code R49.0 hoarseness > 3 weeks, J38.x, J34.x, R04.0 epistaxis or J32.x with symptom duration.',
    why: 'AAO-HNS hoarseness guideline: laryngoscopy for hoarseness > 4 weeks or red flags.',
    refs: ['AAO-HNS dysphonia guideline 2018'],
  },
  {
    id: 'PRC-NAIL', label: 'Ingrown nail wedge resection', match: /ingrow|wedge resection|nail (avuls|extract|remov)/i,
    icd: ['L60.0', 'L03.0', 'L60', 'B35.1', 'S90', 'S91', 'L03.03', 'L03.04'],
    suggest: 'Code L60.0 + L03.03x if infected, document stage (Heifetz), failed conservative care and pain.',
    why: 'Surgical correction is indicated for stage II–III or failed conservative care.',
    refs: ['AAFP ingrown toenail 2019'],
  },
  {
    id: 'PRC-BANDAGE', label: 'Bandage / splint / cast', match: /bandage|splint|cast|slab|brace|sling|collar/i,
    icd: ['S', 'M25', 'M23', 'M24', 'M65', 'M67', 'M70', 'M75', 'M76', 'M77', 'M79', 'G56', 'M54', 'M17', 'M19', 'T14'],
    suggest: 'Code the injury / musculoskeletal diagnosis and site.', why: 'Supports need a musculoskeletal or injury diagnosis.', refs: ['NPHIES MN-1-1'],
  },
  {
    id: 'PRC-CAUTERY', label: 'Nasal cautery / packing', match: /cauter|nasal pack|anterior pack/i,
    icd: ['R04.0', 'J34', 'I78', 'D68', 'S00.3', 'S02.2'], suggest: 'Code R04.0 epistaxis and document bleeding site.', why: 'Cautery needs active/recurrent epistaxis.', refs: ['NICE CKS epistaxis'],
  },
  {
    id: 'PRC-PAP', label: 'Pap smear / cervical cytology', match: /pap smear|cervical (smear|cytolog)|\blbc\b|hpv/i,
    icd: ['Z01.4', 'Z12.4', 'Z12.72', 'N86', 'N87', 'N88', 'R87', 'N72', 'C53', 'D06', 'Z86.001', 'N89', 'N93'], gender: 'F', minAge: 21,
    suggest: 'Code Z12.4 cervical screening (age 25/21–65, every 3–5 years) or the cervical finding.',
    why: 'WHO/ACOG cervical screening intervals; outside them it needs a clinical indication.',
    refs: ['WHO cervical screening guideline 2021', 'ACOG'],
  },

  // ───────────────────────── DENTAL ─────────────────────────
  {
    id: 'DEN-EXTRACT', label: 'Tooth extraction', match: /extraction|exodont/i,
    icd: ['K00', 'K01', 'K02', 'K03', 'K04', 'K05', 'K08', 'K09', 'K10', 'S02.5', 'S03.2', 'M27', 'K07.3'],
    suggest: 'Code K04.x (pulp/periapical), K02.x (caries), K05.x (periodontitis), K01.1 (impacted), K00.6 (retained primary tooth) and write the tooth number (FDI).',
    why: 'Extraction needs a dental pathology code and tooth number.',
    refs: ['CHI dental benefit – unified policy', 'FDI two-digit notation'],
  },
  {
    id: 'DEN-RESTOR', label: 'Composite / amalgam restoration', match: /restoration|filling|composite|amalgam|glass ionomer/i,
    icd: ['K02', 'K03', 'S02.5', 'K08.53', 'K08.5', 'K00.4', 'K04.0', 'K00.3', 'K01'],
    suggest: 'Code K02.x caries (or S02.5 fracture / K03.x wear) + tooth number + surfaces. Re-doing a recent restoration needs reason (failed restoration K08.53).',
    why: 'Cosmetic restorations are excluded; a caries/fracture code is required.',
    refs: ['CHI dental benefit – cosmetic exclusion'],
  },
  {
    id: 'DEN-RCT', label: 'Root canal / pulpotomy / pulpectomy', match: /root canal|\brct\b|pulpotom|pulpectom|endodont|extirpation/i,
    icd: ['K04', 'K02.5', 'K02.52', 'K02.53', 'S02.5', 'K03.81', 'K08.8'],
    suggest: 'Code K04.0 pulpitis / K04.1 necrosis / K04.4–K04.7 periapical pathology with tooth number and periapical X-ray.',
    why: 'Endodontic treatment requires pulpal/periapical diagnosis; payers request the pre-op periapical X-ray.',
    refs: ['AAE endodontic diagnosis', 'CHI dental benefit'],
  },
  {
    id: 'DEN-PERIO', label: 'Scaling / gum treatment', match: /gum treat|scaling|polish|periodont|curettage|deep clean|gingiv/i,
    icd: ['K05', 'K06', 'K03.6', 'K13.0', 'K12'],
    suggest: 'Code K05.1x chronic gingivitis / K05.3x chronic periodontitis with pocket depths.',
    why: 'Prophylactic scaling/polishing without periodontal diagnosis is treated as preventive/cosmetic (limited benefit).',
    refs: ['AAP/EFP periodontal classification 2017'],
  },
];

/** Consultation-level checks: diagnoses that are excluded or administrative under CHI policy. */
export const NON_COVERED_ICDS: { prefix: string; label: string; why: string; severity: 'critical' | 'high' | 'medium' }[] = [
  { prefix: 'Z00', label: 'General / routine check-up', why: 'Routine health check-ups are not covered unless the policy has a preventive benefit (CHI Unified Policy).', severity: 'high' },
  { prefix: 'Z02', label: 'Administrative examination (fitness, licence, employment)', why: 'Administrative/fitness examinations are excluded under the CHI Unified Policy.', severity: 'critical' },
  { prefix: 'Z41', label: 'Procedure for purposes other than remedying health state (cosmetic)', why: 'Cosmetic services are excluded.', severity: 'critical' },
  { prefix: 'N97', label: 'Female infertility', why: 'Infertility treatment/investigation is a CHI policy exclusion.', severity: 'critical' },
  { prefix: 'N46', label: 'Male infertility', why: 'Infertility treatment/investigation is a CHI policy exclusion.', severity: 'critical' },
  { prefix: 'Z31', label: 'Procreative management', why: 'Infertility/assisted reproduction is excluded.', severity: 'critical' },
  { prefix: 'E66', label: 'Obesity', why: 'Weight-reduction programmes and drugs are excluded; obesity is acceptable only as a secondary risk-factor code.', severity: 'medium' },
  { prefix: 'L70', label: 'Acne', why: 'Acne treatment is often limited to non-cosmetic medical therapy; cosmetic procedures excluded.', severity: 'medium' },
  { prefix: 'L65', label: 'Non-scarring hair loss', why: 'Hair-loss treatment is commonly excluded as cosmetic.', severity: 'medium' },
  { prefix: 'L64', label: 'Androgenic alopecia', why: 'Androgenic alopecia treatment is excluded as cosmetic.', severity: 'high' },
  { prefix: 'F17', label: 'Nicotine dependence', why: 'Smoking-cessation products are usually excluded unless a programme benefit exists.', severity: 'medium' },
  { prefix: 'Z30', label: 'Contraceptive management', why: 'Contraception is not a covered benefit in most CHI policies.', severity: 'medium' },
  { prefix: 'K07.2', label: 'Malocclusion (orthodontic)', why: 'Orthodontic treatment is excluded except congenital cleft cases.', severity: 'high' },
  { prefix: 'R69', label: 'Illness, unspecified', why: 'Non-specific code – payers reject as invalid primary diagnosis.', severity: 'high' },
  { prefix: 'R68.8', label: 'Other specified general symptoms', why: 'Non-specific code – replace with the actual symptom/diagnosis.', severity: 'medium' },
];

export const SEVERE_RE = SEVERE;
export const DEHYDRATION_RE = DEHYDRATION;
