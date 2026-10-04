import { useEffect, useMemo, useState } from 'react';
import { useData } from '../App';
import type { ClaimAudit, Severity, AuditArea } from '../lib/types';
import { AREAS, SEVERITY_ORDER, viewAudit, type AuditView } from '../lib/engine';
import UploadZone from '../UploadZone';
import { exportFindings } from '../lib/exportXlsx';
import { Codes, Empty, Icon, Score, Sev, int, sar } from '../ui';
import ClaimDetail from './ClaimDetail';

type SevFilter = Severity | 'clean';
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
          <p>Upload the claims you are about to submit. Each encounter is checked for code ↔ service and drug ↔ diagnosis mismatches, vital signs against the history, trauma details (how, when, where, work-related), missing examination, plan and severity, interactions and ICD rules. Claims with a critical or high finding are marked for review with their file number and patient name.</p>
        </div>
      </div>
      <UploadZone section="medical" compact />
      <AuditWorkspace audits={mine} view="medical" exportName="WAD_medical_audit.xlsx" />
    </>
  );
}

export function AuditWorkspace({ audits, view, exportName, emptyText }: { audits: ClaimAudit[]; view: AuditView; exportName: string; emptyText?: string }) {
  const { focus, review } = useData();
  const [q, setQ] = useState('');
  const [sevs, setSevs] = useState<Set<SevFilter>>(new Set(['critical', 'high']));
  const [area, setArea] = useState<AuditArea | ''>('');
  const [doctor, setDoctor] = useState(focus.doctor ?? '');
  const [month, setMonth] = useState('');
  const [sort, setSort] = useState<'score' | 'amount' | 'date'>('score');
  const [sel, setSel] = useState<string | null>(focus.claimId ?? null);

  useEffect(() => { if (focus.claimId) { setSel(focus.claimId); setSevs(new Set()); } }, [focus.claimId]);

  const doctors = useMemo(() => [...new Set(audits.map((a) => a.claim.physician))].sort(), [audits]);
  const months = useMemo(() => [...new Set(audits.map((a) => a.claim.serviceDate.slice(0, 7)).filter(Boolean))].sort(), [audits]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return audits
      .filter((a) => !sevs.size || sevs.has(a.worst ?? 'clean') || (sevs.has('clean') && !a.findings.some((f) => f.severity === 'critical' || f.severity === 'high')))
      .filter((a) => !area || a.findings.some((f) => f.area === area))
      .filter((a) => !doctor || a.claim.physician === doctor)
      .filter((a) => !month || a.claim.serviceDate.startsWith(month))
      .filter((a) => !t || [a.claim.claimNo, a.claim.mrn, a.claim.patientName, a.claim.physician, ...a.claim.diagnoses.map((d) => d.code), ...a.claim.lines.map((l) => l.desc)].join(' ').toLowerCase().includes(t))
      .sort((a, b) => (sort === 'score' ? rank(a) - rank(b) || b.score - a.score || b.amountAtRisk - a.amountAtRisk : sort === 'amount' ? b.amountAtRisk - a.amountAtRisk : b.claim.serviceDate.localeCompare(a.claim.serviceDate)));
  }, [audits, q, sevs, area, doctor, month, sort]);

  const selected = audits.find((a) => a.claim.id === sel) ?? null;
  const toggle = (s: SevFilter) => setSevs((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  const counts = useMemo(() => {
    const c: Record<SevFilter, number> = { critical: 0, high: 0, medium: 0, low: 0, clean: 0 };
    for (const a of audits) c[a.worst ?? 'clean']++;
    return c;
  }, [audits]);

  if (!audits.length) return <div className="card"><Empty title="No encounters in this section yet">{emptyText ?? 'Upload an HIS claim export above.'}</Empty></div>;
  const marked = audits.filter(needsReview).length;

  return (
    <>
      <div className="filters" style={{ justifyContent: 'space-between' }}>
        <span className="muted"><b className="num">{int(audits.length)}</b> encounters · <span className="flag-chip">⚑ {int(marked)} marked for review</span></span>
        <button className="btn primary" onClick={() => exportFindings(list, exportName)} disabled={!list.length}><Icon name="download" />Export {int(list.length)} claims to Excel</button>
      </div>

      <div className="filters" role="group" aria-label="Filters">
        <input id="audit-q" className="input" placeholder="Search claim, MRN, patient, ICD, service…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chipset">
          {(['critical', 'high', 'medium', 'clean'] as SevFilter[]).map((s) => (
            <button key={s} className="chip-btn" aria-pressed={sevs.has(s)} onClick={() => toggle(s)}>
              {s === 'clean' ? 'Clean' : s[0].toUpperCase() + s.slice(1)} <span className="num">{counts[s]}</span>
            </button>
          ))}
        </div>
        <select id="audit-area" className="select" value={area} onChange={(e) => setArea(e.target.value as AuditArea | '')}>
          <option value="">All audit areas</option>
          {AREAS.map((a) => <option key={a}>{a}</option>)}
        </select>
        <select id="audit-doctor" className="select" value={doctor} onChange={(e) => setDoctor(e.target.value)}>
          <option value="">All doctors</option>
          {doctors.map((d) => <option key={d}>{d}</option>)}
        </select>
        {months.length > 1 && (
          <select id="audit-month" className="select" value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">All months</option>
            {months.map((m) => <option key={m}>{m}</option>)}
          </select>
        )}
        <select id="audit-sort" className="select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
          <option value="score">Sort: risk score</option>
          <option value="amount">Sort: SAR at risk</option>
          <option value="date">Sort: newest</option>
        </select>
      </div>

      <div className="split">
        <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 140px)', overflowY: 'auto' }}>
          {list.length ? (
            <table>
              <thead><tr><th>Claim / date</th><th>Patient · doctor</th><th>Diagnoses</th><th>Risk</th><th className="r">At risk</th></tr></thead>
              <tbody>
                {list.slice(0, 400).map((a) => <Row key={a.claim.id} a={a} reviewed={review[a.claim.id]?.status === 'reviewed'} selected={a.claim.id === sel} onClick={() => setSel(a.claim.id)} />)}
              </tbody>
            </table>
          ) : <Empty title="No claims match these filters">Clear a filter or select another severity.</Empty>}
          {list.length > 400 && <p className="faint" style={{ padding: 12 }}>Showing first 400 of {int(list.length)}. Narrow the filters or export to Excel.</p>}
        </div>
        <div className="detail">{selected ? <ClaimDetail a={selected} view={view} /> : <div className="card"><Empty title="Select a claim">Pick an encounter on the left to see its findings, vitals, history and the fixes to apply.</Empty></div>}</div>
      </div>
    </>
  );
}

function Row({ a, selected, reviewed, onClick }: { a: ClaimAudit; selected: boolean; reviewed: boolean; onClick: () => void }) {
  const c = a.claim;
  return (
    <tr className="clickable" aria-selected={selected} onClick={onClick} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <td>
        {needsReview(a) && <span className={`flag-chip ${reviewed ? 'done' : ''}`} title="Marked for review">{reviewed ? '✓ Reviewed' : '⚑ Review'}</span>}
        <div className="mono" style={{ marginTop: 2 }}>File {c.mrn}</div>
        <span className="faint num">Claim {c.claimNo} · {c.serviceDate}</span>
      </td>
      <td><b>{c.patientName || `MRN ${c.mrn}`}</b> <span className="faint">{c.ageText} {c.gender}</span><br /><span className="muted">{c.physician}</span></td>
      <td><Codes codes={c.diagnoses.map((d) => d.code)} /></td>
      <td><Sev s={a.worst} /><div style={{ marginTop: 4 }}><Score score={a.score} /></div></td>
      <td className="r num">{sar(a.amountAtRisk)}<br /><span className="faint">{a.findings.length} findings</span></td>
    </tr>
  );
}
