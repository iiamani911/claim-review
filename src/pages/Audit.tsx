import { useEffect, useMemo, useState } from 'react';
import { useData } from '../App';
import type { ClaimAudit, AuditArea } from '../lib/types';
import { AREAS, SEVERITY_ORDER, viewAudit, type AuditView } from '../lib/engine';
import UploadZone from '../UploadZone';
import { exportFindings } from '../lib/exportXlsx';
import { Empty, Icon, Sev, int, sar } from '../ui';
import ClaimDetail from './ClaimDetail';

const rank = (a: ClaimAudit) => (a.worst ? SEVERITY_ORDER.indexOf(a.worst) : 9);

export const needsReview = (a: ClaimAudit) => a.findings.some((f) => f.severity === 'critical' || f.severity === 'high');

export default function AuditPage() {
  const { audits } = useData();
  const mine = useMemo(() => audits.filter((a) => a.claim.section === 'medical').map((a) => viewAudit(a, 'medical')), [audits]);
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Pre-submission review</span>
          <h1>Medical audit</h1>
          <p>Upload the claims you are about to submit. Start with <b>Must fix</b>: each claim shows exactly what to change. Explanations are in a separate tab.</p>
        </div>
      </div>
      <UploadZone section="medical" compact />
      <AuditWorkspace audits={mine} view="medical" exportName="WAD_medical_audit.xlsx" />
    </>
  );
}

type Level = 'must' | 'review' | 'ok' | 'all';
const levelOf = (a: ClaimAudit): Exclude<Level, 'all'> => (needsReview(a) ? 'must' : a.findings.some((f) => f.severity === 'medium') ? 'review' : 'ok');
const hasWatch = (a: ClaimAudit) => a.findings.some((f) => f.area === 'Always-rejected items');

export function AuditWorkspace({ audits, view, exportName, emptyText }: { audits: ClaimAudit[]; view: AuditView; exportName: string; emptyText?: string }) {
  const { focus, review, files } = useData();
  const [fileId, setFileId] = useState(focus.fileId ?? '');
  const srcFiles = useMemo(() => files.filter((f) => audits.some((a) => a.claim.sourceFileId === f.id)), [files, audits]);
  const [q, setQ] = useState('');
  const [level, setLevel] = useState<Level>('must');
  const [onlyWatch, setOnlyWatch] = useState(false);
  const [more, setMore] = useState(false);
  const [showWatch, setShowWatch] = useState(false);
  const [area, setArea] = useState<AuditArea | ''>('');
  const [doctor, setDoctor] = useState(focus.doctor ?? '');
  const [month, setMonth] = useState('');
  const [sort, setSort] = useState<'score' | 'amount' | 'date'>('score');
  const [sel, setSel] = useState<string | null>(focus.claimId ?? null);

  useEffect(() => { if (focus.claimId) { setSel(focus.claimId); setLevel('all'); } }, [focus.claimId]);
  useEffect(() => { if (focus.fileId) { setFileId(focus.fileId); setLevel('must'); setSel(null); } }, [focus.fileId]);

  const doctors = useMemo(() => [...new Set(audits.map((a) => a.claim.physician))].sort(), [audits]);
  const months = useMemo(() => [...new Set(audits.map((a) => a.claim.serviceDate.slice(0, 7)).filter(Boolean))].sort(), [audits]);
  const inFile = useMemo(() => audits.filter((a) => !fileId || a.claim.sourceFileId === fileId), [audits, fileId]);
  const counts = useMemo(() => {
    const c = { must: 0, review: 0, ok: 0, all: inFile.length, watch: 0 };
    for (const a of inFile) { c[levelOf(a)]++; if (hasWatch(a)) c.watch++; }
    return c;
  }, [inFile]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return inFile
      .filter((a) => level === 'all' || levelOf(a) === level)
      .filter((a) => !onlyWatch || hasWatch(a))
      .filter((a) => !area || a.findings.some((f) => f.area === area))
      .filter((a) => !doctor || a.claim.physician === doctor)
      .filter((a) => !month || a.claim.serviceDate.startsWith(month))
      .filter((a) => !t || [a.claim.claimNo, a.claim.mrn, a.claim.patientName, a.claim.physician, ...a.claim.diagnoses.map((d) => d.code), ...a.claim.lines.map((l) => l.desc)].join(' ').toLowerCase().includes(t))
      .sort((a, b) => (sort === 'score' ? rank(a) - rank(b) || b.score - a.score || b.amountAtRisk - a.amountAtRisk : sort === 'amount' ? b.amountAtRisk - a.amountAtRisk : b.claim.serviceDate.localeCompare(a.claim.serviceDate)));
  }, [inFile, q, level, onlyWatch, area, doctor, month, sort]);

  const selected = audits.find((a) => a.claim.id === sel) ?? list[0] ?? null;
  if (!audits.length) return <div className="card"><Empty title="Upload a file to start analysis.">{emptyText ?? 'Upload an HIS claim export above.'}</Empty></div>;

  return (
    <>
      <div className="stat-strip">
        <button className={`stat ${level === 'must' ? 'on' : ''}`} onClick={() => setLevel('must')}><span className="dot crit" /><b className="num">{int(counts.must)}</b> Must fix</button>
        <button className={`stat ${level === 'review' ? 'on' : ''}`} onClick={() => setLevel('review')}><span className="dot med" /><b className="num">{int(counts.review)}</b> Review</button>
        <button className={`stat ${level === 'ok' ? 'on' : ''}`} onClick={() => setLevel('ok')}><span className="dot good" /><b className="num">{int(counts.ok)}</b> Ready to submit</button>
        <button className={`stat ${onlyWatch ? 'on' : ''}`} onClick={() => setOnlyWatch((x) => !x)} title="Claims that contain an item the insurer always rejects"><span className="watch-badge">⛔</span><b className="num">{int(counts.watch)}</b> with always-rejected items</button>
        <span style={{ flex: 1 }} />
        <button className="btn small" onClick={() => setShowWatch((x) => !x)}>{showWatch ? 'Hide' : 'Show'} always-rejected list</button>
        <button className="btn small primary" onClick={() => exportFindings(list, exportName)} disabled={!list.length}><Icon name="download" />Export {int(list.length)}</button>
      </div>

      {showWatch && <WatchPanel />}

      <div className="filters" role="group" aria-label="Filters">
        <input id="audit-q" className="input" placeholder="Search patient, file no, ICD, service…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg" role="group" aria-label="Level">
          {([['must', 'Must fix'], ['review', 'Review'], ['ok', 'Ready'], ['all', 'All']] as [Level, string][]).map(([k, l]) => <button key={k} aria-pressed={level === k} onClick={() => setLevel(k)}>{l}</button>)}
        </div>
        <select id="audit-doctor" className="select" value={doctor} onChange={(e) => setDoctor(e.target.value)} aria-label="Doctor">
          <option value="">All doctors</option>
          {doctors.map((d) => <option key={d}>{d}</option>)}
        </select>
        <button className="btn small ghost" onClick={() => setMore((x) => !x)}>{more ? 'Fewer filters' : 'More filters'}</button>
      </div>
      {more && (
        <div className="filters">
          {srcFiles.length > 1 && (
            <select id="audit-file" className="select" value={fileId} onChange={(e) => setFileId(e.target.value)} aria-label="File">
              <option value="">All files ({srcFiles.length})</option>
              {srcFiles.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
          <select id="audit-area" className="select" value={area} onChange={(e) => setArea(e.target.value as AuditArea | '')} aria-label="Area">
            <option value="">All areas</option>
            {AREAS.map((a) => <option key={a}>{a}</option>)}
          </select>
          {months.length > 1 && (
            <select id="audit-month" className="select" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
              <option value="">All months</option>
              {months.map((m) => <option key={m}>{m}</option>)}
            </select>
          )}
          <select id="audit-sort" className="select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
            <option value="score">Sort: most urgent</option>
            <option value="amount">Sort: SAR at risk</option>
            <option value="date">Sort: newest</option>
          </select>
        </div>
      )}

      <div className="split">
        <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>
          {list.length ? (
            <table className="claim-list">
              <thead><tr><th>Patient</th><th>What to fix</th><th className="r">At risk</th></tr></thead>
              <tbody>
                {list.slice(0, 400).map((a) => <Row key={a.claim.id} a={a} reviewed={review[a.claim.id]?.status === 'reviewed'} selected={a.claim.id === selected?.claim.id} onClick={() => setSel(a.claim.id)} />)}
              </tbody>
            </table>
          ) : <Empty title={level === 'must' ? 'Nothing must be fixed here' : 'No claims match these filters'}>{level === 'must' ? 'All claims in this view are ready or only need review.' : 'Clear a filter or choose another level.'}</Empty>}
          {list.length > 400 && <p className="faint" style={{ padding: 12 }}>Showing first 400 of {int(list.length)}. Narrow the filters or export to Excel.</p>}
        </div>
        <div className="detail">{selected ? <ClaimDetail key={selected.claim.id} a={selected} view={view} /> : <div className="card"><Empty title="Select a claim">Pick a claim to see what to change.</Empty></div>}</div>
      </div>
    </>
  );
}

function Row({ a, selected, reviewed, onClick }: { a: ClaimAudit; selected: boolean; reviewed: boolean; onClick: () => void }) {
  const c = a.claim;
  const must = a.findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
  const watch = a.findings.some((f) => f.area === 'Always-rejected items');
  const first = must.find((f) => f.area === 'Always-rejected items') ?? must.find((f) => f.area === 'Drug ↔ Diagnosis') ?? must[0] ?? a.findings[0];
  return (
    <tr className="clickable" aria-selected={selected} onClick={onClick} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <td style={{ minWidth: 150 }}>
        <b>{c.patientName || `MRN ${c.mrn}`}</b>
        <div className="faint" style={{ fontSize: 12 }}><span className="mono">File {c.mrn}</span> · {c.serviceDate}</div>
        <div className="faint" style={{ fontSize: 12 }}>{c.physician}</div>
      </td>
      <td>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {reviewed ? <span className="flag-chip done">✓ Reviewed</span> : <Sev s={a.worst} />}
          {must.length > 0 && <span className="num faint">{must.length} change{must.length > 1 ? 's' : ''}</span>}
          {watch && <span className="watch-badge" title="Contains an item the insurer always rejects">⛔</span>}
        </div>
        {first && <div style={{ fontSize: 13, marginTop: 3 }}>{first.title}</div>}
      </td>
      <td className="r num">{sar(a.amountAtRisk)}</td>
    </tr>
  );
}

/** The always-rejected list: hospital-confirmed items plus items learned from the loaded statements. */
function WatchPanel() {
  const { watch } = useData();
  return (
    <section className="card">
      <div className="card-head"><h2>⛔ Always-rejected items</h2><p>flagged automatically on every claim line that uses them</p></div>
      <div className="table-wrap" style={{ border: 0 }}>
        <table>
          <thead><tr><th>Item</th><th>Problem</th><th>Do this instead</th><th>Source</th></tr></thead>
          <tbody>
            {watch.map((w) => (
              <tr key={w.key + w.name}>
                <td style={{ minWidth: 180 }}><span className="watch-badge">{w.kind === 'replace' ? '⛔' : '⚠'}</span> <b>{w.name}</b>{w.codes.length > 0 && <div className="faint mono" style={{ fontSize: 11 }}>{w.codes.join(', ')}</div>}</td>
                <td style={{ fontSize: 13 }}>{w.problem}{w.times ? <span className="faint"> · {w.times}× in loaded statements</span> : null}</td>
                <td style={{ fontSize: 13 }}><b>{w.action}</b></td>
                <td className="faint" style={{ fontSize: 12 }}>{w.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
