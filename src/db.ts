/**
 * Persistent local database (IndexedDB) for imports, their original rows, and reviewer decisions.
 * Data lives in this browser profile on this device: it survives refresh and reopening, but is not shared
 * with other users, browsers or devices, and is lost if the browser's site data is cleared.
 */
import type { FileType, Payer, ReferenceKind } from './lib/types';
import type { Layout, Mapping, SourceFormat } from './lib/parse';
import type { FormularyData } from './lib/formulary';

export interface StoredRow {
  rowNo: number;
  values: Record<string, string>; // original header → original cell text
  hash: string;
  payer: Payer | null;
}

export type ImportStatus = 'active' | 'replaced';

export interface ImportMeta {
  id: string;
  filename: string;
  fileType: FileType;
  refKind?: ReferenceKind;
  layout: Layout;
  payer: Payer | null; // null only for shared reference data (e.g. CHI DDF)
  payerBasis: string;
  periods: string[];
  uploadedAt: string;
  format: SourceFormat;
  sheet: string;
  headerRow: number; // 1-based line of the header in the source
  header: string[];
  mapping: Mapping | null;
  rowsRead: number;
  imported: number;
  skipped: number;
  duplicates: number;
  errors: string[];
  warnings: string[];
  status: ImportStatus;
  replacedBy?: string;
  supersedes?: string[];
  fingerprint: string;
  version?: string; // reference data version/date
  demo?: boolean;
}

export interface ImportBundle {
  meta: ImportMeta;
  rows: StoredRow[];
  payload?: FormularyData; // derived reference payload (CHI DDF)
}

export interface ProposedRule {
  id: string;
  payer: Payer;
  serviceKey: string; // HIS service code or normalised name
  serviceLabel: string;
  dxGroup: string; // ICD 3-char group or '' for any
  rejected: number;
  submitted: number;
  periods: string[];
  reasons: string[];
  status: 'proposed' | 'accepted' | 'rejected';
  createdAt: string;
  decidedAt?: string;
}

export interface KV {
  overrides: Record<string, string>; // rejection id → causeId
  review: Record<string, { status: 'open' | 'reviewed'; at: string }>;
  rules: ProposedRule[];
  verified: Record<string, string>; // rule id → last verification date (ISO)
}

const DB = 'wad-claim-review-v2';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('imports', { keyPath: 'meta.id' });
      db.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  return open().then((db) => new Promise<T>((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res((req && 'result' in req ? req.result : undefined) as T);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

export const dbAvailable = () => typeof indexedDB !== 'undefined';
export const loadImports = () => tx<ImportBundle[]>('imports', 'readonly', (s) => s.getAll());
export const saveImport = (b: ImportBundle) => tx<void>('imports', 'readwrite', (s) => { s.put(b); });
export const deleteImport = (id: string) => tx<void>('imports', 'readwrite', (s) => { s.delete(id); });
export async function updateMeta(id: string, patch: Partial<ImportMeta>) {
  const all = await loadImports();
  const b = all.find((x) => x.meta.id === id);
  if (b) await saveImport({ ...b, meta: { ...b.meta, ...patch } });
}

export async function loadKV(): Promise<KV> {
  const v = await tx<Partial<KV> | undefined>('kv', 'readonly', (s) => s.get('state'));
  return { overrides: {}, review: {}, rules: [], verified: {}, ...(v ?? {}) };
}
export const saveKV = (kv: KV) => tx<void>('kv', 'readwrite', (s) => { s.put(kv, 'state'); });

export interface StorageInfo {
  persisted: boolean | null;
  usage?: number;
  quota?: number;
}

/** Asks the browser not to evict this site's data under storage pressure, and reports usage. */
export async function storageInfo(request = false): Promise<StorageInfo> {
  try {
    const sm = navigator.storage;
    if (!sm) return { persisted: null };
    const persisted = request && sm.persist ? await sm.persist() : sm.persisted ? await sm.persisted() : null;
    const est = sm.estimate ? await sm.estimate() : {};
    return { persisted, usage: est.usage, quota: est.quota };
  } catch {
    return { persisted: null };
  }
}

/** Full backup of the local database as JSON (restore with importBackup). */
export async function exportBackup(): Promise<string> {
  return JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), imports: await loadImports(), kv: await loadKV() });
}

export async function importBackup(json: string): Promise<number> {
  const d = JSON.parse(json) as { version: number; imports: ImportBundle[]; kv: KV };
  if (d.version !== 2 || !Array.isArray(d.imports)) throw new Error('Not a WAD claim review backup file.');
  const existing = new Set((await loadImports()).map((b) => b.meta.id));
  let added = 0;
  for (const b of d.imports) if (!existing.has(b.meta.id)) { await saveImport(b); added++; }
  if (d.kv) await saveKV({ ...(await loadKV()), ...d.kv });
  return added;
}
