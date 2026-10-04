import { Component, createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ClaimAudit, PayerView } from './lib/types';
import { Formulary, type FormularyData } from './lib/formulary';
import { auditAll, type AuditContext } from './lib/engine';
import { buildHistory, type HistoryIndex } from './lib/history';
import { deriveDataset, type Dataset } from './dataset';
import { dbAvailable, deleteImport, loadImports, loadKV, saveImport, saveKV, storageInfo, updateMeta, type ImportBundle, type KV, type ProposedRule, type StorageInfo } from './db';
import { commit, type Decision, type Staged } from './importer';
import { demoBundles } from './demo';
import { Icon } from './ui';
import RejectionsPage from './pages/Rejections';
import AuditPage from './pages/Audit';
import DoctorsPage from './pages/Doctors';
import DrugChecker from './pages/DrugChecker';
import Rulebook from './pages/Rulebook';
import FilesPage from './pages/Files';

export type PageId = 'rejections' | 'audit' | 'doctors' | 'drugs' | 'rules' | 'files';

export interface Focus { claimId?: string; doctor?: string; importId?: string; tab?: string; period?: string }

interface DataCtx {
  ready: boolean;
  bundles: ImportBundle[];
  ds: Dataset;
  audits: ClaimAudit[];
  history: HistoryIndex;
  formulary: Formulary | null;
  formularySource: string;
  kv: KV;
  storage: StorageInfo;
  dbError: string;
  payer: PayerView;
  setPayer: (p: PayerView) => void;
  importStaged: (s: Staged, d: Decision) => Promise<ImportBundle>;
  removeImport: (id: string) => Promise<void>;
  setOverride: (rejectionId: string, causeId: string | null) => void;
  setReview: (ids: string[], status: 'open' | 'reviewed') => void;
  proposeRule: (r: ProposedRule) => void;
  decideRule: (id: string, status: ProposedRule['status']) => void;
  markVerified: (ruleId: string) => void;
  reload: () => Promise<void>;
  go: (p: PageId, focus?: Focus) => void;
  focus: Focus;
}

const Ctx = createContext<DataCtx | null>(null);
export const useData = () => useContext(Ctx)!;

export const NAV: { id: PageId; label: string; icon: string }[] = [
  { id: 'rejections', label: 'Rejection analysis', icon: 'rejections' },
  { id: 'audit', label: 'Medical audit', icon: 'audit' },
  { id: 'doctors', label: 'Doctors', icon: 'doctors' },
  { id: 'drugs', label: 'Drug ↔ ICD checker', icon: 'drugs' },
  { id: 'rules', label: 'Rulebook & sources', icon: 'rules' },
  { id: 'files', label: 'All files', icon: 'import' },
];

const pageFromHash = (): PageId => {
  const h = location.hash.replace('#', '') as PageId;
  return NAV.some((n) => n.id === h) ? h : 'rejections';
};

const EMPTY_KV: KV = { overrides: {}, review: {}, rules: [], verified: {} };

export default function App() {
  const [page, setPage] = useState<PageId>(pageFromHash());
  const [focus, setFocus] = useState<Focus>({});
  const [bundles, setBundles] = useState<ImportBundle[]>([]);
  const [kv, setKv] = useState<KV>(EMPTY_KV);
  const [ready, setReady] = useState(false);
  const [builtIn, setBuiltIn] = useState<FormularyData | null>(null);
  const [fError, setFError] = useState('');
  const [dbError, setDbError] = useState('');
  const [storage, setStorage] = useState<StorageInfo>({ persisted: null });
  const [payer, setPayerState] = useState<PayerView>(() => {
    try { return (localStorage.getItem('wad-payer') as PayerView) || 'Both'; } catch { return 'Both'; }
  });
  const setPayer = (p: PayerView) => { setPayerState(p); try { localStorage.setItem('wad-payer', p); } catch { /* per-viewer convenience only */ } };

  const reload = useCallback(async () => {
    if (!dbAvailable()) { setDbError('This browser has no IndexedDB – imports cannot be saved.'); setBundles([]); return; }
    try {
      const [b, k] = await Promise.all([loadImports(), loadKV()]);
      setBundles(b);
      setKv(k);
    } catch (e) {
      setDbError(`Local database unavailable (${String(e)}). Imports will not be saved in this browser session.`);
    }
  }, []);

  useEffect(() => {
    fetch('data/formulary.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))).then(setBuiltIn).catch((e) => setFError(String(e)));
    reload().then(() => setReady(true));
    storageInfo(true).then(setStorage);
    const onHash = () => setPage(pageFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, [reload]);

  const all = useMemo(() => (bundles.length ? bundles : demoBundles()), [bundles]);
  const ds = useMemo(() => deriveDataset(all, kv), [all, kv]);
  const formulary = useMemo(() => (ds.formulary ? new Formulary(ds.formulary.data) : builtIn ? new Formulary(builtIn) : null), [ds.formulary, builtIn]);
  const formularySource = ds.formulary ? `Uploaded: ${ds.formulary.filename} (${ds.formulary.uploadedAt.slice(0, 10)})` : builtIn ? `Built-in: ${builtIn.version}` : fError ? 'Unavailable' : 'Loading…';
  const accepted = useMemo(() => kv.rules.filter((r) => r.status === 'accepted').map((r) => ({ id: r.id, payer: r.payer, serviceKey: r.serviceKey, dxGroup: r.dxGroup, serviceLabel: r.serviceLabel, rejected: r.rejected, submitted: r.submitted })), [kv.rules]);
  const history = useMemo(() => buildHistory(ds.claims, ds.rejections, accepted), [ds.claims, ds.rejections, accepted]);
  const audits = useMemo(() => {
    if (!formulary && !fError) return [];
    const ctxFor = (c: (typeof ds.claims)[number]): AuditContext => ({
      priceList: ds.priceLists[c.payer].size ? ds.priceLists[c.payer] : undefined,
      priceListName: ds.priceListMeta[c.payer].map((m) => m.filename).join(', '),
      approvalList: ds.approvalLists[c.payer].size ? ds.approvalLists[c.payer] : undefined,
      approvalListName: ds.approvalMeta[c.payer].map((m) => m.filename).join(', '),
      history,
    });
    return auditAll(ds.claims, formulary, ctxFor);
  }, [ds, formulary, fError, history]);

  const persistKv = (next: KV) => { setKv(next); saveKV(next).catch((e) => setDbError(String(e))); };

  const ctx: DataCtx = {
    ready, bundles, ds, audits, history, formulary, formularySource, kv, storage, dbError, payer, setPayer, focus,
    importStaged: async (s, d) => {
      const { bundle, replaced } = commit(s, d, bundles);
      await saveImport(bundle);
      for (const id of replaced) await updateMeta(id, { status: 'replaced', replacedBy: bundle.meta.id });
      await reload();
      storageInfo().then(setStorage);
      return bundle;
    },
    removeImport: async (id) => {
      await deleteImport(id);
      // Re-activate an import this one had replaced, so removing a revision restores the previous version.
      for (const b of bundles) if (b.meta.replacedBy === id) await updateMeta(b.meta.id, { status: 'active', replacedBy: undefined });
      await reload();
    },
    setOverride: (id, causeId) => {
      const o = { ...kv.overrides };
      if (causeId) o[id] = causeId; else delete o[id];
      persistKv({ ...kv, overrides: o });
    },
    setReview: (ids, status) => {
      const r = { ...kv.review };
      for (const id of ids) r[id] = { status, at: new Date().toISOString() };
      persistKv({ ...kv, review: r });
    },
    proposeRule: (rule) => persistKv({ ...kv, rules: [...kv.rules.filter((x) => x.id !== rule.id), rule] }),
    decideRule: (id, status) => persistKv({ ...kv, rules: kv.rules.map((r) => (r.id === id ? { ...r, status, decidedAt: new Date().toISOString() } : r)) }),
    markVerified: (ruleId) => persistKv({ ...kv, verified: { ...kv.verified, [ruleId]: new Date().toISOString() } }),
    reload,
    go: (p, f) => {
      setFocus(f ?? {});
      if (location.hash !== `#${p}`) location.hash = p;
      setPage(p);
      scrollTo({ top: 0 });
    },
  };

  return (
    <Ctx.Provider value={ctx}>
      <div className="shell">
        <aside className="rail">
          <div className="brand">
            <div className="brand-mark">WAD</div>
            <div><b>WAD Clinic</b><span>Claim review · Bupa & Tawuniya</span></div>
          </div>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <button key={n.id} aria-current={page === n.id ? 'page' : undefined} onClick={() => ctx.go(n.id)}>
                <Icon name={n.icon} />{n.label}
              </button>
            ))}
          </nav>
          <div className="rail-foot">
            <span className="eyebrow">Stored in this browser</span>
            <span>{bundles.filter((b) => b.meta.status === 'active').length} active imports · {ds.claims.length.toLocaleString('en-US')} encounters · {ds.rejections.length.toLocaleString('en-US')} rejected lines</span>
            <span className="faint">{storage.persisted ? 'Persistent storage granted.' : storage.persisted === false ? 'Browser may clear data under storage pressure.' : ''} Data stays on this device only.</span>
          </div>
        </aside>
        <main className="main">
          <div className="topbar">
            <div className="seg payer-seg" role="group" aria-label="Insurer">
              {(['Bupa', 'Tawuniya', 'Both'] as PayerView[]).map((p) => <button key={p} aria-pressed={payer === p} onClick={() => setPayer(p)}>{p}</button>)}
            </div>
            <span className="faint" style={{ fontSize: 12 }}>{payer === 'Both' ? 'Combined view of Bupa and Tawuniya' : `Showing ${payer} only`}</span>
            <button className="btn primary small" style={{ marginLeft: 'auto' }} onClick={() => ctx.go('files', { tab: 'upload' })}><Icon name="upload" />Upload files</button>
          </div>
          {ds.isDemo && ready && (
            <div className="banner" role="status">
              <b>Demo data.</b> Fictional Bupa and Tawuniya records are shown until you import your own files. Demo records are never stored and disappear from all reports as soon as real data exists.
              <button className="btn small primary" onClick={() => ctx.go('files', { tab: 'upload' })}>Upload files</button>
            </div>
          )}
          {dbError && <div className="banner" role="alert">{dbError}</div>}
          {fError && !ds.formulary && <div className="banner">Built-in drug formulary could not be loaded ({fError}). Drug ↔ diagnosis checks show “Unable to verify” until a CHI DDF file is uploaded under All files.</div>}
          {!ready ? <p className="muted">Loading local database…</p> : <ErrorBoundary key={page}><Page id={page} /></ErrorBoundary>}
        </main>
      </div>
    </Ctx.Provider>
  );
}

function Page({ id }: { id: PageId }) {
  switch (id) {
    case 'rejections': return <RejectionsPage />;
    case 'audit': return <AuditPage />;
    case 'doctors': return <DoctorsPage />;
    case 'drugs': return <DrugChecker />;
    case 'rules': return <Rulebook />;
    case 'files': return <FilesPage />;
  }
}

/** Shows what went wrong instead of a blank page when data has a shape the screens did not expect. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(e: unknown) {
    return { error: String(e instanceof Error ? e.message : e) };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" role="alert">
        <h2>This page could not be shown</h2>
        <p className="muted" style={{ marginTop: 6 }}>Something in the data broke this screen: <span className="mono">{this.state.error}</span></p>
        <p className="muted" style={{ marginTop: 6 }}>Your imports are still stored. Open All files to check the last import.</p>
        <button className="btn" style={{ marginTop: 10 }} onClick={() => this.setState({ error: '' })}>Try again</button>
      </div>
    );
  }
}
