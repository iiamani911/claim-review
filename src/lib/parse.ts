import * as XLSX from 'xlsx';
import type { Claim, Diagnosis, ServiceLine } from './types';

export type FileKind = 'claims' | 'rejections-waseel' | 'rejections-bupa' | 'rejections-generic' | 'unknown';

export interface Table {
  sheet: string;
  rows: string[][];
}

export interface DetectedTable {
  kind: FileKind;
  sheet: string;
  header: string[];
  records: Record<string, string>[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Turns a cell into a trimmed string; "-1" (HIS null marker) stays as-is for callers to decide. */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, ' ').trim();
}

function isBinary(bytes: Uint8Array): boolean {
  // XLSX (zip) starts with PK, legacy XLS (OLE2) with D0 CF 11 E0.
  return (bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0xd0 && bytes[1] === 0xcf);
}

export function readTables(name: string, buf: ArrayBuffer): Table[] {
  const bytes = new Uint8Array(buf);
  if (!isBinary(bytes)) {
    // Many HIS systems export "xls" files that are really tab-separated text with a preamble line.
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder('windows-1252').decode(bytes); // legacy Windows exports
    }
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    const delim = lines.slice(0, 5).some((l) => l.includes('\t')) ? '\t' : ',';
    const rows = lines.map((l) => (delim === '\t' ? l.split('\t') : splitCsv(l)).map(cellText));
    return [{ sheet: name, rows }];
  }
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
  return wb.SheetNames.map((sheet) => {
    const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, raw: false, defval: '' });
    return { sheet, rows: raw.map((r) => (r as unknown[]).map(cellText)) };
  });
}

function splitCsv(line: string): string[] {
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
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const SIGNATURES: { kind: FileKind; all: string[] }[] = [
  { kind: 'claims', all: ['claimno', 'servicedescription', 'icd1'] },
  { kind: 'rejections-waseel', all: ['claimno', 'rejectedamount', 'reason'] },
  { kind: 'rejections-bupa', all: ['rejdesc', 'servcode', 'rejectamount'] },
];

export function detect(tables: Table[]): DetectedTable[] {
  const found: DetectedTable[] = [];
  for (const t of tables) {
    for (let h = 0; h < Math.min(t.rows.length, 20); h++) {
      const header = t.rows[h].map(norm);
      let kind: FileKind | null = null;
      for (const sig of SIGNATURES) if (sig.all.every((k) => header.includes(k))) { kind = sig.kind; break; }
      if (!kind && header.some((x) => x.includes('reject')) && header.some((x) => x.includes('amount')) && header.some((x) => x.includes('serv'))) {
        kind = 'rejections-generic';
      }
      if (!kind) continue;
      const names = t.rows[h];
      const records = t.rows
        .slice(h + 1)
        .filter((r) => r.some((c) => c !== ''))
        .map((r) => {
          const o: Record<string, string> = {};
          names.forEach((n, i) => { if (n) o[norm(n)] = r[i] ?? ''; });
          return o;
        });
      found.push({ kind, sheet: t.sheet, header: names, records });
      break;
    }
  }
  return found;
}

/** First non-empty value among the normalized column aliases. "-1" is the HIS "no value" marker. */
export function pick(r: Record<string, string>, ...aliases: string[]): string {
  for (const a of aliases) {
    const v = r[norm(a)];
    if (v !== undefined && v !== '' && v !== '-1') return v;
  }
  return '';
}

export function num(v: string): number | undefined {
  if (!v) return undefined;
  const n = parseFloat(v.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function money(v: string): number {
  const n = parseFloat((v || '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** "35Y", "6M", "10D", "1Y 3M" → years (fractional). */
export function parseAge(s: string): number | null {
  if (!s) return null;
  const t = s.toUpperCase();
  let years = 0;
  let hit = false;
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*([YMWD])/g)) {
    hit = true;
    const n = parseFloat(m[1]);
    years += m[2] === 'Y' ? n : m[2] === 'M' ? n / 12 : m[2] === 'W' ? n / 52 : n / 365;
  }
  if (!hit && /^\d+(\.\d+)?$/.test(t.trim())) return parseFloat(t);
  return hit ? Math.round(years * 100) / 100 : null;
}

/** dd-mm-yyyy, dd/mm/yyyy, yyyy-mm-dd, or Excel serial → yyyy-mm-dd. */
export function parseDate(s: string): string {
  if (!s) return '';
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) return `20${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  if (/^\d{5}$/.test(t)) {
    const d = new Date(Date.UTC(1899, 11, 30) + parseInt(t, 10) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return '';
}

function parseBP(s: string): { sys?: number; dia?: number } {
  const m = (s || '').match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
  return m ? { sys: +m[1], dia: +m[2] } : {};
}

function cleanIcd(c: string): string {
  return c.toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9.]/g, '');
}

/** Groups HIS claim-export rows (one row per service line) into claims. */
export function buildClaims(records: Record<string, string>[], sourceFile: string): Claim[] {
  const byClaim = new Map<string, Claim>();
  records.forEach((r, i) => {
    const claimNo = pick(r, 'ClaimNo', 'Claim No', 'Claim Number', 'Visit No');
    if (!claimNo) return;
    const mrn = pick(r, 'MRN', 'File No', 'Patient File No');
    const date = parseDate(pick(r, 'Service date', 'Date of admission'));
    const phys = pick(r, 'Physician Id', 'Doctor Code', 'Physician name');
    const key = [claimNo, mrn, date, phys].join('|');
    const pairs: [string, string][] = [
      ['ICD1', 'diag desc'], ['initial diag', 'initial diag descr'], ['diag 2', 'diag 2 desc'],
      ['diag 3 code', 'diag 3 desc'], ['diag 3', 'diag 3 desc'], ['diag 4', 'diag 4 desc'], ['diag 5', 'diag 5 desc'],
    ];
    const rowDx: Diagnosis[] = [];
    for (const [code, desc] of pairs) {
      const v = cleanIcd(pick(r, code));
      if (v && !rowDx.some((d) => d.code === v)) rowDx.push({ code: v, desc: pick(r, desc) });
    }
    let c = byClaim.get(key);
    if (c) {
      for (const d of rowDx) if (!c.diagnoses.some((x) => x.code === d.code)) c.diagnoses.push(d);
      const h = pick(r, 'Chief complaint', 'History', 'HPI', 'Clinical Notes', 'Complaint');
      if (h.length > c.history.length) c.history = h;
    }
    if (!c) {
      const g = pick(r, 'gender', 'sex').toUpperCase();
      const ageText = pick(r, 'Age');
      const bp = parseBP(pick(r, 'BP', 'Blood Pressure'));
      const diagnoses = rowDx;
      c = {
        id: key,
        claimNo,
        mrn,
        patientName: pick(r, 'Name', 'Patient Name'),
        gender: g.startsWith('M') ? 'M' : g.startsWith('F') ? 'F' : '',
        ageYears: parseAge(ageText),
        ageText,
        maritalStatus: pick(r, 'MaritalStatus'),
        nationality: pick(r, 'Nationality'),
        payer: pick(r, 'ins comp name', 'Ins company', 'Payer', 'Insurance'),
        policyHolder: pick(r, 'policy holder'),
        memberId: pick(r, 'Membership No', 'Member Id', 'UNIQUE MEMBERID'),
        className: pick(r, 'class name'),
        approvalNo: pick(r, 'approval no', 'Pre-Auth', 'Approval Number'),
        encounterType: pick(r, 'Encounter Type'),
        physicianId: pick(r, 'Physician Id', 'Doctor Code'),
        physician: pick(r, 'Physician name', 'Doctor Name', 'Doctor') || 'Unknown',
        specialty: pick(r, 'Drs speciality', 'Speciality', 'Specialty') || 'Unspecified',
        serviceDate: date,
        submissionDate: parseDate(pick(r, 'date of submission')),
        diagnoses,
        vitals: {
          bpSys: bp.sys,
          bpDia: bp.dia,
          temp: num(pick(r, 'Temperature', 'Temp')),
          pulse: num(pick(r, 'pulse', 'Heart Rate', 'HR')),
          rr: num(pick(r, 'Respiratory Rate', 'RR')),
          height: num(pick(r, 'Height')),
          weight: num(pick(r, 'Weight')),
          spo2: num(pick(r, 'SpO2', 'Oxygen Saturation', 'O2 Sat')),
        },
        lmp: pick(r, 'LMP'),
        history: pick(r, 'Chief complaint', 'History', 'HPI', 'Clinical Notes', 'Complaint'),
        examination: pick(r, 'Examination', 'Physical Examination', 'Clinical Examination', 'Signs', 'Findings'),
        plan: pick(r, 'Plan', 'Management Plan', 'Treatment Plan'),
        onsetFlag: pick(r, 'condi onset flag'),
        lines: [],
        sourceFile,
      };
      byClaim.set(key, c);
    }
    const line: ServiceLine = {
      id: '',
      invoice: pick(r, 'INVOICE', 'Invoice No', 'Invoice Number'),
      category: pick(r, 'ServiceCategory', 'Service Type', 'Category') || 'Other',
      code: pick(r, 'service code', 'Service Code'),
      desc: pick(r, 'ServiceDescription', 'Service Description', 'Service'),
      units: num(pick(r, 'ServiceUnits', 'Qty', 'Quantity')) ?? 1,
      billed: money(pick(r, 'BilledAmount', 'Gross')),
      net: money(pick(r, 'Net amount', 'Net')),
      patientShare: money(pick(r, 'PatientPayAmount')),
      gtin: pick(r, 'GTIN'),
      tooth: pick(r, 'Tooth Number'),
    };
    if (!line.desc && !line.code) return;
    line.id = `${claimNo}#${i}`;
    c.lines.push(line);
  });
  return [...byClaim.values()];
}
