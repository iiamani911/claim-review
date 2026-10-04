/** Import pipeline: analyse a file → staged preview (editable) → commit with explicit duplicate/revision choice. */
import type { FileType, Payer, ReferenceKind } from './lib/types';
import {
  APPROVAL_FIELDS, CLAIM_FIELDS, GENERIC_REJECTION_FIELDS, PRICE_FIELDS, autoMap, canon, detectPayer, detectTables, normalizePayer, parseDate, periodFromName,
  periodsOf, readTables, rowHash, toRecord, type FieldDef, type Layout, type Mapping, type PayerDetection, type SourceFormat,
} from './lib/parse';
import { buildFormularyFromTables, isDdfWorkbook } from './lib/ddf';
import type { FormularyData } from './lib/formulary';
import type { ImportBundle, ImportMeta, StoredRow } from './db';

export interface Staged {
  key: string;
  filename: string;
  sheet: string;
  format: SourceFormat;
  layout: Layout;
  fileType: FileType | null;
  refKind?: ReferenceKind;
  header: string[];
  headerRow: number; // 1-based
  mapping: Mapping | null;
  records: { rowNo: number; values: Record<string, string> }[];
  detection: PayerDetection;
  payer: Payer | null; // confirmed / chosen payer for rows without a recognisable insurer value
  periods: string[];
  periodOverride: string;
  version: string;
  payload?: FormularyData;
  error?: string;
}

export function fieldsFor(s: Pick<Staged, 'fileType' | 'layout' | 'refKind'>): FieldDef[] | null {
  if (s.fileType === 'claims') return CLAIM_FIELDS;
  if (s.fileType === 'rejections' && s.layout === 'generic-rejections') return GENERIC_REJECTION_FIELDS;
  if (s.fileType === 'reference' && s.refKind === 'price-list') return PRICE_FIELDS;
  if (s.fileType === 'reference' && s.refKind === 'approval-list') return APPROVAL_FIELDS;
  return null;
}

export const LAYOUT_LABEL: Record<Layout, string> = {
  'his-claims': 'HIS claim export',
  'tawuniya-waseel': 'Tawuniya / Waseel statement of account',
  'bupa-clprovstm': 'Bupa provider statement (CLPROVSTM)',
  'generic-rejections': 'Rejection list (generic layout)',
  'price-list': 'Price list',
  'approval-list': 'Pre-authorisation list',
  'chi-ddf': 'CHI Drug Formulary (DDF)',
  unknown: 'Not recognised',
};

function canonRows(s: Staged) {
  return s.mapping ? s.records.map((r) => canon(r.values, s.mapping!)) : [];
}

/** Recompute payer detection & periods after a mapping/type change. */
export function refresh(s: Staged): Staged {
  const rows = canonRows(s);
  const detection = s.fileType === 'reference' && s.refKind === 'drug-formulary'
    ? { payer: null, basis: 'Shared reference (applies to both insurers)', counts: {}, unknownRows: 0, mixed: false }
    : detectPayer(s.layout, s.layout === 'his-claims' || s.layout === 'generic-rejections' ? rows : [], s.filename);
  let periods: string[] = [];
  if (s.fileType === 'claims') periods = periodsOf(rows.map((r) => parseDate(r.serviceDate ?? '') || parseDate(r.admissionDate ?? '')));
  else if (s.layout === 'bupa-clprovstm') periods = periodsOf(s.records.map((r) => parseDate(Object.entries(r.values).find(([k]) => /incur_date_from|inv_date/i.test(k))?.[1] ?? '')));
  else if (s.layout === 'generic-rejections') periods = periodsOf(rows.map((r) => parseDate(r.date ?? '')));
  if (!periods.length && periodFromName(s.filename)) periods = [periodFromName(s.filename)];
  return { ...s, detection, payer: s.payer ?? detection.payer, periods };
}

export async function analyzeFile(file: File): Promise<Staged[]> {
  const buf = await file.arrayBuffer();
  const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let parsed;
  try {
    parsed = readTables(buf, file.name);
  } catch (e) {
    return [{ key, filename: file.name, sheet: '', format: 'csv', layout: 'unknown', fileType: null, header: [], headerRow: 0, mapping: null, records: [], detection: { payer: null, basis: '', counts: {}, unknownRows: 0, mixed: false }, payer: null, periods: [], periodOverride: '', version: '', error: `Could not read the file: ${String(e)}` }];
  }
  const { format, tables } = parsed;
  if (isDdfWorkbook(tables)) {
    let payload: FormularyData | undefined;
    let error: string | undefined;
    const version = file.name.replace(/\.[a-z]+$/i, '');
    try { payload = buildFormularyFromTables(tables, version); } catch (e) { error = String(e); }
    return [refresh({ key, filename: file.name, sheet: 'Indication + Mapped to SFDA', format, layout: 'chi-ddf', fileType: 'reference', refKind: 'drug-formulary', header: [], headerRow: 0, mapping: null, records: [], detection: { payer: null, basis: '', counts: {}, unknownRows: 0, mixed: false }, payer: null, periods: [], periodOverride: '', version, payload, error })];
  }
  return detectTables(tables).map((d, i) => {
    const s: Staged = {
      key: `${key}-${i}`, filename: file.name, sheet: d.sheet, format, layout: d.layout, fileType: d.fileType, refKind: d.refKind,
      header: d.header, headerRow: d.headerRow + 1, mapping: null,
      records: d.dataRows.map((r) => ({ rowNo: r.rowNo, values: toRecord(d.header, r.cells) })),
      detection: { payer: null, basis: '', counts: {}, unknownRows: 0, mixed: false }, payer: null, periods: [], periodOverride: '', version: '',
      error: d.layout === 'unknown' ? 'File type not recognised – choose the type and map the columns, or check that this is a claims, rejection or reference file.' : undefined,
    };
    const f = fieldsFor(s);
    return refresh({ ...s, mapping: f ? autoMap(d.header, f) : null });
  });
}

export function setType(s: Staged, fileType: FileType, refKind?: ReferenceKind): Staged {
  const layout: Layout = fileType === 'claims' ? 'his-claims' : fileType === 'rejections' ? (['tawuniya-waseel', 'bupa-clprovstm'].includes(s.layout) ? s.layout : 'generic-rejections') : refKind === 'price-list' ? 'price-list' : refKind === 'approval-list' ? 'approval-list' : s.layout;
  const next = { ...s, fileType, refKind, layout, error: undefined };
  const f = fieldsFor(next);
  return refresh({ ...next, mapping: f ? autoMap(s.header, f) : null });
}

/** Problems that block the import until the user resolves them. */
export function blockers(s: Staged): string[] {
  const b: string[] = [];
  if (s.error && !(s.fileType && s.layout !== 'unknown')) b.push(s.error);
  if (!s.fileType) b.push('Choose the file type.');
  const f = fieldsFor(s);
  if (f && s.mapping) for (const x of f.filter((x) => x.required)) if (!s.mapping[x.key]) b.push(`Map the "${x.label}" column.`);
  const needsPayer = !(s.fileType === 'reference' && s.refKind === 'drug-formulary');
  if (needsPayer && !s.payer && !(s.detection.mixed && s.detection.unknownRows === 0)) b.push('Choose the insurer (Bupa or Tawuniya).');
  if (s.fileType === 'rejections' && !s.periods.length && !s.periodOverride) b.push('Enter the reporting period (YYYY-MM).');
  if (s.fileType === 'reference' && s.refKind === 'drug-formulary' && !s.payload) b.push(s.error ?? 'Formulary could not be read.');
  return b;
}

export interface OverlapInfo {
  exactDuplicateOf?: ImportMeta;
  overlapping: { meta: ImportMeta; rows: number }[];
  overlapRows: number;
  withinFileRepeats: number;
  candidatesToReplace: ImportMeta[];
}

function storedRows(s: Staged): StoredRow[] {
  const rows = s.mapping ? s.records.map((r) => ({ r, c: canon(r.values, s.mapping!) })) : s.records.map((r) => ({ r, c: {} as Record<string, string> }));
  return rows.map(({ r, c }) => ({ rowNo: r.rowNo, values: r.values, hash: rowHash(r.values), payer: normalizePayer(c.payer) ?? s.payer }));
}

const fingerprint = (rows: StoredRow[]) => rowHash(Object.fromEntries(rows.map((r, i) => [String(i), r.hash])));

export function analyzeOverlap(s: Staged, existing: ImportBundle[]): OverlapInfo {
  const rows = storedRows(s);
  const fp = fingerprint(rows);
  const active = existing.filter((b) => b.meta.status === 'active' && !b.meta.demo && b.meta.fileType === s.fileType);
  const exact = active.find((b) => b.meta.fingerprint === fp);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.hash, (counts.get(r.hash) ?? 0) + 1);
  const withinFileRepeats = [...counts.values()].reduce((x, n) => x + (n > 1 ? n - 1 : 0), 0);
  const mine = new Set(rows.map((r) => r.hash));
  const overlapping = active
    .map((b) => ({ meta: b.meta, rows: b.rows.filter((r) => mine.has(r.hash)).length }))
    .filter((x) => x.rows > 0);
  const theirs = new Set(active.flatMap((b) => b.rows.map((r) => r.hash)));
  const overlapRows = rows.filter((r) => theirs.has(r.hash)).length;
  const periods = new Set(s.periodOverride ? [s.periodOverride] : s.periods);
  const candidatesToReplace = active.filter((b) => (b.meta.payer === s.payer || !s.payer) && (b.meta.filename === s.filename || b.meta.periods.some((p) => periods.has(p)) || overlapping.some((o) => o.meta.id === b.meta.id))).map((b) => b.meta);
  return { exactDuplicateOf: exact?.meta, overlapping, overlapRows, withinFileRepeats, candidatesToReplace };
}

export type Decision = { mode: 'new-only' } | { mode: 'replace'; replaceIds: string[] } | { mode: 'add-all' };

export function commit(s: Staged, decision: Decision, existing: ImportBundle[]): { bundle: ImportBundle; replaced: string[] } {
  const all = storedRows(s);
  const errors: string[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  let rows = all;
  // Claims: a row needs a service and an insurer.
  if (s.fileType === 'claims' && s.mapping) {
    const keep: StoredRow[] = [];
    const noSvc: number[] = [], noPayer: number[] = [];
    for (const r of rows) {
      const c = canon(r.values, s.mapping);
      if (!c.serviceDesc?.trim() && !c.serviceCode?.trim()) { noSvc.push(r.rowNo); continue; }
      if (!r.payer) { noPayer.push(r.rowNo); continue; }
      keep.push(r);
    }
    skipped += noSvc.length + noPayer.length;
    if (noSvc.length) errors.push(`${noSvc.length} row(s) without a service skipped (rows ${noSvc.slice(0, 8).join(', ')}${noSvc.length > 8 ? '…' : ''}).`);
    if (noPayer.length) errors.push(`${noPayer.length} row(s) without a recognised insurer skipped (rows ${noPayer.slice(0, 8).join(', ')}${noPayer.length > 8 ? '…' : ''}).`);
    rows = keep;
  }
  const ov = analyzeOverlap(s, existing);
  let duplicates = 0;
  let replaced: string[] = [];
  if (decision.mode === 'new-only') {
    const theirs = new Set(existing.filter((b) => b.meta.status === 'active' && !b.meta.demo && b.meta.fileType === s.fileType).flatMap((b) => b.rows.map((r) => r.hash)));
    const before = rows.length;
    rows = rows.filter((r) => !theirs.has(r.hash));
    duplicates = before - rows.length;
  } else if (decision.mode === 'replace') {
    replaced = decision.replaceIds;
  } else if (ov.overlapRows) {
    warnings.push(`${ov.overlapRows} row(s) also exist in another import and were added again by your choice ("add all as distinct records").`);
  }
  if (ov.withinFileRepeats) warnings.push(`${ov.withinFileRepeats} identical row(s) within this file were kept as repeated services.`);
  const periods = s.periodOverride ? [s.periodOverride] : s.periods;
  const meta: ImportMeta = {
    id: `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    filename: s.filename,
    fileType: s.fileType!,
    refKind: s.refKind,
    layout: s.layout,
    payer: s.fileType === 'reference' && s.refKind === 'drug-formulary' ? null : s.payer ?? (s.detection.mixed ? null : s.detection.payer),
    payerBasis: s.detection.mixed ? 'Per row from the insurer column (file has both insurers)' : s.detection.basis,
    periods,
    uploadedAt: new Date().toISOString(),
    format: s.format,
    sheet: s.sheet,
    headerRow: s.headerRow,
    header: s.header,
    mapping: s.mapping,
    rowsRead: s.records.length,
    imported: rows.length,
    skipped,
    duplicates,
    errors,
    warnings,
    status: 'active',
    supersedes: replaced.length ? replaced : undefined,
    fingerprint: fingerprint(all),
    version: s.version || undefined,
  };
  if (s.detection.mixed) meta.warnings.push(`Insurer per row: ${Object.entries(s.detection.counts).map(([k, v]) => `${k}: ${v}`).join(', ')}.`);
  return { bundle: { meta, rows, payload: s.payload }, replaced };
}
