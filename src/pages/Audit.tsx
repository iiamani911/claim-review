import { useEffect, useMemo, useState } from 'react';
import { useData } from '../App';
import type { ClaimAudit, Severity, AuditArea } from '../lib/types';
import { AREAS, SEVERITY_ORDER } from '../lib/engine';
import { exportFindings } from '../lib/exportXlsx';
import { Codes, Empty, Icon, Score, Sev, int, sar } from '../ui';
import ClaimDetail from './ClaimDetail';

type SevFilter = Severity | 'clean';
const rank = (a: ClaimAudit) => (a.worst ? SEVERITY_ORDER.indexOf(a.worst) : 9);

export default function AuditPage() {
  const { audits, focus } = useData();
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

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Pre-submission review</span>
          <h1>Medical audit</h1>
          <p>Each encounter is checked against ICD rules, the CHI drug formulary, vital signs, documentation and safety rules. Open a claim to see every finding with the fix and a note the doctor can add.</p>
        </div>
        <button className="btn primary" onClick={() => exportFindings(list)} disabled={!list.length}><Icon name="download" />Export {int(list.length)} claims to Excel</button>
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
                {list.slice(0, 400).map((a) => <Row key={a.claim.id} a={a} selected={a.claim.id === sel} onClick={() => setSel(a.claim.id)} />)}
              </tbody>
            </table>
          ) : <Empty title="No claims match these filters">Clear a filter or select another severity.</Empty>}
          {list.length > 400 && <p className="faint" style={{ padding: 12 }}>Showing first 400 of {int(list.length)}. Narrow the filters or export to Excel.</p>}
        </div>
        <div className="detail">{selected ? <ClaimDetail a={selected} /> : <div className="card"><Empty title="Select a claim">Pick an encounter on the left to see its findings, vitals, history and the fixes to apply.</Empty></div>}</div>
      </div>
    </>
  );
}

function Row({ a, selected, onClick }: { a: ClaimAudit; selected: boolean; onClick: () => void }) {
  const c = a.claim;
  return (
    <tr className="clickable" aria-selected={selected} onClick={onClick} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <td><span className="mono">{c.claimNo}</span><br /><span className="faint num">{c.serviceDate}</span></td>
      <td><b>{c.patientName || `MRN ${c.mrn}`}</b> <span className="faint">{c.ageText} {c.gender}</span><br /><span className="muted">{c.physician}</span></td>
      <td><Codes codes={c.diagnoses.map((d) => d.code)} /></td>
      <td><Sev s={a.worst} /><div style={{ marginTop: 4 }}><Score score={a.score} /></div></td>
      <td className="r num">{sar(a.amountAtRisk)}<br /><span className="faint">{a.findings.length} findings</span></td>
    </tr>
  );
}
