import type { Claim, Rejection } from './lib/types';
import { buildClaims, detect, readTables, type FileKind } from './lib/parse';
import { parseRejections } from './lib/rejections';
import { demoClaimRecords, demoRejectionTable } from './demo';

export interface LoadedFile {
  id: string;
  name: string;
  kind: FileKind;
  sheet: string;
  rows: number;
  claims: Claim[];
  rejections: Rejection[];
  addedAt: string;
  demo?: boolean;
}

export async function ingestFile(file: File): Promise<LoadedFile[]> {
  const buf = await file.arrayBuffer();
  const tables = detect(readTables(file.name, buf));
  const stamp = new Date().toISOString();
  if (!tables.length) return [{ id: `${file.name}-${stamp}`, name: file.name, kind: 'unknown', sheet: '', rows: 0, claims: [], rejections: [], addedAt: stamp }];
  return tables.map((t, i) => ({
    id: `${file.name}-${t.sheet}-${stamp}-${i}`,
    name: file.name,
    kind: t.kind,
    sheet: t.sheet,
    rows: t.records.length,
    claims: t.kind === 'claims' ? buildClaims(t.records, file.name) : [],
    rejections: t.kind.startsWith('rejections') ? parseRejections(t, file.name) : [],
    addedAt: stamp,
  }));
}

export function demoFiles(): LoadedFile[] {
  const stamp = '2026-07-31T00:00:00.000Z';
  const recs = demoClaimRecords();
  const rej = demoRejectionTable();
  return [
    { id: 'demo-claims', name: 'DEMO_his_export_07-2026.xls', kind: 'claims', sheet: 'Demo', rows: recs.length, claims: buildClaims(recs, 'DEMO_his_export_07-2026.xls'), rejections: [], addedAt: stamp, demo: true },
    { id: 'demo-statement', name: 'DEMO_Tawuniya_statement_07-2026.xlsx', kind: 'rejections-waseel', sheet: 'Demo', rows: rej.records.length, claims: [], rejections: parseRejections(rej, 'DEMO_Tawuniya_statement_07-2026.xlsx'), addedAt: stamp, demo: true },
  ];
}

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

export async function saveFiles(files: LoadedFile[]): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(files.filter((f) => !f.demo), 'all');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    /* storage unavailable (private window) – app still works in memory */
  }
}

export async function loadFiles(): Promise<LoadedFile[] | null> {
  try {
    const db = await open();
    return await new Promise((res) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get('all');
      r.onsuccess = () => res((r.result as LoadedFile[] | undefined) ?? null);
      r.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}
