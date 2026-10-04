import { useMemo, useState } from 'react';
import { useData } from '../App';
import { doctorRows, inView, isFlagged, type DoctorRow } from '../lib/analytics';
import { Empty, Kpi, Sev, int, sar } from '../ui';

export default function DoctorsPage() {
  const { audits, ds, payer, focus, go } = useData();
  const [period, setPeriod] = useState('');
  const a = useMemo(() => audits.filter((x) => inView(x.claim.payer, payer) && (!period || x.claim.period === period)), [audits, payer, period]);
  const r = useMemo(() => ds.rejections.filter((x) => inView(x.payer, payer) && (!period || x.period === period)), [ds.rejections, payer, period]);
  const periods = useMemo(() => [...new Set([...audits.map((x) => x.claim.period), ...ds.rejections.map((x) => x.period)].filter(Boolean))].sort(), [audits, ds.rejections]);
  const rows = useMemo(() => doctorRows(a, r), [a, r]);
  const [sel, setSel] = useState(focus.doctor ?? '');
  const d = rows.find((x) => x.doctor === sel) ?? rows[0];

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Per physician · {payer === 'Both' ? 'Bupa + Tawuniya' : payer}</span>
          <h1>Doctors</h1>
          <p>Claim volume, actual rejections (from insurer statements, linked by invoice) and pre-submission audit findings (predicted risk) – shown side by side but never added together.</p>
        </div>
        <select id="doc-period" className="select" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Month"><option value="">All months</option>{periods.map((p) => <option key={p}>{p}</option>)}</select>
      </div>
      {!rows.length ? <div className="card"><Empty title="No data in this view" /></div> : (
        <div className="split">
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th rowSpan={2}>Doctor</th><th colSpan={2} className="r">Volume</th><th colSpan={2} className="r">Actual rejections</th><th colSpan={2} className="r">Audit (predicted)</th></tr>
                <tr><th className="r">Enc.</th><th className="r">Net</th><th className="r">SAR</th><th className="r">Lines</th><th className="r">Flagged</th><th className="r">At risk</th></tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.doctor} className="clickable" aria-selected={x.doctor === d?.doctor} onClick={() => setSel(x.doctor)}>
                    <td><b>{x.doctor}</b><br /><span className="faint">{x.specialty || '—'}</span></td>
                    <td className="r num">{x.encounters}</td>
                    <td className="r num">{x.submittedNet.toFixed(0)}</td>
                    <td className="r num">{x.rejectedAmount.toFixed(2)}</td>
                    <td className="r num">{x.rejectedLines}</td>
                    <td className="r num">{x.flagged}</td>
                    <td className="r num">{x.amountAtRisk.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="detail">{d && <Profile d={d} />}</div>
        </div>
      )}
    </>
  );

  function Profile({ d }: { d: DoctorRow }) {
    const enc = a.filter((x) => x.claim.physician === d.doctor).sort((x, y) => Number(isFlagged(y)) - Number(isFlagged(x)) || y.amountAtRisk - x.amountAtRisk);
    const rej = r.filter((x) => (x.doctor || 'Not linked to a claim') === d.doctor);
    return (
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div><span className="eyebrow">{d.specialty}</span><h2>{d.doctor}</h2></div>
        <div className="kpis">
          <Kpi label="Encounters" value={int(d.encounters)} sub={`${int(d.lines)} lines · ${sar(d.submittedNet)}`} />
          <Kpi label="Actually rejected" value={sar(d.rejectedAmount, 2)} sub={`${d.rejectedLines} lines · medical ${sar(d.medicalRejected, 2)}`} tone="crit" />
          <Kpi label="Audit: flagged" value={int(d.flagged)} sub={`${sar(d.amountAtRisk)} predicted at risk`} tone="high" />
        </div>
        {d.topReasons.length > 0 && <div><h3>Top actual rejection reasons</h3><ul className="list" style={{ fontSize: 13 }}>{d.topReasons.map(([k, v]) => <li key={k}>{k} – {v} lines</li>)}</ul></div>}
        {d.topRules.length > 0 && <div><h3>Top audit findings</h3><ul className="list" style={{ fontSize: 13 }}>{d.topRules.map((t) => <li key={t.ruleId}><span className="code">{t.ruleId}</span> {t.name} – {t.count}×</li>)}</ul></div>}
        {enc.length > 0 && (
          <div>
            <h3 style={{ marginBottom: 6 }}>Encounters ({enc.length})</h3>
            <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table><tbody>{enc.slice(0, 200).map((x) => (
                <tr key={x.claim.id} className="clickable" onClick={() => go('audit', { claimId: x.claim.id })}>
                  <td className="num">{x.claim.serviceDate}</td><td><span className="mono">MRN {x.claim.mrn}</span> {x.claim.patientName}</td><td><span className="tag">{x.claim.payer}</span></td><td><Sev s={x.worst} /></td><td className="r num">{x.amountAtRisk.toFixed(0)}</td>
                </tr>))}</tbody></table>
            </div>
          </div>
        )}
        {rej.length > 0 && (
          <div>
            <h3 style={{ marginBottom: 6 }}>Rejected lines ({rej.length})</h3>
            <div className="table-wrap" style={{ maxHeight: 280, overflowY: 'auto' }}>
              <table><tbody>{rej.map((x) => <tr key={x.id}><td className="num">{x.period}</td><td>{x.serviceDesc}</td><td><span className={`tag ${x.group === 'Medical' ? 'tag-med' : 'tag-tech'}`}>{x.cause}</span></td><td className="r num">{x.amount.toFixed(2)}</td></tr>)}</tbody></table>
            </div>
          </div>
        )}
      </div>
    );
  }
}
