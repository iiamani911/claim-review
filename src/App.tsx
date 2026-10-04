import { Component, createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ClaimAudit, Rejection, Claim, Section } from './lib/types';
import { Formulary, type FormularyData } from './lib/formulary';
import { auditAll, viewAudit } from './lib/engine';
import { buildWatchlist, type WatchItem } from './lib/kb/watchlist';
import { linkRejections } from './lib/rejections';
import { demoFiles, loadFiles, loadReview, moveFile, saveFiles, saveReview, type LoadedFile, type ReviewMap, type ReviewStatus } from './store';
import { Icon, int } from './ui';
import Overview from './pages/Overview';
import ImportPage from './pages/Import';
import AuditPage from './pages/Audit';
import RejectionsPage from './pages/Rejections';
import DoctorsPage from './pages/Doctors';
import DrugChecker from './pages/DrugChecker';
import Rulebook from './pages/Rulebook';
import TechnicalPage from './pages/Technical';
import ReviewPage from './pages/Review';
import ComparePage from './pages/Compare';

export type PageId = 'overview' | 'import' | 'audit' | 'rejections' | 'technical' | 'review' | 'compare' | 'doctors' | 'drugs' | 'rules';

interface DataCtx {
  files: LoadedFile[];
  claims: Claim[];
  audits: ClaimAudit[];
  rejections: Rejection[];
  formulary: Formulary | null;
  watch: WatchItem[];
  isDemo: boolean;
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
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'audit', label: 'Medical audit', icon: 'audit' },
  { id: 'rejections', label: 'Rejection analysis', icon: 'rejections' },
  { id: 'technical', label: 'Technical audit', icon: 'technical' },
  { id: 'review', label: 'Files to review', icon: 'flag' },
  { id: 'compare', label: 'Month comparison', icon: 'compare' },
  { id: 'doctors', label: 'Doctors', icon: 'doctors' },
  { id: 'drugs', label: 'Drug ↔ ICD checker', icon: 'drugs' },
  { id: 'rules', label: 'Rulebook & sources', icon: 'rules' },
  { id: 'import', label: 'All files', icon: 'import' },
];

const pageFromHash = (): PageId => {
  const h = location.hash.replace('#', '') as PageId;
  return NAV.some((n) => n.id === h) ? h : 'overview';
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
      setFiles(f && f.length ? f : demoFiles());
      setReady(true);
    });
    const onHash = () => setPage(pageFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const isDemo = files.length > 0 && files.every((f) => f.demo);
  const claims = useMemo(() => files.flatMap((f) => f.claims), [files]);
  const watch = useMemo(() => buildWatchlist(files.flatMap((f) => f.rejections)), [files]);
  const audits = useMemo(() => (formulary || fError ? auditAll(claims, formulary, watch) : []), [claims, formulary, fError, watch]);
  const rejections = useMemo(() => linkRejections(files.flatMap((f) => f.rejections), claims), [files, claims]);

  const persist = (next: LoadedFile[]) => {
    setFiles(next);
    saveFiles(next);
  };
  const ctx: DataCtx = {
    files, claims, audits, rejections, formulary, watch, isDemo, focus,
    // Uploading the same file again into the same section replaces it instead of doubling every encounter.
    addFiles: (f) => persist([...files.filter((x) => !x.demo && !f.some((n) => n.name === x.name && n.section === x.section && n.sheet === x.sheet)), ...f]),
    removeFile: (id) => {
      const next = files.filter((x) => x.id !== id);
      persist(next.length ? next : demoFiles());
    },
    clearAll: () => persist(demoFiles()),
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
    technical: audits.filter((a) => a.claim.section === 'technical').length,
    review: audits.filter((a) => serious(viewAudit(a, a.claim.section === 'technical' ? 'technical' : a.claim.section === 'rejection' ? 'all' : 'medical')) && review[a.claim.id]?.status !== 'reviewed').length,
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
          {isDemo && ready && (
            <div className="banner" role="status">
              <b>Demo data.</b> Fictional patients (June and July) are loaded so you can explore. Upload your files in Medical audit, Rejection analysis or Technical audit.
              <button className="btn small primary" onClick={() => ctx.go('audit')}>Upload claims</button>
              <button className="btn small" onClick={() => ctx.go('rejections')}>Upload rejections</button>
            </div>
          )}
          {fError && <div className="banner">Drug formulary could not be loaded ({fError}). Drug ↔ diagnosis checks are paused; other checks still run.</div>}
          {!ready ? <p className="muted">Loading…</p> : <ErrorBoundary key={page}><Page id={page} /></ErrorBoundary>}
        </main>
      </div>
    </Ctx.Provider>
  );
}

function Page({ id }: { id: PageId }) {
  switch (id) {
    case 'overview': return <Overview />;
    case 'import': return <ImportPage />;
    case 'audit': return <AuditPage />;
    case 'rejections': return <RejectionsPage />;
    case 'doctors': return <DoctorsPage />;
    case 'drugs': return <DrugChecker />;
    case 'rules': return <Rulebook />;
    case 'technical': return <TechnicalPage />;
    case 'review': return <ReviewPage />;
    case 'compare': return <ComparePage />;
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
        <p className="muted" style={{ marginTop: 6 }}>Your files are still loaded. Try another page, or remove the last file from All files and send it to the insurance office developer.</p>
        <button className="btn" style={{ marginTop: 10 }} onClick={() => this.setState({ error: '' })}>Try again</button>
      </div>
    );
  }
}
