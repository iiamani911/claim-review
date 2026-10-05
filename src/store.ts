import type { Claim, Rejection, Section } from './lib/types';
import { buildClaims, detect, readTables, type FileKind } from './lib/parse';
import { parseRejections } from './lib/rejections';

export interface LoadedFile {
  id: string;
  name: string;
  kind: FileKind;
  section: Section;
  sheet: string;
  rows: number;
  /** Original header + rows, kept so the file can be handed back with review markers. */
  header: string[];
  records: Record<string, string>[];
  claims: Claim[];
  rejections: Rejection[];
  addedAt: string;
  demo?: boolean;
  note?: string;
}

export const SECTION_LABEL: Record<Section, string> = {
  medical: 'Medical audit',
  rejection: 'Rejection analysis',
  technical: 'Technical audit',
};

function tag(claims: Claim[], section: Section, id: string): Claim[] {
  return claims.map((c) => ({ ...c, id: `${section}:${c.id}`, section, sourceFileId: id }));
}

export async function ingestFile(file: File, section: Section): Promise<LoadedFile[]> {
  const buf = await file.arrayBuffer();
  const raw = readTables(file.name, buf);
  const tables = detect(raw);
  const stamp = new Date().toISOString();
  if (!tables.length) {
    // Keep the most header-like row so the upload report can say which columns were found.
    const header = raw.flatMap((t) => t.rows.slice(0, 20)).sort((a, b) => b.filter(Boolean).length - a.filter(Boolean).length)[0] ?? [];
    return [{ id: `${file.name}-${stamp}`, name: file.name, kind: 'unknown', section, sheet: '', rows: 0, header: header.filter(Boolean).slice(0, 40), records: [], claims: [], rejections: [], addedAt: stamp }];
  }
  return tables.map((t, i) => {
    const id = `${file.name}-${t.sheet}-${stamp}-${i}`;
    const isStatement = t.kind.startsWith('rejections');
    // A payer statement only makes sense under rejection analysis, wherever it was dropped.
    const sec: Section = isStatement ? 'rejection' : section;
    return {
      id,
      name: file.name,
      kind: t.kind,
      section: sec,
      sheet: t.sheet,
      rows: t.records.length,
      header: t.header,
      records: t.kind === 'claims' ? t.records : [],
      claims: t.kind === 'claims' ? tag(buildClaims(t.records, file.name), sec, id) : [],
      rejections: isStatement ? parseRejections(t, file.name) : [],
      addedAt: stamp,
      note: isStatement && section !== 'rejection' ? 'Payer statement detected – moved to Rejection analysis.' : undefined,
    };
  });
}

/** Move a file to another upload area (re-tags its encounters). */
export function moveFile(f: LoadedFile, section: Section): LoadedFile {
  if (f.kind !== 'claims') return f;
  const claims = f.claims.map((c) => ({ ...c, id: `${section}:${c.id.replace(/^[a-z]+:/, '')}`, section }));
  return { ...f, section, claims };
}

/** Files saved by an earlier version had no upload area. */
export function migrate(f: LoadedFile): LoadedFile {
  if (f.section && f.header) return f;
  const section: Section = f.kind.startsWith('rejections') ? 'rejection' : 'medical';
  return { ...f, section, header: f.header ?? [], records: f.records ?? [], claims: tag(f.claims, section, f.id) };
}

// ── Review status of marked encounters ──
export type ReviewStatus = 'open' | 'reviewed';
export type ReviewMap = Record<string, { status: ReviewStatus; at: string }>;

// ── IndexedDB persistence (data never leaves this browser) ──
const DB = 'wad-claim-review';
const STORE = 'files';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function put(key: string, value: unknown): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    /* storage unavailable (private window) – app still works in memory */
  }
}

async function get<T>(key: string): Promise<T | null> {
  try {
    const db = await open();
    return await new Promise((res) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      r.onsuccess = () => res((r.result as T | undefined) ?? null);
      r.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}

export const saveFiles = (files: LoadedFile[]) => put('all', files.filter((f) => !f.demo));
export const loadFiles = async () => ((await get<LoadedFile[]>('all')) ?? []).filter((f) => !f.demo).map(migrate);
export const saveReview = (m: ReviewMap) => put('review', m);
export const loadReview = async () => (await get<ReviewMap>('review')) ?? {};
