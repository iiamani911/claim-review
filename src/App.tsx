import { Component, createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ClaimAudit, Rejection, Claim, Section } from './lib/types';
import { Formulary, type FormularyData } from './lib/formulary';
import { auditAll, viewAudit } from './lib/engine';
import { buildWatchlist, type WatchItem } from './lib/kb/watchlist';
import { linkRejections } from './lib/rejections';
import { loadFiles, loadReview, moveFile, saveFiles, saveReview, type LoadedFile, type ReviewMap, type ReviewStatus } from './store';
import { Icon, int } from './ui';
import AuditPage from './pages/Audit';
import RejectionsPage from './pages/Rejections';
import DoctorsPage from './pages/Doctors';

export type PageId = 'rejections' | 'audit' | 'doctors';

interface DataCtx {
  files: LoadedFile[];
  claims: Claim[];
  audits: ClaimAudit[];
  rejections: Rejection[];
  formulary: Formulary | null;
  watch: WatchItem[];
  addFiles: (f: LoadedFile[]) => void;
  removeFile: (id: string) => void;
  setSection: (id: string, s: Section) => void;
  review: ReviewMap;
  setReview: (ids: string[], s: ReviewStatus) => void;
  clearAll: () => void;
  go: (p: PageId, opts?: { claimId?: string; doctor?: string; fileId?: string }) => void;
  focus: { claimId?: string; doctor?: string; fileId?: string };
}

const Ctx = createContext<DataCtx | null>(null);
export const useData = () => useContext(Ctx)!;

const NAV: { id: PageId; label: string; icon: string }[] = [
  { id: 'rejections', label: 'Rejection analysis', icon: 'rejections' },
  { id: 'audit', label: 'Medical audit', icon: 'audit' },
  { id: 'doctors', label: 'Doctors', icon: 'doctors' },
];

const pageFromHash = (): PageId => {
  const h = location.hash.replace('#', '') as PageId;
  return NAV.some((n) => n.id === h) ? h : 'rejections';
};

export default function App() {
  const [page, setPage] = useState<PageId>(pageFromHash());
  const [focus, setFocus] = useState<DataCtx['focus']>({});
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [ready, setReady] = useState(false);
  const [formulary, setFormulary] = useState<Formulary | null>(null);
  const [fError, setFError] = useState('');
  const [review, setReviewMap] = useState<ReviewMap>({});

  useEffect(() => {
    fetch('data/formulary.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: FormularyData) => setFormulary(new Formulary(d)))
      .catch((e) => setFError(String(e)));
    loadReview().then(setReviewMap);
    loadFiles().then((f) => {
      setFiles(f);
      setReady(true);
    });
    const onHash = () => setPage(pageFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const claims = useMemo(() => files.flatMap((f) => f.claims), [files]);
  const watch = useMemo(() => buildWatchlist(files.flatMap((f) => f.rejections)), [files]);
  const audits = useMemo(() => (formulary || fError ? auditAll(claims, formulary, watch) : []), [claims, formulary, fError, watch]);
  const rejections = useMemo(() => linkRejections(files.flatMap((f) => f.rejections), claims), [files, claims]);

  const persist = (next: LoadedFile[]) => {
    setFiles(next);
    saveFiles(next);
  };
  const ctx: DataCtx = {
    files, claims, audits, rejections, formulary, watch, focus,
    // Uploading the same file again into the same section replaces it instead of doubling every encounter.
    addFiles: (f) => persist([...files.filter((x) => !f.some((n) => n.name === x.name && n.section === x.section && n.sheet === x.sheet)), ...f]),
    removeFile: (id) => {
      persist(files.filter((x) => x.id !== id));
    },
    clearAll: () => persist([]),
    setSection: (id, sec) => persist(files.map((f) => (f.id === id ? moveFile(f, sec) : f))),
    review,
    setReview: (ids, st) => {
      const next = { ...review };
      for (const id of ids) next[id] = { status: st, at: new Date().toISOString() };
      setReviewMap(next);
      saveReview(next);
    },
    go: (p, opts) => {
      setFocus(opts ?? {});
      if (location.hash !== `#${p}`) location.hash = p;
      setPage(p);
      scrollTo({ top: 0 });
    },
  };

  const serious = (a: ClaimAudit) => a.findings.some((f) => f.severity === 'critical' || f.severity === 'high');
  const counts: Partial<Record<PageId, number>> = {
    audit: audits.filter((a) => a.claim.section === 'medical' && serious(viewAudit(a, 'medical'))).length,
    rejections: rejections.length + audits.filter((a) => a.claim.section === 'rejection').length,
    doctors: new Set(audits.map((a) => a.claim.physician)).size,
  };

  return (
    <Ctx.Provider value={ctx}>
      <div className="shell">
        <aside className="rail">
          <div className="brand">
            <div className="brand-mark">WAD</div>
            <div><b>WAD Clinic</b><span>Claim review · medical audit</span></div>
          </div>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <button key={n.id} aria-current={page === n.id ? 'page' : undefined} onClick={() => ctx.go(n.id)}>
                <Icon name={n.icon} />{n.label}{counts[n.id] !== undefined && <span className="count">{int(counts[n.id]!)}</span>}
              </button>
            ))}
          </nav>
          <div className="rail-foot">
            <span className="eyebrow">Loaded data</span>
            <span>{int(audits.length)} encounters · {int(rejections.length)} rejected lines</span>
            <span>{formulary ? `CHI DDF: ${int(Object.keys(formulary.data.ingredients).length)} ingredients` : fError ? 'Formulary failed to load' : 'Loading formulary…'}</span>
            <span className="faint">Files are processed in this browser only. Nothing is uploaded.</span>
          </div>
        </aside>
        <main className="main">
          {fError && <div className="banner">Drug formulary could not be loaded ({fError}). Drug ↔ diagnosis checks are paused; other checks still run.</div>}
          {!ready ? <p className="muted">Loading…</p> : <ErrorBoundary key={page}><Page id={page} /></ErrorBoundary>}
        </main>
      </div>
    </Ctx.Provider>
  );
}

function Page({ id }: { id: PageId }) {
  switch (id) {
    case 'audit': return <AuditPage />;
    case 'rejections': return <RejectionsPage />;
    case 'doctors': return <DoctorsPage />;
  }
}

/** Shows what went wrong instead of a blank page when a file has data the screens did not expect. */
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
        <p className="muted" style={{ marginTop: 6 }}>Something in the uploaded data broke this screen: <span className="mono">{this.state.error}</span></p>
        <p className="muted" style={{ marginTop: 6 }}>Your files are still loaded. Try another page, or remove the last uploaded file and send it to the insurance office developer.</p>
        <button className="btn" style={{ marginTop: 10 }} onClick={() => this.setState({ error: '' })}>Try again</button>
      </div>
    );
  }
}
