/**
 * Pre-submission sheet check: takes the HIS export exactly as uploaded and marks every row and cell with the
 * problems found (colour = type of problem) plus a short suggested correction, ready to fix before the portal.
 */
import type { ClaimAudit, Finding, Severity } from './types';
import { CLAIM_ALIASES, encounterKey, money, norm, parseDate, pick } from './parse';

export type Cat = 'doc' | 'vitals' | 'coding' | 'drug' | 'safety' | 'service' | 'technical' | 'coverage';

export const CATS: Record<Cat, { label: string; covers: string; fill: string; ink: string }> = {
  doc: { label: 'History & documentation', covers: 'Short/missing history, duration, examination, plan, severity, injury details, LMP', fill: 'FFC7CE', ink: '9C0006' },
  vitals: { label: 'Vital signs', covers: 'Missing or wrong vitals, vitals that contradict the history or codes', fill: 'FFD8A8', ink: '8A4B00' },
  coding: { label: 'ICD coding', covers: 'Missing, incomplete, conflicting or wrong ICD-10 codes', fill: 'E4D3F5', ink: '5B2C83' },
  drug: { label: 'Drug ↔ diagnosis', covers: 'Drug not indicated for the coded diagnosis, inpatient-only drugs', fill: 'C6EFCE', ink: '006100' },
  safety: { label: 'Interactions & drug safety', covers: 'Interactions, duplicate drugs, age/pregnancy/disease conflicts, high quantity', fill: 'F8CBE4', ink: '8B1A5A' },
  service: { label: 'Lab / radiology / procedure', covers: 'Service not justified by diagnosis or documentation', fill: 'FFEB9C', ink: '7A5C00' },
  technical: { label: 'Technical & billing', covers: 'Price list, approvals, member ID, codes, amounts, dates, duplicates, follow-up', fill: 'CFE2FF', ink: '0B3D91' },
  coverage: { label: 'Not covered / always rejected', covers: 'Items the insurer always rejects, excluded diagnoses, work/RTA cases, non-formulary', fill: 'D9D9D9', ink: '262626' },
};
export const CAT_ORDER: Cat[] = ['coverage', 'technical', 'drug', 'service', 'coding', 'doc', 'vitals', 'safety'];

export type Level = 'must' | 'review' | 'info';
const levelOf = (s: Severity): Level => (s === 'critical' || s === 'high' ? 'must' : s === 'medium' ? 'review' : 'info');
export const LEVEL_LABEL: Record<Level, string> = { must: 'Must fix', review: 'Review', info: 'Info' };

/** Logical fields of the HIS export and the header names they can have. */
const FIELDS: Record<string, string[]> = {
  history: ['Chief complaint', 'History', 'HPI', 'Clinical Notes', 'Complaint'],
  exam: ['Examination', 'Physical Examination', 'Clinical Examination', 'Signs', 'Findings'],
  plan: ['Plan', 'Management Plan', 'Treatment Plan'],
  lmp: ['LMP'],
  temp: ['Temperature', 'Temp'],
  bp: ['BP', 'Blood Pressure'],
  pulse: ['pulse', 'Heart Rate', 'HR'],
  rr: ['Respiratory Rate', 'RR'],
  spo2: ['SpO2', 'Oxygen Saturation', 'O2 Sat'],
  weight: ['Weight'],
  height: ['Height'],
  icd: ['ICD1', 'ICD', 'ICD Code', 'Diagnosis Code', 'Principal Diagnosis', 'Primary Diagnosis', 'Diagnosis', 'initial diag', 'diag 2', 'diag 3 code', 'diag 3', 'ICD2', 'ICD3'],
  icddesc: ['diag desc', 'ICD Description', 'Diagnosis Description'],
  service: ['ServiceDescription', 'Service Description', 'Service Name', 'Service', 'Item Description', 'Item Name', 'Description', 'Procedure Name'],
  code: ['service code', 'Service Code', 'Item Code', 'Code'],
  units: ['ServiceUnits', 'Qty', 'Quantity'],
  amount: ['BilledAmount', 'Gross'],
  net: ['Net amount', 'Net'],
  share: ['PatientPayAmount'],
  approval: ['approval no', 'Pre-Auth', 'Approval Number'],
  member: ['Membership No', 'Member Id', 'UNIQUE MEMBERID'],
  payer: ['ins comp name', 'Ins company', 'Payer', 'Insurance'],
  physician: ['Physician name', 'Doctor Name', 'Doctor', 'Physician Id', 'Doctor Code'],
  date: ['Service date', 'Date of admission'],
  subdate: ['date of submission'],
  gender: ['gender', 'sex'],
  age: ['Age'],
  tooth: ['Tooth Number'],
  claim: CLAIM_ALIASES.claim,
  mrn: ['MRN', 'File No', 'Patient File No', 'Patient No', 'Patient ID', 'Medical Record No'],
  name: ['Name', 'Patient Name'],
};
type Field = keyof typeof FIELDS;

const VITAL_FIELD: Record<string, Field> = { temperature: 'temp', 'blood pressure': 'bp', bp: 'bp', pulse: 'pulse', 'respiratory rate': 'rr', rr: 'rr', 'spo₂': 'spo2', spo2: 'spo2', weight: 'weight', height: 'height' };

export function catOf(f: Pick<Finding, 'ruleId'>): Cat {
  const r = f.ruleId;
  if (r === 'WATCH-WARN' || ['DOC-006', 'DOC-007', 'COD-007', 'DDX-002', 'DDX-006', 'SVC-005'].includes(r)) return 'coverage';
  if (r === 'WATCH-REPLACE' || r.startsWith('TEC') || r.startsWith('FUP') || r.startsWith('SYS') || ['DDX-003', 'DDX-005', 'SVC-007', 'SVC-008', 'SVC-009', 'SVC-010'].includes(r)) return 'technical';
  if (r.startsWith('DOC') || r.startsWith('SEV')) return 'doc';
  if (r.startsWith('VIT')) return 'vitals';
  if (r.startsWith('COD')) return 'coding';
  if (r.startsWith('DDX')) return 'drug';
  if (r.startsWith('SAF')) return 'safety';
  return 'service';
}

/** Which cells of the sheet a finding points at. */
function fieldsOf(f: Finding): Field[] {
  const r = f.ruleId;
  const line = f.lineIds?.length ? (['service', 'code'] as Field[]) : [];
  switch (r) {
    case 'DOC-001': case 'DOC-002': case 'DOC-005': case 'DOC-006': case 'DOC-007': case 'DOC-008': return ['history'];
    case 'DOC-003': return ['exam', 'history'];
    case 'DOC-004': return ['plan', 'history'];
    case 'DOC-009': return ['lmp', 'history'];
    case 'SEV-001': case 'SEV-002': return ['history', ...line];
    case 'VIT-001': case 'VIT-002': case 'VIT-003': return ['temp', 'history'];
    case 'VIT-004': return ['pulse', 'history'];
    case 'VIT-005': return ['rr', 'spo2', 'history'];
    case 'VIT-006': case 'VIT-007': return ['bp'];
    case 'VIT-008': return ['pulse', 'bp', 'history'];
    case 'VIT-011': return ['weight'];
    case 'VIT-012': return ['spo2', ...line];
    case 'VIT-009': case 'VIT-010': {
      const named = Object.entries(VITAL_FIELD).filter(([k]) => f.title.toLowerCase().includes(k)).map(([, v]) => v);
      return named.length ? [...new Set(named)] : ['temp', 'bp', 'pulse', 'rr'];
    }
    case 'COD-001': case 'COD-002': case 'COD-003': case 'COD-004': case 'COD-005': case 'COD-006': case 'COD-007': case 'COD-008': case 'COD-009': return ['icd', 'icddesc', ...(r === 'COD-002' ? ['gender' as Field] : r === 'COD-003' ? ['age' as Field] : [])];
    case 'SVC-007': case 'DDX-005': return ['approval', ...line];
    case 'SVC-008': case 'SVC-009': return ['tooth', ...line];
    case 'SAF-005': return ['units', ...line];
  }
  if (r.startsWith('DDX') || r.startsWith('SVC') || r.startsWith('SAF')) return [...line, 'icd'];
  return line.length ? line : ['service'];
}

const codesIn = (s: string) => [...new Set(s.match(/\b[A-Z]\d{2}(?:\.[0-9A-Z]{1,4}|\.x)?\b/g) ?? [])].slice(0, 3);
const after = (s: string, sep = ':') => (s.includes(sep) ? s.slice(s.indexOf(sep) + 1).trim() : s);
const firstSentence = (s: string, max = 90) => {
  const t = s.split(/(?<=[.;])\s/)[0].replace(/\.$/, '');
  return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t;
};

/** Brief correction, one line, no explanation. */
export function briefFix(f: Finding): string {
  const t = f.title;
  const icd = codesIn(f.fix);
  const withIcd = (base: string) => (icd.length ? `${base} (${icd.join(', ')})` : base);
  switch (f.ruleId) {
    case 'WATCH-REPLACE': return firstSentence(f.fix.split(/,? or |, and | – /)[0], 90);
    case 'WATCH-WARN': return 'Do not bill to insurance – covered alternative or cash';
    case 'COD-001': return 'Add principal ICD-10 code';
    case 'COD-002': return 'Correct gender or ICD code';
    case 'COD-003': return 'Correct age or ICD code';
    case 'COD-004': return 'Use the full specific code (4th/5th character)';
    case 'COD-005': return 'Remove the less specific code';
    case 'COD-006': return 'Remove symptom code unless it justifies a service';
    case 'COD-007': return 'Code the treated condition as principal, or bill cash';
    case 'COD-008': return 'Add external-cause code (W/X/V/Y)';
    case 'COD-009': return 'Code pregnancy O-code first';
    case 'DDX-001': return withIcd('Add ICD this drug treats or change the drug');
    case 'DDX-002': return 'Use formulary alternative or attach justification';
    case 'DDX-003': return 'Use valid SFDA/CHI drug code';
    case 'DDX-004': return 'Outpatient alternative or document emergency use';
    case 'DDX-005': return /quantity/i.test(t) ? 'Reduce to the allowed quantity' : /specialist/i.test(t) ? 'Must be prescribed by the specialist' : 'Get approval and add approval no.';
    case 'DDX-006': return withIcd('Add supporting ICD or bill cash');
    case 'DOC-001': return 'Write full history: complaint, onset/duration, symptoms';
    case 'DOC-002': return 'Add onset/duration (e.g. “for 3 days”)';
    case 'DOC-003': return 'Add examination findings';
    case 'DOC-004': return 'Add management plan';
    case 'DOC-005': return `Add injury details: ${after(t)}`;
    case 'DOC-006': return 'Work-related: bill employer/GOSI, not insurer';
    case 'DOC-007': return 'RTA: bill motor insurance, add police report';
    case 'DOC-008': return 'Add police / medico-legal report no.';
    case 'DOC-009': return 'Add LMP and gestational age';
    case 'FUP-001': return 'Remove consultation fee (free follow-up)';
    case 'FUP-002': return 'Remove duplicate or justify units';
    case 'FUP-003': return 'Remove, or document reason for early refill';
    case 'SAF-001': return /^Duplication/.test(t) ? 'Bill one product only' : 'Remove one drug or document safe use';
    case 'SAF-002': return 'Change drug or document precaution';
    case 'SAF-003': return 'Use pregnancy-safe alternative';
    case 'SAF-004': return 'Age-appropriate alternative or justify';
    case 'SAF-005': return 'Bill the exact course quantity';
    case 'SEV-001': return 'Document severity and why not oral';
    case 'SEV-002': return 'Document severity/grade';
    case 'SVC-001': case 'SVC-002': case 'SVC-003': case 'SVC-006': case 'SVC-011': return withIcd('Add justifying ICD + findings, or remove');
    case 'SVC-004': return 'Check gender/age or remove service';
    case 'SVC-005': return withIcd('Add covered indication or bill cash');
    case 'SVC-007': return 'Get pre-approval and add approval no.';
    case 'SVC-008': return 'Add tooth number';
    case 'SVC-009': return 'Correct tooth number / procedure';
    case 'SVC-010': return 'Bill the injected drug or remove admin fee';
    case 'VIT-001': return 'Correct temperature or remove fever';
    case 'VIT-002': return 'Correct temperature or history';
    case 'VIT-003': return 'Mention fever in history / add R50.9';
    case 'VIT-004': case 'VIT-005': case 'VIT-006': case 'VIT-008': return 'Correct the vital sign or the history';
    case 'VIT-007': return 'Repeat BP, add plan / I10';
    case 'VIT-009': return `Record ${after(t)}`;
    case 'VIT-010': return 'Correct wrong vital values';
    case 'VIT-011': return 'Record weight';
    case 'VIT-012': return 'Record SpO₂';
  }
  return firstSentence(f.fix);
}

export interface SheetIssue {
  cat: Cat;
  level: Level;
  ruleId: string;
  text: string;
  fix: string;
  cols: number[];
}
export interface SheetRow {
  i: number;
  claimId: string;
  cells: string[];
  issues: SheetIssue[];
  /** Column index → category that colours it. */
  marks: Map<number, Cat>;
  level: Level | null;
}
export interface SheetCheck {
  name: string;
  header: string[];
  rows: SheetRow[];
  col: (f: string) => number;
  colsOf: (f: string) => number[];
  counts: Record<Cat, number>;
  encounters: number;
  mustRows: number;
}

export interface SheetSource {
  name: string;
  section: string;
  header: string[];
  records: Record<string, string>[];
}

const LEVEL_RANK: Record<Level, number> = { must: 0, review: 1, info: 2 };

/** Billing and data checks done on the raw rows (things a portal or the payer's edits reject automatically). */
function technicalChecks(src: SheetSource, today: string): Map<number, { ruleId: string; severity: Severity; text: string; fix: string; fields: Field[] }[]> {
  const out = new Map<number, { ruleId: string; severity: Severity; text: string; fix: string; fields: Field[] }[]>();
  const add = (i: number, x: { ruleId: string; severity: Severity; text: string; fix: string; fields: Field[] }) => out.set(i, [...(out.get(i) ?? []), x]);
  const seenEnc = new Set<string>();
  const sameDay = new Map<string, { claim: string; i: number }>();
  src.records.forEach((r, i) => {
    const claimNo = pick(r, ...CLAIM_ALIASES.claim);
    const desc = pick(r, ...FIELDS.service);
    const code = pick(r, ...FIELDS.code);
    if (!claimNo) {
      if (desc || code) add(i, { ruleId: 'TEC-001', severity: 'critical', text: 'Row has no claim / visit number', fix: 'Link the service to a claim number', fields: ['claim'] });
      return;
    }
    if (!desc && !code) return;
    const key = encounterKey(r);
    const date = parseDate(pick(r, ...FIELDS.date));
    if (!code) add(i, { ruleId: 'TEC-002', severity: 'critical', text: `No service code: ${desc}`, fix: 'Add the contracted service code', fields: ['code', 'service'] });
    const billed = money(pick(r, ...FIELDS.amount));
    const net = money(pick(r, ...FIELDS.net));
    const share = money(pick(r, ...FIELDS.share));
    const unitsRaw = pick(r, ...FIELDS.units);
    if (pick(r, ...FIELDS.amount) !== '' && billed <= 0) add(i, { ruleId: 'TEC-003', severity: 'high', text: `Billed amount ${billed}`, fix: 'Enter the price-list amount', fields: ['amount'] });
    if (net > billed + 0.01 && billed > 0) add(i, { ruleId: 'TEC-004', severity: 'high', text: `Net ${net} is more than billed ${billed}`, fix: 'Correct net / discount', fields: ['net', 'amount'] });
    if (share > billed + 0.01 && billed > 0) add(i, { ruleId: 'TEC-005', severity: 'high', text: `Patient share ${share} is more than billed ${billed}`, fix: 'Correct patient share', fields: ['share', 'amount'] });
    if (unitsRaw && !(parseFloat(unitsRaw) > 0)) add(i, { ruleId: 'TEC-006', severity: 'high', text: `Quantity "${unitsRaw}"`, fix: 'Enter a quantity of 1 or more', fields: ['units'] });
    const mrn = pick(r, ...FIELDS.mrn);
    if (mrn && date && code) {
      const k = `${mrn}|${date}|${code}`;
      const prev = sameDay.get(k);
      if (prev && prev.claim !== claimNo) add(i, { ruleId: 'TEC-007', severity: 'high', text: `Same service billed same day on claim ${prev.claim}`, fix: 'Remove the duplicate claim line', fields: ['service', 'code'] });
      else if (!prev) sameDay.set(k, { claim: claimNo, i });
    }
    if (seenEnc.has(key)) return;
    seenEnc.add(key);
    // Encounter-level data (checked once, on the encounter's first row).
    if (!pick(r, ...FIELDS.member)) add(i, { ruleId: 'TEC-010', severity: 'critical', text: 'Membership / member ID missing', fix: 'Add member ID from the insurance card', fields: ['member'] });
    if (!pick(r, ...FIELDS.payer)) add(i, { ruleId: 'TEC-011', severity: 'medium', text: 'Insurance company missing', fix: 'Select the payer', fields: ['payer'] });
    if (!pick(r, 'Physician name', 'Doctor Name', 'Doctor')) add(i, { ruleId: 'TEC-012', severity: 'medium', text: 'Treating doctor missing', fix: 'Add the treating physician', fields: ['physician'] });
    if (!date) add(i, { ruleId: 'TEC-013', severity: 'critical', text: 'Service date missing or invalid', fix: 'Enter the visit date (dd-mm-yyyy)', fields: ['date'] });
    else if (date > today) add(i, { ruleId: 'TEC-014', severity: 'critical', text: `Service date ${date} is in the future`, fix: 'Correct the service date', fields: ['date'] });
    const sub = parseDate(pick(r, ...FIELDS.subdate));
    if (sub && date && sub < date) add(i, { ruleId: 'TEC-015', severity: 'high', text: `Submission date ${sub} before service date ${date}`, fix: 'Correct service / submission date', fields: ['subdate', 'date'] });
    if (!pick(r, ...FIELDS.gender)) add(i, { ruleId: 'TEC-016', severity: 'medium', text: 'Gender missing', fix: 'Add patient gender', fields: ['gender'] });
    if (!pick(r, ...FIELDS.age)) add(i, { ruleId: 'TEC-017', severity: 'medium', text: 'Age missing', fix: 'Add patient age / date of birth', fields: ['age'] });
  });
  return out;
}

/** Marks the uploaded sheet with every finding of the full audit (medical + technical) plus raw-row billing checks. */
export function checkSheet(src: SheetSource, audits: Map<string, ClaimAudit>, today = new Date().toISOString().slice(0, 10)): SheetCheck {
  const keys = src.header.map((h) => norm(h));
  const fieldCols = new Map<Field, number[]>();
  for (const [f, names] of Object.entries(FIELDS) as [Field, string[]][]) {
    // History etc. take the first matching alias; ICD takes every diagnosis column.
    const idx = names.map((n) => keys.indexOf(norm(n))).filter((i) => i >= 0);
    fieldCols.set(f, f === 'icd' ? [...new Set(idx)] : idx.slice(0, 1));
  }
  const serviceCol = fieldCols.get('service')?.[0] ?? 0;
  const colsFor = (fields: Field[]) => {
    for (const f of fields) {
      const c = fieldCols.get(f) ?? [];
      if (c.length) return fields.flatMap((x) => fieldCols.get(x) ?? []);
    }
    return [serviceCol];
  };

  const rows: SheetRow[] = src.records.map((r, i) => ({
    i,
    claimId: pick(r, ...CLAIM_ALIASES.claim) ? `${src.section}:${encounterKey(r)}` : '',
    cells: src.header.map((h) => {
      const v = r[norm(h)] ?? '';
      return v === '-1' ? '' : v;
    }),
    issues: [],
    marks: new Map(),
    level: null,
  }));

  const firstRow = new Map<string, number>();
  for (const row of rows) if (row.claimId && !firstRow.has(row.claimId)) firstRow.set(row.claimId, row.i);

  const put = (i: number, issue: SheetIssue) => {
    const row = rows[i];
    if (!row || row.issues.some((x) => x.ruleId === issue.ruleId && x.text === issue.text)) return;
    row.issues.push(issue);
  };

  for (const [claimId, i0] of firstRow) {
    const a = audits.get(claimId);
    if (!a) continue;
    for (const f of a.findings) {
      const issue = { cat: catOf(f), level: levelOf(f.severity), ruleId: f.ruleId, text: f.title, fix: briefFix(f), cols: colsFor(fieldsOf(f)) };
      const lineRows = (f.lineIds ?? []).map((id) => Number(id.slice(id.lastIndexOf('#') + 1))).filter((n) => Number.isInteger(n) && rows[n]);
      if (lineRows.length) for (const n of lineRows) put(n, issue);
      else put(i0, issue);
    }
  }
  for (const [i, list] of technicalChecks(src, today)) {
    for (const t of list) put(i, { cat: 'technical', level: levelOf(t.severity), ruleId: t.ruleId, text: t.text, fix: t.fix, cols: colsFor(t.fields) });
  }

  const counts = Object.fromEntries(CAT_ORDER.map((c) => [c, 0])) as Record<Cat, number>;
  let mustRows = 0;
  for (const row of rows) {
    row.issues.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat));
    // Most important problem wins the cell colour.
    for (const is of row.issues) for (const c of is.cols) if (!row.marks.has(c)) row.marks.set(c, is.cat);
    for (const is of row.issues) counts[is.cat]++;
    row.level = row.issues[0]?.level ?? null;
    if (row.level === 'must') mustRows++;
  }
  return {
    name: src.name, header: src.header, rows, counts, encounters: firstRow.size, mustRows,
    col: (f: string) => fieldCols.get(f as Field)?.[0] ?? -1,
    colsOf: (f: string) => fieldCols.get(f as Field) ?? [],
  };
}
