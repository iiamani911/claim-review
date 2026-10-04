import * as XLSX from 'xlsx';
import type { Claim, Diagnosis, FileType, Payer, ReferenceKind, ServiceLine } from './types';

/** Physical layout of a file, detected from its bytes rather than its extension. */
export type SourceFormat = 'xlsx' | 'xls-binary' | 'tsv' | 'csv' | 'semicolon';

/** Concrete layout of a detected table. */
export type Layout = 'his-claims' | 'tawuniya-waseel' | 'bupa-clprovstm' | 'generic-rejections' | 'price-list' | 'approval-list' | 'chi-ddf' | 'unknown';

export interface Table {
  sheet: string;
  rows: string[][]; // raw cell text, trimmed
}

export const norm = (s: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** HIS placeholder for "no value". Treated as missing for identifiers, diagnoses, vitals and amounts. */
export const isPlaceholder = (v: string | undefined) => v === undefined || v === '' || v === '-1' || v === '-1.0' || v === 'NULL' || v === 'null' || v === 'N/A';

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

export function sniffFormat(bytes: Uint8Array): SourceFormat {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'xlsx';
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) return 'xls-binary';
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 20000));
  const lines = head.split(/\r?\n/).slice(0, 15);
  const count = (c: string) => lines.reduce((s, l) => s + (l.split(c).length - 1), 0);
  const tabs = count('\t'), commas = count(','), semis = count(';');
  if (tabs >= commas && tabs >= semis && tabs > 0) return 'tsv';
  if (semis > commas) return 'semicolon';
  return 'csv';
}

export function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes); // legacy Windows exports
  }
  return text.replace(/^﻿/, '');
}

export function readTables(buf: ArrayBuffer, name = 'file'): { format: SourceFormat; tables: Table[] } {
  const bytes = new Uint8Array(buf);
  const format = sniffFormat(bytes);
  if (format === 'xlsx' || format === 'xls-binary') {
    // raw:false keeps the displayed text, so codes stored as text keep their leading zeros.
    const wb = XLSX.read(bytes, { type: 'array', cellDates: true, cellText: true });
    return {
      format,
      tables: wb.SheetNames.map((sheet) => ({
        sheet,
        rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, raw: false, defval: '' }).map((r) => (r as unknown[]).map(cellText)),
      })),
    };
  }
  const text = decodeText(bytes);
  const delim = format === 'tsv' ? '\t' : format === 'semicolon' ? ';' : ',';
  const rows = text.split(/\r?\n/).map((l) => (delim === '\t' ? l.split('\t') : splitDelimited(l, delim)).map(cellText));
  while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop();
  return { format, tables: [{ sheet: name, rows }] };
}

function splitDelimited(line: string, d: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === d) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// ───────────── Logical fields & column mapping ─────────────

export interface FieldDef { key: string; label: string; aliases: string[]; required?: boolean }

export const CLAIM_FIELDS: FieldDef[] = [
  { key: 'mrn', label: 'MRN / file no', aliases: ['mrn', 'fileno', 'patientfileno', 'patientno', 'patientid', 'medicalrecordno'] },
  { key: 'name', label: 'Patient name', aliases: ['name', 'patientname', 'membername'] },
  { key: 'gender', label: 'Gender', aliases: ['gender', 'sex'] },
  { key: 'age', label: 'Age', aliases: ['age'] },
  { key: 'maritalStatus', label: 'Marital status', aliases: ['maritalstatus'] },
  { key: 'nationality', label: 'Nationality', aliases: ['nationality'] },
  { key: 'claimNo', label: 'Claim no', aliases: ['claimno', 'claimnumber', 'claimid', 'visitno', 'visitnumber', 'encounterno', 'episodeno'] },
  { key: 'payer', label: 'Insurer', aliases: ['inscompname', 'inscompany', 'insurancecompany', 'payer', 'payername', 'insurer', 'insurance', 'company'] },
  { key: 'policyHolder', label: 'Policy holder', aliases: ['policyholder'] },
  { key: 'memberId', label: 'Membership no', aliases: ['membershipno', 'memberid', 'memberno', 'uniquememberid'] },
  { key: 'policyNo', label: 'Policy no', aliases: ['policyno'] },
  { key: 'className', label: 'Class', aliases: ['classname', 'class'] },
  { key: 'approvalNo', label: 'Approval no', aliases: ['approvalno', 'approvalnumber', 'preauth', 'preauthno', 'authorizationno'] },
  { key: 'encounterType', label: 'Encounter type', aliases: ['encountertype', 'visittype', 'patienttype'] },
  { key: 'invoice', label: 'Invoice', aliases: ['invoice', 'invoiceno', 'invoicenumber', 'invno'] },
  { key: 'submissionDate', label: 'Date of submission', aliases: ['dateofsubmission', 'submissiondate'] },
  { key: 'physicianId', label: 'Physician id', aliases: ['physicianid', 'doctorid', 'doctorcode'] },
  { key: 'physician', label: 'Physician name', aliases: ['physicianname', 'doctorname', 'doctor', 'physician'] },
  { key: 'specialty', label: 'Speciality', aliases: ['drsspeciality', 'speciality', 'specialty', 'department'] },
  { key: 'category', label: 'Service category', aliases: ['servicecategory', 'category', 'servicetype'] },
  { key: 'serviceCode', label: 'Service code', aliases: ['servicecode', 'itemcode', 'code'] },
  { key: 'serviceDesc', label: 'Service description', aliases: ['servicedescription', 'servicedesc', 'servicename', 'service', 'itemdescription', 'itemname', 'description'], required: true },
  { key: 'units', label: 'Units', aliases: ['serviceunits', 'units', 'qty', 'quantity'] },
  { key: 'billed', label: 'Billed amount', aliases: ['billedamount', 'gross', 'grossamount', 'billed'] },
  { key: 'patientPay', label: 'Patient pay', aliases: ['patientpayamount', 'patientshare', 'patientpay'] },
  { key: 'discount', label: 'Discount', aliases: ['discount'] },
  { key: 'net', label: 'Net amount', aliases: ['netamount', 'net'] },
  { key: 'deductible', label: 'Deductible', aliases: ['deductible'] },
  { key: 'netVat', label: 'Net VAT', aliases: ['netvat'] },
  { key: 'cashVat', label: 'Cash VAT', aliases: ['cashvat'] },
  { key: 'icd1', label: 'ICD1 (principal)', aliases: ['icd1', 'icd', 'icdcode', 'principaldiagnosis', 'primarydiagnosis', 'diagnosiscode'] },
  { key: 'icd1Desc', label: 'ICD1 description', aliases: ['diagdesc', 'icddescription', 'diagnosisdescription'] },
  { key: 'initialDx', label: 'Initial diagnosis', aliases: ['initialdiag'] },
  { key: 'initialDxDesc', label: 'Initial diagnosis description', aliases: ['initialdiagdescr'] },
  { key: 'dx2', label: 'Diagnosis 2', aliases: ['diag2', 'icd2', 'diagnosis2', 'secondarydiagnosis'] },
  { key: 'dx2Desc', label: 'Diagnosis 2 description', aliases: ['diag2desc'] },
  { key: 'dx3', label: 'Diagnosis 3', aliases: ['diag3code', 'diag3', 'icd3', 'diagnosis3'] },
  { key: 'dx3Desc', label: 'Diagnosis 3 description', aliases: ['diag3desc'] },
  { key: 'admissionDate', label: 'Date of admission', aliases: ['dateofadmission', 'admissiondate'] },
  { key: 'serviceDate', label: 'Service date', aliases: ['servicedate', 'dateofservice', 'visitdate', 'treatmentdate'], required: true },
  { key: 'bp', label: 'BP', aliases: ['bp', 'bloodpressure'] },
  { key: 'temp', label: 'Temperature', aliases: ['temperature', 'temp'] },
  { key: 'pulse', label: 'Pulse', aliases: ['pulse', 'heartrate', 'hr'] },
  { key: 'rr', label: 'Respiratory rate', aliases: ['respiratoryrate', 'rr'] },
  { key: 'height', label: 'Height', aliases: ['height'] },
  { key: 'weight', label: 'Weight', aliases: ['weight'] },
  { key: 'spo2', label: 'SpO2', aliases: ['spo2', 'oxygensaturation', 'o2sat'] },
  { key: 'lmp', label: 'LMP', aliases: ['lmp'] },
  { key: 'complaint', label: 'Chief complaint / history', aliases: ['chiefcomplaint', 'history', 'hpi', 'clinicalnotes', 'complaint'] },
  { key: 'examination', label: 'Examination', aliases: ['examination', 'physicalexamination', 'clinicalexamination'] },
  { key: 'plan', label: 'Plan', aliases: ['plan', 'managementplan', 'treatmentplan'] },
  { key: 'tooth', label: 'Tooth number', aliases: ['toothnumber', 'tooth'] },
  { key: 'gtin', label: 'GTIN', aliases: ['gtin'] },
  { key: 'onsetFlag', label: 'Condition onset flag', aliases: ['condionsetflag', 'onsetflag'] },
];

export const GENERIC_REJECTION_FIELDS: FieldDef[] = [
  { key: 'claimRef', label: 'Claim ref', aliases: ['claimno', 'claimid', 'claim', 'claimnumber'] },
  { key: 'invoice', label: 'Invoice', aliases: ['invoice', 'invoiceno', 'invoicenumber', 'invno'] },
  { key: 'serviceCode', label: 'Service code', aliases: ['servicecode', 'servcode', 'code'] },
  { key: 'serviceDesc', label: 'Service', aliases: ['servicedescription', 'service', 'servdesc', 'description'], required: true },
  { key: 'amount', label: 'Rejected amount', aliases: ['rejectedamount', 'rejectamount', 'rejectionamount', 'amount'], required: true },
  { key: 'vat', label: 'Rejected VAT', aliases: ['vatrejamt', 'rejectedvat', 'vat'] },
  { key: 'reason', label: 'Reason', aliases: ['reason', 'rejectionreason', 'rejdesc', 'rejectiondescription', 'remarks'], required: true },
  { key: 'reasonCode', label: 'Reason code', aliases: ['rejcode', 'rejectioncode', 'reasoncode'] },
  { key: 'nphiesCode', label: 'NPHIES code', aliases: ['nphiesrejectioncode', 'nphiescode'] },
  { key: 'date', label: 'Service date', aliases: ['servicedate', 'incurdatefrom', 'invdate', 'date'] },
  { key: 'icd', label: 'ICD', aliases: ['icdcode', 'icd', 'diagnosis'] },
  { key: 'payer', label: 'Insurer', aliases: ['payer', 'insurer', 'insurancecompany', 'company'] },
];

export const PRICE_FIELDS: FieldDef[] = [
  { key: 'code', label: 'Service code', aliases: ['servicecode', 'code', 'itemcode', 'cptcode', 'sbscode'], required: true },
  { key: 'desc', label: 'Description', aliases: ['description', 'servicedescription', 'servicename', 'itemname'] },
  { key: 'price', label: 'Contracted price', aliases: ['price', 'contractedprice', 'agreedprice', 'netprice', 'unitprice', 'amount'], required: true },
];

export const APPROVAL_FIELDS: FieldDef[] = [
  { key: 'code', label: 'Service code', aliases: ['servicecode', 'code', 'itemcode'], required: true },
  { key: 'desc', label: 'Description', aliases: ['description', 'servicedescription', 'servicename'] },
  { key: 'rule', label: 'Approval requirement', aliases: ['approval', 'preauth', 'preauthorization', 'requirement', 'rule'] },
];

export type Mapping = Record<string, string>; // logical key → source header text ('' = not mapped)

export function autoMap(header: string[], fields: FieldDef[]): Mapping {
  const n = header.map(norm);
  const used = new Set<number>();
  const m: Mapping = {};
  for (const f of fields) {
    let idx = -1;
    for (const a of f.aliases) {
      idx = n.findIndex((h, i) => h === a && !used.has(i));
      if (idx >= 0) break;
    }
    if (idx >= 0) used.add(idx);
    m[f.key] = idx >= 0 ? header[idx] : '';
  }
  return m;
}

// ───────────── Detection ─────────────

export interface Detected {
  sheet: string;
  layout: Layout;
  fileType: FileType | null;
  refKind?: ReferenceKind;
  headerRow: number; // 0-based index in table.rows
  header: string[];
  dataRows: { rowNo: number; cells: string[] }[]; // rowNo is 1-based line number in the source sheet
}

const has = (n: string[], ...keys: string[]) => keys.every((k) => n.includes(k));

function layoutOf(header: string[], sheet: string): Layout {
  const n = header.map(norm);
  if (has(n, 'rejdesc', 'servcode', 'rejectamount')) return 'bupa-clprovstm';
  if (has(n, 'claimno', 'rejectedamount', 'reason') || has(n, 'waseelbatch', 'rejectedamount')) return 'tawuniya-waseel';
  const claimScore = CLAIM_FIELDS.filter((f) => f.aliases.some((a) => n.includes(a))).length;
  if (claimScore >= 6 && CLAIM_FIELDS.find((f) => f.key === 'serviceDesc')!.aliases.some((a) => n.includes(a))) return 'his-claims';
  if (n.some((x) => x.includes('reject')) && n.some((x) => x.includes('amount'))) return 'generic-rejections';
  if (/indication/i.test(sheet) && has(n, 'indication', 'icd10code')) return 'chi-ddf';
  if (PRICE_FIELDS[0].aliases.some((a) => n.includes(a)) && PRICE_FIELDS[2].aliases.some((a) => n.includes(a))) return 'price-list';
  if (APPROVAL_FIELDS[0].aliases.some((a) => n.includes(a)) && n.some((x) => /approv|preauth|authoriz/.test(x))) return 'approval-list';
  return 'unknown';
}

const LAYOUT_TYPE: Record<Layout, { t: FileType | null; ref?: ReferenceKind }> = {
  'his-claims': { t: 'claims' },
  'tawuniya-waseel': { t: 'rejections' },
  'bupa-clprovstm': { t: 'rejections' },
  'generic-rejections': { t: 'rejections' },
  'price-list': { t: 'reference', ref: 'price-list' },
  'approval-list': { t: 'reference', ref: 'approval-list' },
  'chi-ddf': { t: 'reference', ref: 'drug-formulary' },
  unknown: { t: null },
};

/** Finds the real header row (it may follow preamble lines such as a VAT registration line). */
export function detectTables(tables: Table[]): Detected[] {
  const out: Detected[] = [];
  for (const t of tables) {
    let best = { row: -1, score: 0, layout: 'unknown' as Layout };
    for (let r = 0; r < Math.min(t.rows.length, 30); r++) {
      const header = t.rows[r];
      const nonEmpty = header.filter(Boolean).length;
      if (nonEmpty < 3) continue;
      const layout = layoutOf(header, t.sheet);
      const score = (layout !== 'unknown' ? 100 : 0) + nonEmpty;
      if (score > best.score) best = { row: r, score, layout };
    }
    if (best.row < 0) continue;
    const header = t.rows[best.row];
    const dataRows = t.rows.slice(best.row + 1).map((cells, i) => ({ rowNo: best.row + 2 + i, cells })).filter((r) => r.cells.some((c) => c !== ''));
    const lt = LAYOUT_TYPE[best.layout];
    out.push({ sheet: t.sheet, layout: best.layout, fileType: lt.t, refKind: lt.ref, headerRow: best.row, header, dataRows });
  }
  // The CHI DDF workbook has several sheets; keep it as a single reference table.
  if (out.some((d) => d.layout === 'chi-ddf')) return out.filter((d) => d.layout === 'chi-ddf');
  // Prefer recognised tables; keep unknown only if nothing was recognised.
  const known = out.filter((d) => d.layout !== 'unknown');
  return known.length ? known : out.slice(0, 1);
}

/** Record keyed by original header text (exact source values). */
export function toRecord(header: string[], cells: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  header.forEach((h, i) => { if (h) o[h] = cells[i] ?? ''; });
  return o;
}

export function canon(rec: Record<string, string>, mapping: Mapping): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, h] of Object.entries(mapping)) if (h) o[k] = (rec[h] ?? '').trim();
  return o;
}

// ───────────── Payer & period ─────────────

export function normalizePayer(s: string | undefined): Payer | null {
  const t = (s ?? '').toLowerCase();
  if (!t.trim() || isPlaceholder(s?.trim())) return null;
  if (/bupa|بوبا/.test(t)) return 'Bupa';
  if (/ta[a']?wuni?y?a|tawunia|tawuniyah|التعاونية/.test(t)) return 'Tawuniya';
  return null;
}

export interface PayerDetection {
  payer: Payer | null;
  basis: string;
  counts: Record<string, number>; // raw value → rows
  unknownRows: number;
  mixed: boolean;
}

export function detectPayer(layout: Layout, rows: Record<string, string>[], filename: string): PayerDetection {
  const counts: Record<string, number> = {};
  let bupa = 0, taw = 0, unknown = 0;
  for (const r of rows) {
    const raw = r.payer ?? '';
    counts[raw || '(blank)'] = (counts[raw || '(blank)'] ?? 0) + 1;
    const p = normalizePayer(raw);
    if (p === 'Bupa') bupa++;
    else if (p === 'Tawuniya') taw++;
    else unknown++;
  }
  const fromName = normalizePayer(filename);
  if (bupa + taw > 0) {
    const mixed = bupa > 0 && taw > 0;
    const payer = mixed ? null : bupa ? 'Bupa' : 'Tawuniya';
    return { payer, basis: mixed ? 'Insurer column has both Bupa and Tawuniya rows' : `Insurer column (${Object.keys(counts).filter((k) => normalizePayer(k)).join(', ')})`, counts, unknownRows: unknown, mixed };
  }
  if (layout === 'bupa-clprovstm') return { payer: 'Bupa', basis: 'Bupa provider statement layout (CLPROVSTM) – please confirm', counts, unknownRows: rows.length, mixed: false };
  if (layout === 'tawuniya-waseel') return { payer: 'Tawuniya', basis: 'Tawuniya/Waseel statement layout – please confirm', counts, unknownRows: rows.length, mixed: false };
  if (fromName) return { payer: fromName, basis: `File name mentions ${fromName} – please confirm`, counts, unknownRows: rows.length, mixed: false };
  return { payer: null, basis: 'No insurer found in the file – choose Bupa or Tawuniya', counts, unknownRows: rows.length, mixed: false };
}

export function periodsOf(dates: string[]): string[] {
  return [...new Set(dates.filter(Boolean).map((d) => d.slice(0, 7)))].sort();
}

export function periodFromName(name: string): string {
  const m = name.match(/(0[1-9]|1[0-2])[-_.](20\d\d)/) ?? name.match(/(20\d\d)[-_.]?(0[1-9]|1[0-2])\b/);
  if (!m) return '';
  return m[1].length === 4 ? `${m[1]}-${m[2]}` : `${m[2]}-${m[1]}`;
}

// ───────────── Value parsing ─────────────

export function num(v: string | undefined): number | undefined {
  if (isPlaceholder(v?.trim())) return undefined;
  const n = parseFloat((v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function money(v: string | undefined): number {
  if (isPlaceholder(v?.trim())) return 0;
  const n = parseFloat((v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

const txt = (v: string | undefined) => (isPlaceholder(v?.trim()) ? '' : (v ?? '').trim());

/** "35Y", "6M", "10D", "1Y 3M", "1 Y 3 M" → years (fractional). */
export function parseAge(s: string): number | null {
  if (!s || isPlaceholder(s.trim())) return null;
  const t = s.toUpperCase();
  let years = 0;
  let hit = false;
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(Y|YR|YRS|YEARS?|M|MO|MONTHS?|W|WEEKS?|D|DAYS?)\b/g)) {
    hit = true;
    const n = parseFloat(m[1]);
    const u = m[2][0];
    years += u === 'Y' ? n : u === 'M' ? n / 12 : u === 'W' ? n / 52 : n / 365;
  }
  if (!hit && /^\d+(\.\d+)?$/.test(t.trim())) return parseFloat(t);
  return hit ? Math.round(years * 100) / 100 : null;
}

/** Day-month-year first (Saudi HIS convention), ISO, Excel serial. */
export function parseDate(s: string): string {
  if (!s || isPlaceholder(s.trim())) return '';
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/);
  if (m) return `20${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{5}$/.test(t)) return new Date(Date.UTC(1899, 11, 30) + parseInt(t, 10) * 86400000).toISOString().slice(0, 10);
  return '';
}

function parseBP(s: string): { sys?: number; dia?: number } {
  const m = (s || '').match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
  return m ? { sys: +m[1], dia: +m[2] } : {};
}

const ICD_RE = /^[A-Z]\d{2}(\.?[0-9A-Z]{1,4})?$/;
function icdCodes(v: string | undefined): string[] {
  return txt(v).toUpperCase().split(/[,;/|\s]+/).map((x) => x.replace(/[^A-Z0-9.]/g, '')).filter((x) => ICD_RE.test(x));
}

// ───────────── Encounters ─────────────

export interface ClaimRow {
  rowNo: number;
  c: Record<string, string>; // canonical values
  payer: Payer;
}

/**
 * Encounter grouping. The HIS ClaimNo is unreliable (often -1), so it is never used to merge or split rows.
 * An encounter is: insurer + MRN (or patient name when MRN is missing) + service date + physician + encounter type.
 * Validated on two months of WAD exports: invoices never span two such groups, and one encounter carries ~1.9
 * invoices (consultation, pharmacy, lab/radiology), so the invoice alone is not an encounter.
 */
export function encounterKey(c: Record<string, string>, payer: Payer): { key: string; basis: string } {
  const mrn = txt(c.mrn);
  const who = mrn || `name:${txt(c.name).toLowerCase()}`;
  const date = parseDate(c.serviceDate ?? '') || parseDate(c.admissionDate ?? '');
  const doc = txt(c.physicianId) || txt(c.physician).toLowerCase();
  const enc = txt(c.encounterType) || 'O';
  return { key: [payer, who, date, doc, enc].join('|'), basis: mrn ? 'insurer + MRN + service date + physician + encounter type' : 'insurer + patient NAME (no MRN) + service date + physician + encounter type' };
}

export function buildClaims(rows: ClaimRow[], importId: string, sourceFile: string): Claim[] {
  const byKey = new Map<string, Claim & { _complaints: Set<string>; _dxByInv: Map<string, string>; _consults: number }>();
  for (const { rowNo, c, payer } of rows) {
    const desc = txt(c.serviceDesc);
    const code = txt(c.serviceCode);
    if (!desc && !code) continue;
    const { key, basis } = encounterKey(c, payer);
    const rowDx: Diagnosis[] = [];
    for (const [col, dcol, label] of [['icd1', 'icd1Desc', 'ICD1'], ['initialDx', 'initialDxDesc', 'initial diag'], ['dx2', 'dx2Desc', 'diag 2'], ['dx3', 'dx3Desc', 'diag 3']] as const) {
      for (const code of icdCodes(c[col])) if (!rowDx.some((d) => d.code === code)) rowDx.push({ code, desc: txt(c[dcol]), column: label });
    }
    let e = byKey.get(key);
    if (!e) {
      const g = txt(c.gender).toUpperCase();
      const bp = parseBP(txt(c.bp));
      const date = parseDate(c.serviceDate ?? '') || parseDate(c.admissionDate ?? '');
      e = {
        id: `${importId}|${key}`,
        claimNo: txt(c.claimNo),
        mrn: txt(c.mrn),
        patientName: txt(c.name),
        gender: g.startsWith('M') ? 'M' : g.startsWith('F') ? 'F' : '',
        ageYears: parseAge(c.age ?? ''),
        ageText: txt(c.age),
        maritalStatus: txt(c.maritalStatus),
        nationality: txt(c.nationality),
        payer,
        payerRaw: txt(c.payer),
        policyHolder: txt(c.policyHolder),
        memberId: txt(c.memberId),
        className: txt(c.className),
        approvalNo: txt(c.approvalNo),
        encounterType: txt(c.encounterType),
        physicianId: txt(c.physicianId),
        physician: txt(c.physician) || 'Unknown',
        specialty: txt(c.specialty) || 'Unspecified',
        serviceDate: date,
        admissionDate: parseDate(c.admissionDate ?? ''),
        submissionDate: parseDate(c.submissionDate ?? ''),
        period: date.slice(0, 7),
        diagnoses: [],
        vitals: {
          bpSys: bp.sys, bpDia: bp.dia, temp: num(c.temp), pulse: num(c.pulse), rr: num(c.rr), height: num(c.height), weight: num(c.weight), spo2: num(c.spo2),
        },
        lmp: txt(c.lmp),
        history: txt(c.complaint),
        examination: txt(c.examination),
        plan: txt(c.plan),
        onsetFlag: txt(c.onsetFlag),
        lines: [],
        invoices: [],
        groupingWarnings: [],
        groupingBasis: basis,
        sourceFile,
        importId,
        _complaints: new Set(),
        _dxByInv: new Map(),
        _consults: 0,
      };
      byKey.set(key, e);
    }
    for (const d of rowDx) if (!e.diagnoses.some((x) => x.code === d.code)) e.diagnoses.push(d);
    const h = txt(c.complaint);
    if (h) {
      e._complaints.add(h.toLowerCase().replace(/\s+/g, ' ').slice(0, 120));
      if (h.length > e.history.length) e.history = h;
    }
    if (!e.approvalNo && txt(c.approvalNo)) e.approvalNo = txt(c.approvalNo);
    if (!e.claimNo && txt(c.claimNo)) e.claimNo = txt(c.claimNo);
    const inv = txt(c.invoice);
    if (inv && !e.invoices.includes(inv)) e.invoices.push(inv);
    const dxSig = rowDx.map((d) => d.code).sort().join(',');
    if (inv && dxSig) {
      if (!e._dxByInv.has(inv)) e._dxByInv.set(inv, dxSig);
    }
    const category = txt(c.category) || 'Other';
    if (/consult/i.test(category)) e._consults++;
    const line: ServiceLine = {
      id: `${importId}#${rowNo}`,
      importId,
      rowNo,
      invoice: inv,
      category,
      code,
      desc,
      units: num(c.units) ?? 1,
      billed: money(c.billed),
      net: money(c.net),
      patientShare: money(c.patientPay),
      discount: money(c.discount),
      deductible: money(c.deductible),
      netVat: c.netVat !== undefined && !isPlaceholder(c.netVat) ? money(c.netVat) : undefined,
      cashVat: c.cashVat !== undefined && !isPlaceholder(c.cashVat) ? money(c.cashVat) : undefined,
      gtin: txt(c.gtin),
      tooth: txt(c.tooth),
    };
    e.lines.push(line);
  }
  return [...byKey.values()].map(({ _complaints, _dxByInv, _consults, ...cl }) => {
    const w: string[] = [];
    if (_complaints.size > 1) w.push(`${_complaints.size} different chief complaints in one group – may be separate visits`);
    if (new Set(_dxByInv.values()).size > 1) w.push('Invoices in this group carry different diagnosis sets');
    if (_consults > 1) w.push(`${_consults} consultation lines on the same day with the same physician`);
    if (!cl.mrn) w.push('No MRN – grouped by patient name');
    if (!cl.serviceDate) w.push('No service date');
    return { ...cl, groupingWarnings: w };
  });
}

/** Content fingerprint of a row (used to detect the same record in another import). */
export function rowHash(values: Record<string, string>): string {
  const s = Object.keys(values).sort().map((k) => `${k}=${(values[k] ?? '').trim()}`).join('\u0001');
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36);
}

export const pickFirst = (r: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && !isPlaceholder(v.trim())) return v.trim();
  }
  return '';
};
