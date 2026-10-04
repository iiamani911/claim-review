import { useMemo, useState } from 'react';
import { useData } from '../App';
import { doctorRows, type DoctorRow } from '../lib/analytics';
import { AREAS } from '../lib/engine';
import { RULES } from '../lib/kb/rules';
import { causeById } from '../lib/kb/rejectionCodes';
import { CopyButton, HBars, Kpi, int, pct, sar } from '../ui';

export default function DoctorsPage() {
  const { audits, rejections, focus, go } = useData();
  const rows = useMemo(() => doctorRows(audits, rejections), [audits, rejections]);
  const [sel, setSel] = useState<string>(focus.doctor ?? rows[0]?.doctor ?? '');
  const d = rows.find((r) => r.doctor === sel) ?? rows[0];

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Per-physician quality</span>
          <h1>Doctors</h1>
          <p>Audit findings and payer rejections per doctor, with a feedback memo you can send. Rejections are linked to doctors through the invoice number in the HIS export.</p>
        </div>
      </div>
      <div className="split">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Doctor</th><th className="r">Enc.</th><th className="r">Clean</th><th className="r">Critical</th><th className="r">At risk</th><th className="r">Rejected</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.doctor} className="clickable" aria-selected={r.doctor === d?.doctor} onClick={() => setSel(r.doctor)}>
                  <td><b>{r.doctor}</b><br /><span className="faint">{r.specialty || '—'}</span></td>
                  <td className="r num">{r.encounters}</td>
                  <td className="r num">{r.encounters ? pct(r.cleanRate) : '—'}</td>
                  <td className="r num">{r.critical}</td>
                  <td className="r num">{sar(r.amountAtRisk)}</td>
                  <td className="r num">{sar(r.rejectedAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="detail">{d && <Profile d={d} onAudit={() => go('audit', { doctor: d.doctor })} />}</div>
      </div>
    </>
  );

  function Profile({ d, onAudit }: { d: DoctorRow; onAudit: () => void }) {
    const rej = rejections.filter((r) => r.doctor === d.doctor);
    const causes = Object.entries(rej.reduce<Record<string, number>>((m, r) => ({ ...m, [r.causeId]: (m[r.causeId] ?? 0) + r.amount }), {})).sort((a, b) => b[1] - a[1]);
    const memo = [
      `Dear ${d.doctor},`,
      `Claim quality summary (${d.encounters} encounters audited${rej.length ? `, ${rej.length} rejected lines – ${sar(d.rejectedAmount, 2)}` : ''}).`,
      `Clean-claim rate: ${pct(d.cleanRate)}. Amount at risk before submission: ${sar(d.amountAtRisk, 2)}.`,
      '',
      'Main issues and how to avoid them:',
      ...d.topRules.map((t, i) => `${i + 1}. ${t.name} (${t.count}×) – ${RULES.find((x) => x.id === t.ruleId)?.what ?? ''}`),
      ...causes.slice(0, 3).map(([id, amt]) => `• Payer rejection – ${causeById(id).label} (${sar(amt, 2)}): ${causeById(id).prevent[0]}`),
      '',
      'Please document duration, examination findings, severity and a management plan on every visit, and code the condition that justifies each test and medication.',
      'Insurance office, WAD Clinic.',
    ].join('\n');
    return (
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card-head" style={{ marginBottom: 0 }}>
          <div><span className="eyebrow">{d.specialty}</span><h2>{d.doctor}</h2></div>
          <div className="filters"><button className="btn small" onClick={onAudit}>Open claims</button><CopyButton text={memo} label="Copy feedback memo" /></div>
        </div>
        <div className="kpis">
          <Kpi label="Clean-claim rate" value={d.encounters ? pct(d.cleanRate) : '—'} tone="good" />
          <Kpi label="Findings / encounter" value={d.encounters ? (d.findings / d.encounters).toFixed(1) : '—'} />
          <Kpi label="Rejected (medical)" value={sar(d.medicalRejected)} sub={`of ${sar(d.rejectedAmount)}`} tone="crit" />
        </div>
        <div>
          <h3 style={{ marginBottom: 8 }}>Findings by area</h3>
          <HBars rows={AREAS.filter((a) => d.byArea[a]).map((a) => ({ key: a, label: a, display: int(d.byArea[a]), segs: [{ name: 'Findings', value: d.byArea[a], color: 'var(--accent)' }] }))} />
        </div>
        <div>
          <h3 style={{ marginBottom: 8 }}>Top issues</h3>
          <ul className="list" style={{ fontSize: 13 }}>{d.topRules.map((t) => <li key={t.ruleId}><span className="code">{t.ruleId}</span> {t.name} – <span className="num">{t.count}×</span></li>)}</ul>
        </div>
        {rej.length > 0 && (
          <div>
            <h3 style={{ marginBottom: 8 }}>Rejected services</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Service</th><th>Cause</th><th className="r">SAR</th></tr></thead>
                <tbody>{rej.map((r) => <tr key={r.id}><td>{r.serviceDesc}<br /><span className="faint mono" style={{ fontSize: 11 }}>{r.icd}</span></td><td><span className={`tag ${r.group === 'Medical' ? 'tag-med' : 'tag-tech'}`}>{r.cause}</span></td><td className="r num">{r.amount.toFixed(2)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        )}
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Preview feedback memo</summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-data)', fontSize: 12, background: 'var(--surface-2)', padding: 12, borderRadius: 8 }}>{memo}</pre>
        </details>
      </div>
    );
  }
}
