import { useMemo, useState } from 'react';
import { useData, type PageId } from '../App';
import type { ClaimAudit, Section } from '../lib/types';
import { SEVERITY_ORDER, viewAudit } from '../lib/engine';
import { encounterKey } from '../lib/parse';
import { exportMarked } from '../lib/exportXlsx';
import { SECTION_LABEL } from '../store';
import { Empty, Icon, Kpi, Sev, int, sar } from '../ui';

const viewFor = (s: Section | undefined) => (s === 'technical' ? 'technical' : s === 'rejection' ? 'all' : 'medical');
const pageFor: Record<Section, PageId> = { medical: 'audit', rejection: 'rejections', technical: 'technical' };

export default function ReviewPage() {
  const { audits, files, review, setReview, go } = useData();
  const [section, setSection] = useState<Section | ''>('');
  const [status, setStatus] = useState<'open' | 'reviewed' | ''>('open');
  const [doctor, setDoctor] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const marked = useMemo(
    () => audits
      .map((a) => viewAudit(a, viewFor(a.claim.section)))
      .filter((a) => a.findings.some((f) => f.severity === 'critical' || f.severity === 'high'))
      .sort((a, b) => SEVERITY_ORDER.indexOf(a.worst!) - SEVERITY_ORDER.indexOf(b.worst!) || b.amountAtRisk - a.amountAtRisk),
    [audits],
  );
  const isReviewed = (a: ClaimAudit) => review[a.claim.id]?.status === 'reviewed';
  const doctors = [...new Set(marked.map((a) => a.claim.physician))].sort();
  const t = q.trim().toLowerCase();
  const list = marked.filter((a) =>
    (!section || a.claim.section === section) &&
    (!status || (status === 'reviewed') === isReviewed(a)) &&
    (!doctor || a.claim.physician === doctor) &&
    (!t || `${a.claim.mrn} ${a.claim.patientName} ${a.claim.claimNo}`.toLowerCase().includes(t)),
  );
  const open = marked.filter((a) => !isReviewed(a));

  function download() {
    const byId = new Map(marked.map((a) => [a.claim.id, a]));
    const sources = files.filter((f) => f.kind === 'claims' && f.records.length && (!section || f.section === section)).map((f) => ({
      name: f.name, section: SECTION_LABEL[f.section], header: f.header, records: f.records, idOf: (r: Record<string, string>) => `${f.section}:${encounterKey(r)}`,
    }));
    exportMarked(sources, byId, (id) => review[id]?.status === 'reviewed');
  }

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Marked files</span>
          <h1>Files to review</h1>
          <p>Every encounter with a critical or high finding is marked with its file number and patient name. Work through the list, mark each one reviewed, and download your uploaded files back with a ⚑ REVIEW column on every flagged row.</p>
        </div>
        <button className="btn primary" onClick={download}><Icon name="download" />Download marked files (Excel)</button>
      </div>
      <section className="kpis">
        <Kpi label="Marked for review" value={int(marked.length)} tone="crit" sub={`${sar(marked.reduce((s, a) => s + a.amountAtRisk, 0))} at risk`} />
        <Kpi label="Still open" value={int(open.length)} tone="high" />
        <Kpi label="Reviewed" value={int(marked.length - open.length)} tone="good" />
        {(['medical', 'technical', 'rejection'] as Section[]).map((s) => <Kpi key={s} label={SECTION_LABEL[s]} value={int(marked.filter((a) => a.claim.section === s).length)} sub="marked" />)}
      </section>
      <div className="filters">
        <input id="rev-q" className="input" placeholder="File no, patient name or claim no" value={q} onChange={(e) => setQ(e.target.value)} />
        <select id="rev-section" className="select" value={section} onChange={(e) => setSection(e.target.value as Section | '')}>
          <option value="">All sections</option>
          {(['medical', 'technical', 'rejection'] as Section[]).map((s) => <option key={s} value={s}>{SECTION_LABEL[s]}</option>)}
        </select>
        <div className="seg" role="group" aria-label="Status">
          {([['open', 'Open'], ['reviewed', 'Reviewed'], ['', 'All']] as const).map(([k, l]) => <button key={l} aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}
        </div>
        <select id="rev-doctor" className="select" value={doctor} onChange={(e) => setDoctor(e.target.value)}>
          <option value="">All doctors</option>
          {doctors.map((d) => <option key={d}>{d}</option>)}
        </select>
        {picked.size > 0 && (
          <>
            <button className="btn small" onClick={() => { setReview([...picked], 'reviewed'); setPicked(new Set()); }}>Mark {picked.size} reviewed</button>
            <button className="btn small ghost" onClick={() => { setReview([...picked], 'open'); setPicked(new Set()); }}>Reopen</button>
          </>
        )}
      </div>
      <div className="table-wrap">
        {list.length ? (
          <table>
            <thead>
              <tr>
                <th><input type="checkbox" aria-label="Select all" checked={picked.size > 0 && picked.size === list.length} onChange={(e) => setPicked(e.target.checked ? new Set(list.map((a) => a.claim.id)) : new Set())} /></th>
                <th>Marker</th><th>File no · patient</th><th>Claim · date</th><th>Doctor</th><th>Section</th><th>Why it needs review</th><th className="r">At risk</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 500).map((a) => {
                const c = a.claim;
                const rv = isReviewed(a);
                const reasons = a.findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
                return (
                  <tr key={c.id} className="clickable" onClick={() => go(pageFor[c.section ?? 'medical'], { claimId: c.id })}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select file ${c.mrn}`} checked={picked.has(c.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); e.target.checked ? n.add(c.id) : n.delete(c.id); return n; })} /></td>
                    <td><span className={`flag-chip ${rv ? 'done' : ''}`}>{rv ? '✓ Reviewed' : '⚑ Review'}</span><div style={{ marginTop: 4 }}><Sev s={a.worst} /></div></td>
                    <td><b className="mono">File {c.mrn}</b><br />{c.patientName || <span className="faint">name not recorded</span>}</td>
                    <td className="num">{c.claimNo}<br /><span className="faint">{c.serviceDate}</span></td>
                    <td>{c.physician}<br /><span className="faint">{c.specialty}</span></td>
                    <td className="muted">{SECTION_LABEL[c.section ?? 'medical']}</td>
                    <td style={{ fontSize: 12, minWidth: 260 }}>{reasons.slice(0, 3).map((f) => <div key={f.id}>• {f.title}</div>)}{reasons.length > 3 && <span className="faint">+{reasons.length - 3} more</span>}</td>
                    <td className="r num" onClick={(e) => e.stopPropagation()}>{sar(a.amountAtRisk)}<br /><button className="btn small" style={{ marginTop: 4 }} onClick={() => setReview([c.id], rv ? 'open' : 'reviewed')}>{rv ? 'Reopen' : 'Done'}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <Empty title={marked.length ? 'Nothing in this filter' : 'No marked files'}>{marked.length ? 'Change the filters to see other files.' : 'Upload claims in Medical audit, Technical audit or Rejection analysis.'}</Empty>}
      </div>
    </>
  );
}
