/**
 * Drug safety knowledge: therapeutic classes, clinically significant interactions, drug–disease and
 * pregnancy contraindications, and age restrictions. Ingredients are matched on the SFDA scientific name
 * (via the CHI formulary mapping) with the billed description as fallback.
 * Sources: SFDA SPCs, Lexicomp/Stockley severity classes, AGS Beers Criteria 2023, FDA pregnancy labelling,
 * BNF for Children, MHRA cough & cold guidance, EMA domperidone/metoclopramide referrals.
 */

export type DrugClass =
  | 'NSAID' | 'PARACETAMOL' | 'PPI' | 'H2RA' | 'ANTACID_CATION' | 'H1_SEDATING' | 'H1' | 'DECONGESTANT' | 'MACROLIDE'
  | 'QUINOLONE' | 'TETRACYCLINE' | 'BETALACTAM' | 'AMINOGLYCOSIDE' | 'NITROIMIDAZOLE' | 'CORTICOSTEROID_SYS' | 'CORTICOSTEROID_TOP'
  | 'OPIOID' | 'TRAMADOL' | 'SSRI' | 'SETRON' | 'D2_ANTIEMETIC' | 'ANTIMUSCARINIC' | 'ANTICOAGULANT' | 'ANTIPLATELET'
  | 'ACEI_ARB' | 'K_SPARING' | 'STATIN' | 'NITRATE' | 'PDE5' | 'BENZODIAZEPINE' | 'MUSCLE_RELAXANT' | 'METFORMIN'
  | 'BETA_BLOCKER' | 'IRON' | 'CALCIUM_MAG' | 'TOPICAL_NASAL_DECONG' | 'LAXATIVE' | 'VITAMIN' | 'ANTIBIOTIC' | 'ANTIFUNGAL_AZOLE'
  | 'QT_PROLONGING' | 'SEROTONERGIC' | 'IV_FLUID';

const CLASS_PATTERNS: [DrugClass, RegExp][] = [
  ['NSAID', /ibuprofen|diclofenac|naproxen|ketoprofen|ketorolac|lornoxicam|meloxicam|piroxicam|tenoxicam|indomethacin|indometacin|mefenamic|celecoxib|etoricoxib|nimesulide|aceclofenac|loxoprofen|dexketoprofen|flurbiprofen|aspirin|acetylsalicylic/],
  ['PARACETAMOL', /paracetamol|acetaminophen/],
  ['PPI', /omeprazole|esomeprazole|pantoprazole|lansoprazole|rabeprazole|dexlansoprazole/],
  ['H2RA', /ranitidine|famotidine|cimetidine|nizatidine/],
  ['ANTACID_CATION', /aluminium|aluminum|magnesium hydroxide|magnesium trisilicate|calcium carbonate|sucralfate|antacid|simeticone.*magnes/],
  ['H1_SEDATING', /chlorphen|chlorpheniramine|diphenhydramine|promethazine|hydroxyzine|dimenhydrinate|triprolidine|cyproheptadine|ketotifen|brompheniramine|doxylamine|pheniramine/],
  ['H1', /cetirizine|levocetirizine|loratadine|desloratadine|fexofenadine|bilastine|rupatadine|ebastine/],
  ['DECONGESTANT', /pseudoephedrine|phenylephrine|ephedrine/],
  ['TOPICAL_NASAL_DECONG', /xylometazoline|oxymetazoline|naphazoline/],
  ['MACROLIDE', /azithromycin|clarithromycin|erythromycin/],
  ['QUINOLONE', /ciprofloxacin|levofloxacin|moxifloxacin|ofloxacin|norfloxacin/],
  ['TETRACYCLINE', /doxycycline|tetracycline|minocycline/],
  ['BETALACTAM', /amoxicillin|ampicillin|penicillin|cef|cloxacillin|flucloxacillin|piperacillin|meropenem|imipenem/],
  ['AMINOGLYCOSIDE', /gentamicin|amikacin|tobramycin/],
  ['NITROIMIDAZOLE', /metronidazole|tinidazole|ornidazole/],
  ['CORTICOSTEROID_SYS', /dexamethasone|hydrocortisone sod|hydrocortisone$|prednisolone|prednisone|methylprednisolone|betamethasone sod|triamcinolone acetonide inj|deflazacort/],
  ['CORTICOSTEROID_TOP', /betamethasone valerate|clobetasol|mometasone|fluticasone|budesonide|beclometasone|hydrocortisone acetate|triamcinolone/],
  ['OPIOID', /morphine|codeine|fentanyl|pethidine|oxycodone|hydromorphone|nalbuphine|tapentadol/],
  ['TRAMADOL', /tramadol/],
  ['SSRI', /sertraline|fluoxetine|paroxetine|citalopram|escitalopram|fluvoxamine|venlafaxine|duloxetine/],
  ['SETRON', /ondansetron|granisetron|palonosetron/],
  ['D2_ANTIEMETIC', /metoclopramide|domperidone|prochlorperazine/],
  ['ANTIMUSCARINIC', /butylscopolamine|hyoscine|scopolamine|dicyclomine|dicycloverine|atropine|oxybutynin|tolterodine|solifenacin/],
  ['ANTICOAGULANT', /warfarin|rivaroxaban|apixaban|dabigatran|edoxaban|enoxaparin|heparin/],
  ['ANTIPLATELET', /clopidogrel|ticagrelor|prasugrel|aspirin.*(75|81|100)|acetylsalicylic acid 81/],
  ['ACEI_ARB', /pril\b|prilat|sartan/],
  ['K_SPARING', /spironolactone|eplerenone|amiloride|triamterene|potassium chloride/],
  ['STATIN', /statin\b|atorvastatin|rosuvastatin|simvastatin|pravastatin|lovastatin|fluvastatin/],
  ['NITRATE', /nitroglycerin|glyceryl trinitrate|isosorbide/],
  ['PDE5', /sildenafil|tadalafil|vardenafil|avanafil/],
  ['BENZODIAZEPINE', /diazepam|lorazepam|alprazolam|clonazepam|midazolam|bromazepam/],
  ['MUSCLE_RELAXANT', /chlorzoxazone|orphenadrine|tizanidine|methocarbamol|cyclobenzaprine|baclofen|thiocolchicoside/],
  ['METFORMIN', /metformin/],
  ['BETA_BLOCKER', /olol\b|bisoprolol|atenolol|propranolol|metoprolol|carvedilol|nebivolol/],
  ['IRON', /ferrous|ferric|iron/],
  ['CALCIUM_MAG', /calcium|magnesium|zinc/],
  ['LAXATIVE', /lactulose|bisacodyl|senna|macrogol|polyethylene glycol|glycerin supp|sodium picosulfate/],
  ['VITAMIN', /colecalciferol|cholecalciferol|ergocalciferol|vitamin|multivit|cyanocobalamin|folic acid|thiamine/],
  ['ANTIFUNGAL_AZOLE', /fluconazole|itraconazole|ketoconazole|voriconazole|posaconazole/],
  ['IV_FLUID', /sodium chloride|ringer|dextrose|glucose.*infus/],
];

/** QT-prolonging & serotonergic membership (CredibleMeds known/possible risk lists). */
const QT = /ondansetron|granisetron|domperidone|azithromycin|clarithromycin|erythromycin|levofloxacin|moxifloxacin|ciprofloxacin|haloperidol|chlorpromazine|citalopram|escitalopram|fluconazole|hydroxyzine|methadone|amiodarone|sotalol|promethazine|metoclopramide|loperamide/;
const SEROTONERGIC = /sertraline|fluoxetine|paroxetine|citalopram|escitalopram|fluvoxamine|venlafaxine|duloxetine|tramadol|ondansetron|granisetron|linezolid|triptan|sumatriptan|dextromethorphan|fentanyl|pethidine|trazodone|amitriptyline/;

export function classesOf(name: string): Set<DrugClass> {
  const s = name.toLowerCase();
  const out = new Set<DrugClass>();
  for (const [c, re] of CLASS_PATTERNS) if (re.test(s)) out.add(c);
  if (QT.test(s)) out.add('QT_PROLONGING');
  if (SEROTONERGIC.test(s)) out.add('SEROTONERGIC');
  if (['MACROLIDE', 'QUINOLONE', 'TETRACYCLINE', 'BETALACTAM', 'AMINOGLYCOSIDE', 'NITROIMIDAZOLE'].some((c) => out.has(c as DrugClass)) || /clindamycin|cotrimoxazole|sulfamethoxazole|nitrofurantoin|fosfomycin|linezolid|vancomycin|fusidic acid.*(tab|inj)/.test(s)) out.add('ANTIBIOTIC');
  // Topical NSAIDs / topical antibiotics are not systemic duplicates for interaction purposes.
  return out;
}

export function isTopical(desc: string, route: string): boolean {
  return /cream|ointment|gel|lotion|patch|tape|spray|drop|nasal|eye|ear|topical|cutaneous|mouth ?wash|suppos|vaginal|inhal|shampoo/i.test(desc + ' ' + route);
}

export function isInjectable(desc: string, route: string, form: string): boolean {
  return /inj|injection|vial|ampoule|ampul|\bamp\b|infusion|i\.v|\biv\b|\bim\b|intraven|intramusc|parenteral|bottle.*(ml)|ml\/bottle/i.test(`${desc} ${route} ${form}`) && !/nasal|eye|ear|oral|syrup|suspension|drops/i.test(desc);
}

export interface Interaction {
  a: DrugClass;
  b: DrugClass;
  severity: 'critical' | 'high' | 'medium';
  effect: string;
  action: string;
  /** a and b may be the same class: therapeutic duplication. */
}

export const INTERACTIONS: Interaction[] = [
  { a: 'NSAID', b: 'NSAID', severity: 'high', effect: 'Therapeutic duplication of two systemic NSAIDs – additive GI bleeding & renal toxicity, no extra analgesic benefit.', action: 'Keep one NSAID; payers reject the second (duplicate therapy).' },
  { a: 'PARACETAMOL', b: 'PARACETAMOL', severity: 'high', effect: 'Paracetamol duplication (e.g. IV + oral, or two brands) – risk of exceeding 4 g/day (hepatotoxicity).', action: 'Bill one paracetamol product; document dose schedule if IV is followed by oral.' },
  { a: 'PPI', b: 'PPI', severity: 'high', effect: 'Duplicate proton-pump inhibitors.', action: 'Keep one PPI (IV → oral step-down must be on different dates).' },
  { a: 'PPI', b: 'H2RA', severity: 'medium', effect: 'PPI + H2 blocker duplication of acid suppression.', action: 'Use a single acid-suppressant unless nocturnal breakthrough is documented.' },
  { a: 'H1', b: 'H1', severity: 'medium', effect: 'Duplicate antihistamines.', action: 'Prescribe one antihistamine.' },
  { a: 'H1', b: 'H1_SEDATING', severity: 'medium', effect: 'Two antihistamines (sedating + non-sedating) – additive anticholinergic/sedative effect.', action: 'Prescribe one antihistamine; justify parenteral chlorphenamine for acute allergy only.' },
  { a: 'H1_SEDATING', b: 'H1_SEDATING', severity: 'medium', effect: 'Duplicate sedating antihistamines.', action: 'Prescribe one antihistamine.' },
  { a: 'NSAID', b: 'CORTICOSTEROID_SYS', severity: 'medium', effect: 'NSAID + systemic corticosteroid – ~4× risk of GI ulcer/bleed.', action: 'Avoid the combination or add gastroprotection with documented indication.' },
  { a: 'NSAID', b: 'ANTICOAGULANT', severity: 'critical', effect: 'NSAID + anticoagulant – major bleeding risk.', action: 'Avoid; use paracetamol.' },
  { a: 'NSAID', b: 'ANTIPLATELET', severity: 'high', effect: 'NSAID + antiplatelet – bleeding; ibuprofen blocks aspirin cardioprotection.', action: 'Avoid or document gastroprotection.' },
  { a: 'NSAID', b: 'ACEI_ARB', severity: 'medium', effect: 'NSAID reduces antihypertensive effect and can precipitate acute kidney injury (with diuretic = "triple whammy").', action: 'Short course only; check renal function in elderly.' },
  { a: 'NSAID', b: 'QUINOLONE', severity: 'medium', effect: 'NSAID + fluoroquinolone – increased seizure risk.', action: 'Prefer paracetamol.' },
  { a: 'NSAID', b: 'SSRI', severity: 'medium', effect: 'NSAID + SSRI – increased GI bleeding.', action: 'Add PPI or avoid.' },
  { a: 'QUINOLONE', b: 'ANTACID_CATION', severity: 'high', effect: 'Fluoroquinolone chelated by Al/Mg/Ca antacids – absorption ↓ up to 90%.', action: 'Separate by ≥ 2 h before / 6 h after, or choose another drug.' },
  { a: 'QUINOLONE', b: 'CALCIUM_MAG', severity: 'high', effect: 'Fluoroquinolone chelated by calcium/magnesium/zinc – therapeutic failure.', action: 'Separate doses or choose another antibiotic.' },
  { a: 'TETRACYCLINE', b: 'ANTACID_CATION', severity: 'high', effect: 'Tetracycline chelation by antacids – absorption ↓.', action: 'Separate by 2–3 h.' },
  { a: 'TETRACYCLINE', b: 'CALCIUM_MAG', severity: 'high', effect: 'Tetracycline chelation by Ca/Mg/Zn.', action: 'Separate by 2–3 h.' },
  { a: 'TETRACYCLINE', b: 'IRON', severity: 'high', effect: 'Tetracycline chelation by iron.', action: 'Separate by 2–3 h.' },
  { a: 'QUINOLONE', b: 'IRON', severity: 'high', effect: 'Fluoroquinolone chelation by iron.', action: 'Separate doses.' },
  { a: 'QT_PROLONGING', b: 'QT_PROLONGING', severity: 'high', effect: 'Two QT-prolonging drugs (e.g. ondansetron + domperidone/azithromycin) – risk of torsades de pointes.', action: 'Avoid combination or document ECG/QTc and electrolytes.' },
  { a: 'SETRON', b: 'D2_ANTIEMETIC', severity: 'medium', effect: 'Two antiemetics given together without documented refractory vomiting (duplication + additive QT).', action: 'Use one antiemetic; add second only if refractory vomiting is documented.' },
  { a: 'D2_ANTIEMETIC', b: 'D2_ANTIEMETIC', severity: 'high', effect: 'Metoclopramide + domperidone – duplication, extrapyramidal & QT risk.', action: 'Use one.' },
  { a: 'D2_ANTIEMETIC', b: 'ANTIMUSCARINIC', severity: 'medium', effect: 'Metoclopramide/domperidone (prokinetic) with hyoscine (antispasmodic) – pharmacological antagonism on gut motility.', action: 'Choose according to the dominant symptom.' },
  { a: 'SEROTONERGIC', b: 'SEROTONERGIC', severity: 'high', effect: 'Two serotonergic drugs (e.g. tramadol + SSRI/ondansetron) – serotonin syndrome risk.', action: 'Avoid or monitor; document indication.' },
  { a: 'TRAMADOL', b: 'SSRI', severity: 'high', effect: 'Tramadol + SSRI – serotonin syndrome and seizure threshold ↓.', action: 'Avoid.' },
  { a: 'OPIOID', b: 'BENZODIAZEPINE', severity: 'critical', effect: 'Opioid + benzodiazepine – respiratory depression (FDA boxed warning).', action: 'Avoid.' },
  { a: 'OPIOID', b: 'H1_SEDATING', severity: 'medium', effect: 'Opioid + sedating antihistamine – additive CNS depression.', action: 'Monitor/avoid in elderly.' },
  { a: 'MACROLIDE', b: 'STATIN', severity: 'high', effect: 'Clarithromycin/erythromycin inhibit CYP3A4 – statin myopathy/rhabdomyolysis.', action: 'Hold simvastatin/atorvastatin or use azithromycin.' },
  { a: 'ANTIFUNGAL_AZOLE', b: 'STATIN', severity: 'high', effect: 'Azole + statin – myopathy.', action: 'Hold statin during course.' },
  { a: 'NITRATE', b: 'PDE5', severity: 'critical', effect: 'Nitrate + PDE5 inhibitor – profound hypotension (contraindicated).', action: 'Never co-prescribe.' },
  { a: 'ACEI_ARB', b: 'K_SPARING', severity: 'high', effect: 'ACEi/ARB + potassium-sparing diuretic/potassium – hyperkalaemia.', action: 'Check potassium.' },
  { a: 'NITROIMIDAZOLE', b: 'ANTICOAGULANT', severity: 'high', effect: 'Metronidazole potentiates warfarin – INR ↑.', action: 'Check INR.' },
  { a: 'MACROLIDE', b: 'ANTICOAGULANT', severity: 'high', effect: 'Macrolide potentiates warfarin.', action: 'Check INR.' },
  { a: 'QUINOLONE', b: 'CORTICOSTEROID_SYS', severity: 'medium', effect: 'Fluoroquinolone + systemic steroid – tendon rupture risk.', action: 'Avoid in elderly; counsel.' },
  { a: 'MUSCLE_RELAXANT', b: 'H1_SEDATING', severity: 'medium', effect: 'Muscle relaxant + sedating antihistamine – additive sedation.', action: 'Avoid in elderly / drivers.' },
  { a: 'MUSCLE_RELAXANT', b: 'BENZODIAZEPINE', severity: 'medium', effect: 'Additive CNS depression.', action: 'Avoid.' },
  { a: 'ANTIBIOTIC', b: 'ANTIBIOTIC', severity: 'medium', effect: 'Two systemic antibiotics on the same visit without a documented reason (dual coverage).', action: 'Keep one antibiotic unless a combination is guideline-based (e.g. H. pylori triple therapy).' },
  { a: 'DECONGESTANT', b: 'DECONGESTANT', severity: 'medium', effect: 'Two oral decongestant combinations (pseudoephedrine) – cardiovascular stimulation.', action: 'Prescribe one.' },
  { a: 'CORTICOSTEROID_SYS', b: 'CORTICOSTEROID_SYS', severity: 'medium', effect: 'Two systemic corticosteroids (e.g. dexamethasone + hydrocortisone).', action: 'Prescribe one.' },
];

export interface DrugDisease {
  cls: DrugClass;
  icd: string[];
  noteRe?: RegExp;
  severity: 'critical' | 'high' | 'medium';
  effect: string;
}

export const DRUG_DISEASE: DrugDisease[] = [
  { cls: 'NSAID', icd: ['K25', 'K26', 'K27', 'K28', 'K92'], noteRe: /peptic ulcer|gi bleed|melena|haematemesis|hematemesis/i, severity: 'critical', effect: 'NSAID with peptic ulcer / GI bleeding – contraindicated.' },
  { cls: 'NSAID', icd: ['K29', 'K21', 'K30'], severity: 'medium', effect: 'NSAID prescribed with gastritis/GERD/dyspepsia – worsens the coded condition; payers question the combination.' },
  { cls: 'NSAID', icd: ['N17', 'N18.4', 'N18.5', 'N18.6', 'N19'], noteRe: /ckd|renal (failure|impair)|kidney disease/i, severity: 'critical', effect: 'NSAID in renal impairment – risk of AKI.' },
  { cls: 'NSAID', icd: ['I50'], noteRe: /heart failure/i, severity: 'high', effect: 'NSAID in heart failure – fluid retention/decompensation.' },
  { cls: 'NSAID', icd: ['J45'], noteRe: /aspirin.?(sensitive|induced|allerg)|nsaid allerg/i, severity: 'medium', effect: 'NSAID in asthma – risk of NSAID-exacerbated respiratory disease; document tolerance.' },
  { cls: 'DECONGESTANT', icd: ['I10', 'I11', 'I12', 'I13', 'I15', 'I20', 'I25', 'I48'], noteRe: /hypertens|\bhtn\b/i, severity: 'high', effect: 'Oral pseudoephedrine/phenylephrine in hypertension/IHD – raises BP.' },
  { cls: 'DECONGESTANT', icd: ['H40', 'N40'], severity: 'medium', effect: 'Sympathomimetic decongestant in glaucoma/BPH.' },
  { cls: 'ANTIMUSCARINIC', icd: ['H40.2', 'N40', 'K56', 'G70'], noteRe: /glaucoma|prostat|bph|myasthenia/i, severity: 'high', effect: 'Antimuscarinic in angle-closure glaucoma / BPH / ileus / myasthenia.' },
  { cls: 'H1_SEDATING', icd: ['H40.2', 'N40'], severity: 'medium', effect: 'Anticholinergic antihistamine in glaucoma/BPH.' },
  { cls: 'BETA_BLOCKER', icd: ['J45', 'J44'], noteRe: /asthma/i, severity: 'high', effect: 'Non-selective β-blocker in asthma – bronchospasm.' },
  { cls: 'CORTICOSTEROID_SYS', icd: ['E10', 'E11', 'E13', 'E14'], severity: 'medium', effect: 'Systemic corticosteroid in diabetes – hyperglycaemia; document glucose monitoring.' },
  { cls: 'METFORMIN', icd: ['N18.4', 'N18.5', 'N18.6', 'N17'], severity: 'high', effect: 'Metformin with eGFR < 30 – lactic acidosis risk.' },
  { cls: 'QT_PROLONGING', icd: ['I45.81', 'I49.8', 'R94.31', 'E87.6'], noteRe: /long qt|qt prolong|hypokal/i, severity: 'high', effect: 'QT-prolonging drug with QT prolongation/hypokalaemia.' },
  { cls: 'D2_ANTIEMETIC', icd: ['G20', 'G21'], noteRe: /parkinson/i, severity: 'high', effect: 'Metoclopramide/domperidone in Parkinsonism.' },
  { cls: 'QUINOLONE', icd: ['G70', 'M35.7'], noteRe: /myasthenia/i, severity: 'high', effect: 'Fluoroquinolone in myasthenia gravis (boxed warning).' },
];

/** Pregnancy: FDA category X / D or SFDA "contraindicated in pregnancy". */
export const PREGNANCY_AVOID: { cls?: DrugClass; re?: RegExp; severity: 'critical' | 'high' | 'medium'; effect: string }[] = [
  { cls: 'TETRACYCLINE', severity: 'critical', effect: 'Tetracyclines are contraindicated in pregnancy (tooth discoloration, bone growth).' },
  { cls: 'QUINOLONE', severity: 'high', effect: 'Fluoroquinolones are avoided in pregnancy (cartilage toxicity).' },
  { cls: 'NSAID', severity: 'high', effect: 'NSAIDs: avoid after 20 weeks (oligohydramnios, ductus closure – FDA 2020); avoid in 1st trimester when possible.' },
  { cls: 'ACEI_ARB', severity: 'critical', effect: 'ACE inhibitors/ARBs are fetotoxic (contraindicated).' },
  { cls: 'STATIN', severity: 'high', effect: 'Statins are avoided in pregnancy.' },
  { cls: 'ANTICOAGULANT', re: /warfarin/i, severity: 'critical', effect: 'Warfarin is teratogenic.' },
  { re: /isotretinoin|misoprostol|methotrexate|valpro|leflunomide|finasteride|dutasteride|thalidomide|ribavirin/i, severity: 'critical', effect: 'Teratogenic drug – contraindicated in pregnancy.' },
  { cls: 'TRAMADOL', severity: 'medium', effect: 'Tramadol: avoid in pregnancy (neonatal withdrawal) unless essential.' },
  { cls: 'OPIOID', re: /codeine/i, severity: 'medium', effect: 'Codeine: avoid in pregnancy/lactation.' },
  { cls: 'DECONGESTANT', severity: 'medium', effect: 'Oral decongestants: avoid in 1st trimester.' },
  { re: /domperidone/i, severity: 'medium', effect: 'Domperidone: not recommended in pregnancy (SFDA SPC).' },
];

export interface AgeRule {
  re: RegExp;
  minAge?: number;
  maxAge?: number;
  severity: 'critical' | 'high' | 'medium';
  effect: string;
  injectableOnly?: boolean;
  /** Adult strength products only. */
  strengthRe?: RegExp;
}

export const AGE_RULES: AgeRule[] = [
  { re: /doxycycline|tetracycline|minocycline/i, minAge: 8, severity: 'critical', effect: 'Tetracyclines are contraindicated under 8 years (permanent tooth staining).' },
  { re: /ciprofloxacin|levofloxacin|moxifloxacin|ofloxacin|norfloxacin/i, minAge: 18, severity: 'high', effect: 'Systemic fluoroquinolones are not recommended under 18 years (arthropathy) except specific indications.' },
  { re: /codeine|tramadol/i, minAge: 12, severity: 'critical', effect: 'Codeine/tramadol contraindicated under 12 years (FDA/SFDA – respiratory depression).' },
  { re: /aspirin|acetylsalicylic/i, minAge: 16, severity: 'high', effect: 'Aspirin is avoided under 16 years (Reye syndrome) except Kawasaki/specialist use.' },
  { re: /promethazine/i, minAge: 2, severity: 'critical', effect: 'Promethazine contraindicated under 2 years (fatal respiratory depression).' },
  { re: /metoclopramide/i, minAge: 18, severity: 'high', effect: 'Metoclopramide: EMA restricts use < 18 years (2nd line, 1–18 y only) – extrapyramidal reactions.' },
  { re: /domperidone/i, minAge: 12, severity: 'high', effect: 'Domperidone: EMA/SFDA – not for < 12 years or < 35 kg.' },
  { re: /loperamide/i, minAge: 6, severity: 'high', effect: 'Loperamide is not recommended under 6 years (ileus).' },
  { re: /pseudoephedrine|phenylephrine|triprolidine|chlorphenamine|chlorpheniramine|brompheniramine|dextromethorphan|guaifenesin/i, minAge: 6, severity: 'high', effect: 'OTC cough & cold combinations are not recommended under 6 years (MHRA/FDA).' },
  { re: /xylometazoline|oxymetazoline/i, minAge: 12, strengthRe: /0\.1\s*%|0\.05\s*%.*adult|adult/i, severity: 'medium', effect: 'Adult-strength nasal decongestant (0.1 %) in a child < 12 years – use paediatric 0.05 %.' },
  { re: /xylometazoline|oxymetazoline|naphazoline/i, minAge: 2, severity: 'high', effect: 'Nasal decongestants are not recommended under 2 years.' },
  { re: /ketorolac/i, minAge: 16, severity: 'high', effect: 'Ketorolac is not licensed under 16 years.' },
  { re: /lornoxicam|etoricoxib|celecoxib|meloxicam|piroxicam|tenoxicam|nimesulide|loxoprofen|aceclofenac/i, minAge: 16, severity: 'high', effect: 'This NSAID is not licensed for children/adolescents (SFDA SPC).' },
  { re: /diclofenac/i, minAge: 14, injectableOnly: true, severity: 'high', effect: 'Parenteral diclofenac is not recommended in children.' },
  { re: /ibuprofen/i, minAge: 0.25, severity: 'high', effect: 'Ibuprofen is not recommended under 3 months.' },
  { re: /butylscopolamine|hyoscine/i, minAge: 6, injectableOnly: true, severity: 'high', effect: 'Parenteral hyoscine butylbromide is not recommended in young children; CHI DDF AGE edit avoids use in paediatrics.' },
  { re: /dimenhydrinate|diphenhydramine/i, minAge: 2, severity: 'high', effect: 'Dimenhydrinate/diphenhydramine are not for children under 2 years.' },
  { re: /ondansetron/i, minAge: 18, injectableOnly: true, severity: 'medium', effect: 'Payer age edit observed (Tawuniya: "Drug inconsistent with patient\'s age" for a 16-year-old) – document weight-based paediatric dose and failed oral therapy.' },
  { re: /chlorzoxazone|orphenadrine|methocarbamol|tizanidine|thiocolchicoside/i, minAge: 18, severity: 'medium', effect: 'Skeletal muscle relaxants are not established for paediatric use.' },
  { re: /benzocaine/i, minAge: 2, severity: 'high', effect: 'Benzocaine oral gels are contraindicated under 2 years (methaemoglobinaemia).' },
  { re: /mebeverine/i, minAge: 18, severity: 'medium', effect: 'Mebeverine is licensed for adults (IBS).' },
  { re: /montelukast/i, minAge: 0.5, severity: 'medium', effect: 'Montelukast is not licensed under 6 months.' },
  { re: /chlorphenamine|chlorpheniramine/i, minAge: 1, severity: 'high', effect: 'Chlorphenamine is not recommended under 1 year.' },
  // Elderly – AGS Beers Criteria 2023
  { re: /chlorphenamine|chlorpheniramine|diphenhydramine|hydroxyzine|promethazine|dimenhydrinate|triprolidine/i, maxAge: 65, severity: 'medium', effect: 'Beers 2023: first-generation antihistamines are potentially inappropriate ≥ 65 y (anticholinergic, falls).' },
  { re: /butylscopolamine|hyoscine|dicycloverine|dicyclomine|orphenadrine|chlorzoxazone|methocarbamol/i, maxAge: 65, severity: 'medium', effect: 'Beers 2023: antispasmodics / muscle relaxants are potentially inappropriate ≥ 65 y.' },
  { re: /ketorolac|indomethacin|indometacin|piroxicam|ketoprofen|meloxicam/i, maxAge: 65, severity: 'medium', effect: 'Beers 2023: avoid long-term non-selective NSAIDs ≥ 65 y unless gastroprotected.' },
  { re: /diazepam|alprazolam|clonazepam|lorazepam|bromazepam/i, maxAge: 65, severity: 'medium', effect: 'Beers 2023: avoid benzodiazepines ≥ 65 y.' },
  { re: /metoclopramide/i, maxAge: 65, severity: 'medium', effect: 'Beers 2023: avoid metoclopramide ≥ 65 y unless gastroparesis.' },
];

/** Non-drug items that payers decline as "not a medication" or excluded under CHI policy. */
export const NON_DRUG_ITEMS: { re: RegExp; label: string; why: string; icdOk?: string[] }[] = [
  { re: /\bnan\b|formula|similac|aptamil|bebelac|neocate|alfare|nutramigen|enfamil|s-26|milk/i, label: 'Infant formula / milk', why: 'Standard infant formula is excluded; special formulas are covered only with a documented medical condition (e.g. cow’s-milk protein allergy K52.2/Z91.011, metabolic disorder) and specialist prescription.', icdOk: ['K52.2', 'Z91.0', 'E70', 'E71', 'E72', 'E73', 'E74', 'E84', 'K90'] },
  { re: /sunscreen|sunblock|shampoo|moisturi|cosmetic|lotion.*(skin care)|soap|cleanser|serum|toothpaste|mouthwash|lip balm/i, label: 'Cosmetic / toiletry', why: 'Cosmetics and toiletries are a CHI policy exclusion.' },
  { re: /multivit|supplement|omega|collagen|biotin|herbal|ginseng|royal jelly|probiotic/i, label: 'Supplement / vitamin', why: 'Food supplements and multivitamins are excluded unless a deficiency is diagnosed (E50–E64) and the product is SFDA-registered as a medicine.', icdOk: ['E50', 'E51', 'E52', 'E53', 'E54', 'E55', 'E56', 'E58', 'E61', 'E63', 'E64', 'D50', 'D51', 'D52', 'O99.0', 'K90', 'N18'] },
];
