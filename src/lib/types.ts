/** The hospital contracts with exactly two insurers. "Both" is a reporting view, never a payer value. */
export type Payer = 'Bupa' | 'Tawuniya';
export type PayerView = Payer | 'Both';
export const PAYERS: Payer[] = ['Bupa', 'Tawuniya'];

export type FileType = 'claims' | 'rejections' | 'reference';
export type ReferenceKind = 'price-list' | 'approval-list' | 'drug-formulary' | 'other';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type AuditArea =
  | 'Diagnosis ↔ Service'
  | 'Drug ↔ Diagnosis'
  | 'Drug safety & interactions'
  | 'Vital signs ↔ History'
  | 'Missing medical data'
  | 'Severity / Justification'
  | 'ICD coding quality'
  | 'Technical & administrative'
  | 'Historical rejection pattern';

/** What kind of statement a finding makes – kept distinct so reviewers know how much weight it carries. */
export type FindingKind = 'data-error' | 'missing-documentation' | 'clinical-concern' | 'historical-pattern' | 'unable-to-verify';

/** Who a rule applies to. */
export type RuleScope = 'Shared' | Payer;

export interface Diagnosis {
  code: string;
  desc: string;
  /** Source column, e.g. ICD1, diag 2. */
  column?: string;
}

export interface Vitals {
  bpSys?: number;
  bpDia?: number;
  temp?: number;
  pulse?: number;
  rr?: number;
  height?: number;
  weight?: number;
  spo2?: number;
}

export interface ServiceLine {
  id: string; // `${importId}#${rowNo}`
  importId: string;
  rowNo: number; // 1-based row number in the source file (including the header offset)
  invoice: string;
  category: string;
  code: string;
  desc: string;
  units: number;
  billed: number;
  net: number;
  patientShare: number;
  discount: number;
  deductible: number;
  netVat?: number;
  cashVat?: number;
  gtin?: string;
  tooth?: string;
}

export interface Claim {
  /** Encounter key (see parse.ts grouping): payer + MRN + service date + physician + encounter type. */
  id: string;
  claimNo: string; // as exported; may be empty when the HIS sends -1
  mrn: string;
  patientName: string;
  gender: 'M' | 'F' | '';
  ageYears: number | null;
  ageText: string;
  maritalStatus: string;
  nationality: string;
  payer: Payer;
  payerRaw: string;
  policyHolder: string;
  memberId: string;
  className: string;
  approvalNo: string;
  encounterType: string;
  physicianId: string;
  physician: string;
  specialty: string;
  serviceDate: string; // ISO yyyy-mm-dd
  admissionDate: string;
  submissionDate: string;
  period: string; // yyyy-mm
  diagnoses: Diagnosis[];
  vitals: Vitals;
  lmp: string;
  history: string;
  examination: string;
  plan: string;
  onsetFlag: string;
  lines: ServiceLine[];
  invoices: string[];
  /** Why the grouping may be wrong (empty when unambiguous). */
  groupingWarnings: string[];
  groupingBasis: string;
  sourceFile: string;
  importId: string;
}

export interface Finding {
  id: string;
  ruleId: string;
  area: AuditArea;
  kind: FindingKind;
  scope: RuleScope;
  severity: Severity;
  title: string;
  detail: string;
  /** What in the record supports the finding (quoted note, vitals, codes). */
  evidence?: string;
  fix: string;
  suggestedNote?: string;
  lineIds?: string[];
  amountAtRisk: number;
  refs: string[];
}

export interface ClaimAudit {
  claim: Claim;
  findings: Finding[];
  score: number;
  /** Net SAR of distinct lines touched by critical/high findings (each line counted once). */
  amountAtRisk: number;
  worst: Severity | null;
}

export type RejectionGroup = 'Medical' | 'Technical/Administrative' | 'Needs review';

export type LinkStatus = 'linked' | 'probable' | 'invoice-only' | 'unmatched';

export interface Rejection {
  id: string; // `${importId}#${rowNo}`
  importId: string;
  rowNo: number;
  payer: Payer;
  source: string;
  batch: string;
  period: string; // yyyy-mm (service month when known, else statement period)
  claimRef: string;
  invoice: string;
  serviceCode: string;
  serviceDesc: string;
  /** Rejected net amount (excludes VAT, patient share, discounts). */
  amount: number;
  /** Line-level VAT on the rejected amount, only when the payer file provides it. */
  vat: number | null;
  /** Price excess reported separately by the payer (not counted as rejected amount). */
  priceExcess: number;
  reasonRaw: string;
  reasonCode: string; // payer's own code (e.g. Bupa REJ_CODE)
  nphiesCode: string;
  causeId: string;
  cause: string;
  group: RejectionGroup;
  subcategory: string;
  confidence: 'code' | 'description' | 'none';
  overridden: boolean;
  category: string;
  icd: string;
  doctor: string;
  specialty: string;
  serviceDate: string;
  appealStatus: string;
  appealText: string;
  icdsNamed: string[];
  link: LinkStatus;
  linkedClaim?: string;
  linkedLine?: string;
}

/** Non-rejection financial rows found in statements (deductible differences etc.), reported separately. */
export interface FinancialAdjustment {
  id: string;
  importId: string;
  rowNo: number;
  payer: Payer;
  period: string;
  label: string;
  amount: number;
  vat: number | null;
}
