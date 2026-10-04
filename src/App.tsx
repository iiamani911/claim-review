import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ClaimAudit, Rejection, Claim } from './lib/types';
import { Formulary, type FormularyData } from './lib/formulary';
import { auditAll } from './lib/engine';
import { linkRejections } from './lib/rejections';
import { demoFiles, loadFiles, saveFiles, type LoadedFile } from './store';
import { Icon, int } from './ui';
import Overview from './pages/Overview';
import ImportPage from './pages/Import';
import AuditPage from './pages/Audit';
import RejectionsPage from './pages/Rejections';
import DoctorsPage from './pages/Doctors';
import DrugChecker from './pages/DrugChecker';
import Rulebook from './pages/Rulebook';

export type PageId = 'overview' | 'import' | 'audit' | 'rejections' | 'doctors' | 'drugs' | 'rules';

interface DataCtx {
  files: LoadedFile[];
  claims: Claim[];
  audits: ClaimAudit[];
  rejections: Rejection[];
  formulary: Formulary | null;
  isDemo: boolean;
  addFiles: (f: LoadedFile[]) => void;
  removeFile: (id: string) => void;
  clearAll: () => void;
  go: (p: PageId, opts?: { claimId?: string; doctor?: string }) => void;
  focus: { claimId?: string; doctor?: string };
}

const Ctx = createContext<DataCtx | null>(null);
export const useData = () => useContext(Ctx)!;

const NAV: { id: PageId; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'audit', label: 'Medical audit', icon: 'audit' },
  { id: 'rejections', label: 'Rejection analytics', icon: 'rejections' },
  { id: 'doctors', label: 'Doctors', icon: 'doctors' },
  { id: 'drugs', label: 'Drug ↔ ICD checker', icon: 'drugs' },
  { id: 'rules', label: 'Rulebook & sources', icon: 'rules' },
  { id: 'import', label: 'Import files', icon: 'import' },
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

  useEffect(() => {
    fetch('data/formulary.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: FormularyData) => setFormulary(new Formulary(d)))
      .catch((e) => setFError(String(e)));
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
  const audits = useMemo(() => (formulary || fError ? auditAll(claims, formulary) : []), [claims, formulary, fError]);
  const rejections = useMemo(() => linkRejections(files.flatMap((f) => f.rejections), claims), [files, claims]);

  const persist = (next: LoadedFile[]) => {
    setFiles(next);
    saveFiles(next);
  };
  const ctx: DataCtx = {
    files, claims, audits, rejections, formulary, isDemo, focus,
    addFiles: (f) => persist([...files.filter((x) => !x.demo), ...f]),
    removeFile: (id) => {
      const next = files.filter((x) => x.id !== id);
      persist(next.length ? next : demoFiles());
    },
    clearAll: () => persist(demoFiles()),
    go: (p, opts) => {
      setFocus(opts ?? {});
      if (location.hash !== `#${p}`) location.hash = p;
      setPage(p);
      scrollTo({ top: 0 });
    },
  };

  const counts: Partial<Record<PageId, number>> = {
    audit: audits.filter((a) => a.worst === 'critical' || a.worst === 'high').length,
    rejections: rejections.length,
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
              <b>Demo data.</b> Fictional patients and claims are loaded so you can explore. Import your HIS export and payer statements to audit real claims.
              <button className="btn small primary" onClick={() => ctx.go('import')}>Import files</button>
            </div>
          )}
          {fError && <div className="banner">Drug formulary could not be loaded ({fError}). Drug ↔ diagnosis checks are paused; other checks still run.</div>}
          {!ready ? <p className="muted">Loading…</p> : <Page id={page} />}
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
  }
}
