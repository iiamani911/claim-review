export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type AuditArea =
  | 'Diagnosis ↔ Service'
  | 'Drug ↔ Diagnosis'
  | 'Drug safety & interactions'
  | 'Vital signs ↔ History'
  | 'Missing medical data'
  | 'Severity / Justification'
  | 'ICD coding quality'
  | 'Follow-up & duplicates';

export interface Diagnosis {
  code: string;
  desc: string;
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
  id: string;
  invoice: string;
  category: string;
  code: string;
  desc: string;
  units: number;
  billed: number;
  net: number;
  patientShare: number;
  gtin?: string;
  tooth?: string;
}

export interface Claim {
  /** Encounter key: claim no + MRN + service date + physician (one HIS claim no can hold several visits). */
  id: string;
  claimNo: string;
  mrn: string;
  patientName: string;
  gender: 'M' | 'F' | '';
  ageYears: number | null;
  ageText: string;
  maritalStatus: string;
  nationality: string;
  payer: string;
  policyHolder: string;
  memberId: string;
  className: string;
  approvalNo: string;
  encounterType: string;
  physicianId: string;
  physician: string;
  specialty: string;
  serviceDate: string; // ISO yyyy-mm-dd
  submissionDate: string;
  diagnoses: Diagnosis[];
  vitals: Vitals;
  lmp: string;
  history: string; // chief complaint / HPI
  examination: string;
  plan: string;
  onsetFlag: string;
  lines: ServiceLine[];
  sourceFile: string;
}

export interface Finding {
  id: string;
  ruleId: string;
  area: AuditArea;
  severity: Severity;
  title: string;
  detail: string;
  fix: string;
  /** Text the doctor can paste into the note / reply to the payer. */
  suggestedNote?: string;
  lineIds?: string[];
  amountAtRisk: number;
  refs: string[];
}

export interface ClaimAudit {
  claim: Claim;
  findings: Finding[];
  score: number; // 0 (clean) .. 100 (certain rejection)
  amountAtRisk: number;
  worst: Severity | null;
}

export type RejectionGroup = 'Medical' | 'Technical';

export interface Rejection {
  id: string;
  payer: string;
  source: string;
  batch: string;
  claimRef: string;
  invoice: string;
  serviceCode: string;
  serviceDesc: string;
  amount: number;
  reasonRaw: string;
  nphiesCode: string;
  causeId: string;
  cause: string;
  group: RejectionGroup;
  category: string; // service category (Laboratory, Medicine...)
  icd: string;
  doctor: string;
  specialty: string;
  serviceDate: string;
  appealStatus: string; // AGREED / DISAGREED / ''
  appealText: string;
  /** Drug-diagnosis rejections list the diagnosis codes the payer named. */
  icdsNamed: string[];
  /** Claim number in the uploaded HIS export this rejection was linked to. */
  linkedClaim?: string;
}
