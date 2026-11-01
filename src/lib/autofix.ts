/**
 * Safe automatic corrections for the pre-submission sheet. Only data-entry mistakes with one possible meaning are
 * changed (decimal point lost in a temperature, °F instead of °C, height in metres, BP written the wrong way round,
 * ICD code without its dot…). Clinical content is never invented: missing or implausible values stay highlighted.
 */
import { norm, parseAge, pick } from './parse';
import { FIELDS } from './precheck';
import { HOSPITAL_WATCHLIST } from './kb/watchlist';

export interface Change {
  row: number;
  col: number;
  column: string;
  from: string;
  to: string;
  why: string;
}

const round1 = (n: number) => String(Math.round(n * 10) / 10);
const val = (s: string) => parseFloat(s.replace(',', '.'));
const isNull = (s: string) => !s || s === '-1';

function fixTemp(s: string): [string, string] | null {
  const t = val(s);
  if (!Number.isFinite(t) || t <= 0) return null;
  if (t >= 34 && t <= 43) return s.includes(',') ? [round1(t), 'decimal comma'] : null;
  if (t >= 3400 && t <= 4300) return [round1(t / 100), 'decimal point missing'];
  if (t >= 340 && t <= 430) return [round1(t / 10), 'decimal point missing'];
  if (t >= 93 && t <= 109) return [round1(((t - 32) * 5) / 9), 'entered in °F, converted to °C'];
  return null;
}

function fixBP(s: string): [string, string] | null {
  const m = s.trim().match(/^(\d{2,3})\s*[/\\\-–,.|:\s]\s*(\d{2,3})$/);
  if (!m) return null;
  let a = +m[1], b = +m[2];
  const swapped = b > a;
  if (swapped) [a, b] = [b, a];
  const out = `${a}/${b}`;
  if (out === s.trim()) return null;
  return [out, swapped ? 'systolic/diastolic reversed' : 'BP format'];
}

function fixHeight(s: string): [string, string] | null {
  const h = val(s);
  if (!Number.isFinite(h) || h <= 0) return null;
  if (h >= 0.3 && h <= 2.3) return [String(Math.round(h * 100)), 'entered in metres, converted to cm'];
  if (h >= 300 && h <= 2300) return [String(Math.round(h / 10)), 'entered in mm, converted to cm'];
  return null;
}

function fixWeight(s: string, ageYears: number | null): [string, string] | null {
  const w = val(s);
  if (!Number.isFinite(w) || w <= 0) return null;
  // Babies are often weighed in grams.
  if (ageYears !== null && ageYears < 3 && w >= 1000 && w <= 25000) return [round1(w / 1000), 'entered in grams, converted to kg'];
  return null;
}

function fixSpo2(s: string): [string, string] | null {
  const v = val(s);
  if (Number.isFinite(v) && v >= 0.7 && v <= 1) return [String(Math.round(v * 100)), 'fraction converted to %'];
  return null;
}

/** ICD cell: upper case, no spaces, dot after the category (following the sheet's own convention). */
function fixIcd(s: string, dots: boolean): [string, string] | null {
  const parts = s.split(/\s*[,;|]\s*/);
  let changed = false;
  const out = parts.map((p) => {
    let c = p.toUpperCase().replace(/\s+/g, '').replace(/\.$/, '');
    if (dots && /^[A-Z]\d{2}[0-9A-Z]{1,4}$/.test(c)) c = `${c.slice(0, 3)}.${c.slice(3)}`;
    if (!/^[A-Z]\d{2}(\.[0-9A-Z]{1,4})?$/.test(c)) return p; // not an ICD-10 shape: leave as entered
    if (c !== p) changed = true;
    return c;
  });
  return changed ? [out.join(', '), 'ICD-10 format'] : null;
}

const volumeOf = (s: string) => s.match(/(\d+)\s*ml/i)?.[1] ?? '';

export function autoFix(header: string[], records: Record<string, string>[]): { records: Record<string, string>[]; changes: Change[] } {
  const keys = header.map(norm);
  const colOf = (f: string) => FIELDS[f].map((n) => keys.indexOf(norm(n))).find((i) => i >= 0) ?? -1;
  const icdCols = [...new Set(FIELDS.icd.map((n) => keys.indexOf(norm(n))).filter((i) => i >= 0))];
  const out = records.map((r) => ({ ...r }));
  const changes: Change[] = [];
  const set = (i: number, col: number, to: string, why: string) => {
    const k = keys[col];
    const from = out[i][k];
    if (from === to) return;
    out[i][k] = to;
    changes.push({ row: i, col, column: header[col], from, to, why });
  };

  // Follow the file's own ICD convention: add dots only if most codes already have one.
  let withDot = 0, noDot = 0;
  for (const r of records) for (const c of icdCols) for (const p of (r[keys[c]] ?? '').split(/[,;|]/)) {
    const t = p.trim().toUpperCase();
    if (/^[A-Z]\d{2}\.[0-9A-Z]+$/.test(t)) withDot++;
    else if (/^[A-Z]\d{2}[0-9A-Z]+$/.test(t)) noDot++;
  }
  const dots = withDot >= noDot;

  // Contracted sodium-chloride items present in this sheet, by volume, to replace "Normal Saline".
  const ns = HOSPITAL_WATCHLIST.find((w) => w.key === 'normal saline')!;
  const cCode = colOf('code'), cDesc = colOf('service');
  const contracted = new Map<string, { code: string; desc: string }>();
  if (cCode >= 0 && cDesc >= 0) {
    for (const r of records) {
      const d = r[keys[cDesc]] ?? '', code = r[keys[cCode]] ?? '';
      if (/sodium\s*chlor/i.test(d) && !ns.match.test(d) && !ns.codes.includes(code) && code && volumeOf(d) && !contracted.has(volumeOf(d))) contracted.set(volumeOf(d), { code, desc: d });
    }
  }

  const cT = colOf('temp'), cBP = colOf('bp'), cH = colOf('height'), cW = colOf('weight'), cS = colOf('spo2');
  out.forEach((r, i) => {
    const cell = (c: number) => (c >= 0 ? r[keys[c]] ?? '' : '');
    const apply = (c: number, fx: [string, string] | null, label: string) => { if (c >= 0 && fx) set(i, c, fx[0], `${label}: ${fx[1]}`); };
    if (!isNull(cell(cT))) apply(cT, fixTemp(cell(cT)), 'Temperature');
    if (!isNull(cell(cBP))) apply(cBP, fixBP(cell(cBP)), 'BP');
    if (!isNull(cell(cH))) apply(cH, fixHeight(cell(cH)), 'Height');
    if (!isNull(cell(cW))) apply(cW, fixWeight(cell(cW), parseAge(pick(r, 'Age'))), 'Weight');
    if (!isNull(cell(cS))) apply(cS, fixSpo2(cell(cS)), 'SpO₂');
    for (const c of icdCols) if (!isNull(cell(c))) apply(c, fixIcd(cell(c), dots), 'ICD');
    if (cCode >= 0 && cDesc >= 0) {
      const d = cell(cDesc);
      if (ns.match.test(d) || ns.codes.includes(cell(cCode))) {
        const rep = contracted.get(volumeOf(d));
        if (rep) {
          set(i, cCode, rep.code, 'Normal Saline replaced by contracted Sodium Chloride code (same volume, from this sheet)');
          set(i, cDesc, rep.desc, 'Normal Saline replaced by contracted Sodium Chloride item');
        }
      }
    }
  });
  return { records: out, changes };
}
