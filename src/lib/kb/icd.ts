/**
 * ICD-10 (ICD-10-AM as adopted by CHI/NPHIES) coding-quality rules.
 * Sources: ICD-10-AM Australian Coding Standards (ACS 0001 principal diagnosis, ACS 0002 additional diagnoses,
 * ACS 1901/2001 injuries & external causes), WHO ICD-10 Volume 2 sex/age edits, NPHIES code-set validation.
 */

const starts = (code: string, prefixes: string[]) => prefixes.some((p) => code.startsWith(p));

export const FEMALE_ONLY = ['O', 'Z32', 'Z33', 'Z34', 'Z35', 'Z36', 'Z37', 'Z39', 'Z3A', 'N70', 'N71', 'N72', 'N73', 'N74', 'N75', 'N76', 'N77', 'N80', 'N81', 'N82', 'N83', 'N84', 'N85', 'N86', 'N87', 'N88', 'N89', 'N90', 'N91', 'N92', 'N93', 'N94', 'N95', 'N96', 'N97', 'N98', 'C51', 'C52', 'C53', 'C54', 'C55', 'C56', 'C57', 'C58', 'D25', 'D26', 'D27', 'D28', 'E28', 'Z01.4', 'Z12.4', 'R87', 'O9'];
export const MALE_ONLY = ['N40', 'N41', 'N42', 'N43', 'N44', 'N45', 'N46', 'N47', 'N48', 'N49', 'N50', 'N51', 'N52', 'N53', 'C60', 'C61', 'C62', 'C63', 'D29', 'D40', 'E29', 'Z12.5', 'R86', 'Q53', 'Q54', 'Q55'];

export function sexConflict(code: string, gender: 'M' | 'F' | ''): string | null {
  if (gender === 'M' && starts(code, FEMALE_ONLY)) return 'female-only';
  if (gender === 'F' && starts(code, MALE_ONLY)) return 'male-only';
  return null;
}

export function ageConflict(code: string, age: number | null): string | null {
  if (age === null) return null;
  if (code.startsWith('P') && age > 1) return 'Perinatal (P-chapter) codes are valid only for newborns/infants (originating in the perinatal period).';
  if (code.startsWith('Z38') && age > 0.1) return 'Z38 (liveborn infant) is for the birth episode only.';
  if (code.startsWith('O') && (age < 10 || age > 60)) return 'Obstetric (O-chapter) code outside plausible child-bearing age (10–60).';
  if (starts(code, ['Z34', 'Z3A', 'Z33']) && (age < 10 || age > 60)) return 'Pregnancy supervision code outside plausible child-bearing age.';
  if (starts(code, ['N95.1', 'N95.0']) && age < 30) return 'Menopausal code in a patient under 30.';
  if (starts(code, ['R54']) && age < 60) return 'R54 (senility/age-related debility) in a patient under 60.';
  if (starts(code, ['F01', 'F03', 'G30']) && age < 40) return 'Dementia code in a young patient – verify.';
  if (starts(code, ['K00.6', 'K00.7']) && age > 16) return 'Teething / disturbed eruption of primary teeth code in an adult.';
  if (starts(code, ['M81', 'M80']) && age < 18) return 'Osteoporosis code in a child – verify (secondary causes need their own codes).';
  if (starts(code, ['I10', 'I11', 'E78']) && age < 10) return 'Adult chronic-disease code in a young child – verify.';
  if (starts(code, ['N40', 'C61']) && age < 30) return 'Prostate code in a young male – verify.';
  return null;
}

/**
 * Three-character categories that have mandatory 4th/5th characters in ICD-10-AM: submitting the header
 * code alone fails NPHIES code validation ("invalid/non-billable diagnosis code").
 */
export const REQUIRES_SUBCODE = new Set([
  'A09', 'A08', 'B34', 'B35', 'B37', 'D50', 'D64', 'E03', 'E05', 'E07', 'E10', 'E11', 'E14', 'E55', 'E78', 'E87',
  'F32', 'F41', 'G43', 'G44', 'G47', 'H10', 'H52', 'H60', 'H61', 'H65', 'H66', 'H81', 'H92', 'I20', 'I25', 'I83', 'I84',
  'J01', 'J02', 'J03', 'J04', 'J06', 'J18', 'J20', 'J30', 'J32', 'J35', 'J44', 'J45', 'K02', 'K04', 'K05', 'K08', 'K21', 'K25',
  'K29', 'K52', 'K58', 'K59', 'K60', 'K64', 'K80', 'L01', 'L02', 'L03', 'L20', 'L23', 'L25', 'L30', 'L50', 'L60', 'M06', 'M10',
  'M13', 'M15', 'M16', 'M17', 'M19', 'M25', 'M53', 'M54', 'M62', 'M65', 'M75', 'M76', 'M77', 'M79', 'N30', 'N39', 'N76', 'N89',
  'N91', 'N92', 'N93', 'N94', 'O20', 'O21', 'O26', 'R06', 'R07', 'R10', 'R19', 'R25', 'R26', 'R29', 'R39',
  'R50', 'R60', 'R63', 'R68', 'S00', 'S01', 'S06', 'S09', 'S13', 'S20', 'S30', 'S40', 'S50', 'S60', 'S61', 'S63', 'S70',
  'S80', 'S81', 'S83', 'S90', 'S91', 'S93', 'T14', 'T78', 'Z00', 'Z01', 'Z09', 'Z34', 'Z48', 'Z76',
]);

export function isHeaderOnly(code: string): boolean {
  const c = code.replace('.', '');
  return c.length === 3 && REQUIRES_SUBCODE.has(c);
}

export const isInjury = (c: string) => /^[ST]/.test(c) && !/^T(36|37|38|39|4|50|51|52|53|54|55|56|57|58|59|6|7|8)/.test(c);
export const isExternalCause = (c: string) => /^[VWXY]/.test(c) || /^U[5-7]/.test(c);

/** Mutually exclusive pairs (ICD-10 "Excludes1") frequently seen together on OP claims. */
export const EXCLUDES: { a: string; b: string; note: string }[] = [
  { a: 'J00', b: 'J06', note: 'J00 common cold and J06 acute URTI describe the same episode – keep the more specific one.' },
  { a: 'J00', b: 'J02', note: 'J00 (nasopharyngitis) excludes pharyngitis J02 – code J02 if sore throat dominates.' },
  { a: 'J02', b: 'J03', note: 'Pharyngitis and tonsillitis of the same episode – J03 (tonsillitis) takes precedence.' },
  { a: 'J06', b: 'J02', note: 'J06.9 multiple/unspecified sites with J02 – code the specific site only.' },
  { a: 'K29', b: 'K30', note: 'K30 functional dyspepsia excludes gastritis K29.' },
  { a: 'K21', b: 'K30', note: 'K30 dyspepsia excludes GERD K21 (heartburn is integral to GERD).' },
  { a: 'E10', b: 'E11', note: 'Type 1 and type 2 diabetes are mutually exclusive.' },
  { a: 'A09', b: 'K52', note: 'Infectious (A09) and non-infectious (K52) gastroenteritis are mutually exclusive.' },
  { a: 'M54.5', b: 'M54.4', note: 'Low back pain (M54.5) excludes lumbago with sciatica (M54.4).' },
  { a: 'J45', b: 'J44', note: 'Asthma and COPD codes together need explicit documentation of asthma-COPD overlap.' },
  { a: 'R10.0', b: 'R10.4', note: 'Acute abdomen (R10.0) and unspecified abdominal pain (R10.4) for the same visit – keep one.' },
  { a: 'N39.0', b: 'N30', note: 'UTI site not specified (N39.0) with cystitis (N30) – code the specific site only.' },
  { a: 'L20', b: 'L30.9', note: 'Atopic dermatitis with unspecified dermatitis – keep the specific code.' },
];

/** Symptom (R-chapter) codes that are integral to a definitive diagnosis on the same claim (ACS 0001/0002). */
export const INTEGRAL_SYMPTOMS: { symptom: string; definitive: string[] }[] = [
  { symptom: 'R50', definitive: ['J02', 'J03', 'J18', 'J20', 'J01', 'A09', 'N10', 'B34', 'J06', 'J11', 'J10', 'H66'] },
  { symptom: 'R05', definitive: ['J20', 'J18', 'J45', 'J06', 'J00', 'J04'] },
  { symptom: 'R10.1', definitive: ['K29', 'K30', 'K21', 'K80', 'K81', 'K25', 'K26'] },
  { symptom: 'R11', definitive: ['A09', 'A08', 'K29'] },
  { symptom: 'R51', definitive: ['G43', 'G44', 'J01', 'J32'] },
  { symptom: 'R30', definitive: ['N39.0', 'N30', 'N34'] },
  { symptom: 'M54.5', definitive: ['M51', 'M47.8'] },
  { symptom: 'R07.0', definitive: ['J02', 'J03'] },
];

/** Diagnoses that conflict with the documented vital signs. */
export const FEVER_ICD = ['R50', 'R56.0', 'A90', 'A91'];
export const TACHY_ICD = ['R00.0', 'I47', 'I48'];
export const HTN_ICD = ['I10', 'I11', 'I12', 'I13', 'I15', 'O10', 'O13', 'O14', 'O16'];
export const DEHYDRATION_ICD = ['E86'];
export const HYPOTENSION_ICD = ['I95', 'R57'];
