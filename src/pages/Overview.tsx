import { useMemo } from 'react';
import { useData } from '../App';
import { actionPlan, summarizeAudits, summarizeRejections, doctorRows } from '../lib/analytics';
import { HBars, Kpi, Legend, Sev, int, pct, sar, sevColor } from '../ui';

export default function Overview() {
  const { audits, rejections, go } = useData();
  const s = useMemo(() => summarizeAudits(audits), [audits]);
  const r = useMemo(() => summarizeRejections(rejections), [rejections]);
  const plan = useMemo(() => actionPlan(audits, rejections), [audits, rejections]);
  const docs = useMemo(() => doctorRows(audits, rejections).slice(0, 6), [audits, rejections]);
  const months = [...new Set(audits.map((a) => a.claim.serviceDate.slice(0, 7)).filter(Boolean))].sort();

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">WAD Clinic · Tawuniya / Bupa / all payers {months.length ? `· ${months[0]}${months.length > 1 ? ` → ${months[months.length - 1]}` : ''}` : ''}</span>
          <h1>Claims at a glance</h1>
          <p>Pre-submission medical audit of every encounter, and what payers already rejected. Fix the critical and high items before the batch goes to NPHIES.</p>
        </div>
        <div className="filters">
          <button className="btn primary" onClick={() => go('audit')}>Review flagged claims</button>
          <button className="btn" onClick={() => go('rejections')}>Rejection analytics</button>
        </div>
      </div>

      <section className="kpis" aria-label="Key figures">
        <Kpi label="Encounters audited" value={int(s.encounters)} sub={`${sar(s.billed)} billed (net)`} tone="accent" />
        <Kpi label="Clean-claim rate" value={pct(s.cleanRate)} sub={`${int(s.clean)} with no critical/high finding`} tone="good" />
        <Kpi label="Amount at risk" value={sar(s.amountAtRisk)} sub="lines with critical/high findings" tone="crit" />
        <Kpi label="Critical findings" value={int(s.bySeverity.critical)} sub={`${int(s.bySeverity.high)} high · ${int(s.bySeverity.medium)} medium`} tone="high" />
        <Kpi label="Already rejected" value={sar(r.amount)} sub={`${int(r.lines)} lines · ${pct(r.amount ? r.medical / r.amount : 0)} medical`} />
      </section>

      <section className="grid g2">
        <div className="card">
          <div className="card-head"><h2>Findings by audit area</h2><p>count of findings, by severity</p></div>
          <HBars
            rows={s.byArea.filter((a) => a.count).sort((a, b) => b.critical * 100 + b.high - (a.critical * 100 + a.high)).map((a) => ({
              key: a.area, label: a.area, display: `${int(a.count)} · ${int(a.encounters)} enc.`,
              segs: [
                { name: 'Critical', value: a.critical, color: sevColor('critical') },
                { name: 'High', value: a.high, color: sevColor('high') },
                { name: 'Medium/low', value: a.count - a.critical - a.high, color: 'var(--line)' },
              ],
            }))}
            onPick={() => go('audit')}
          />
          <div style={{ marginTop: 12 }}><Legend items={[{ name: 'Critical', color: sevColor('critical') }, { name: 'High', color: sevColor('high') }, { name: 'Medium / low', color: 'var(--line)' }]} /></div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Rejections by cause</h2><p>SAR rejected</p></div>
          {r.lines ? (
            <>
              <HBars rows={r.byCause.map((b) => ({ key: b.key, label: b.label, display: `${sar(b.amount)} · ${b.count}`, segs: [{ name: 'SAR', value: b.amount, color: b.medical > 0 ? 'var(--s1)' : 'var(--s2)' }] }))} onPick={() => go('rejections')} />
              <div style={{ marginTop: 12 }}><Legend items={[{ name: 'Medical', color: 'var(--s1)' }, { name: 'Technical', color: 'var(--s2)' }]} /></div>
            </>
          ) : <p className="muted">Import a payer statement to see rejection causes.</p>}
        </div>
      </section>

      <section className="grid g2">
        <div className="card">
          <div className="card-head"><h2>Prevention plan</h2><p>ranked by SAR impact</p></div>
          {plan.map((a, i) => (
            <div className="action" key={a.title + a.kind}>
              <span className="rank">{i + 1}</span>
              <div>
                <b>{a.title}</b> <span className={`tag ${a.kind === 'rejection' ? 'tag-tech' : 'tag-med'}`}>{a.kind === 'rejection' ? 'payer rejected' : 'audit finding'}</span>
                <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>{a.detail}</p>
              </div>
              <span className="num" style={{ textAlign: 'right' }}>{sar(a.impact)}<br /><span className="faint">{int(a.count)}×</span></span>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="card-head"><h2>Doctors needing feedback</h2><button className="btn small" onClick={() => go('doctors')}>All doctors</button></div>
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead><tr><th>Doctor</th><th className="r">Enc.</th><th className="r">Clean</th><th className="r">At risk</th><th className="r">Rejected</th></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.doctor} className="clickable" onClick={() => go('doctors', { doctor: d.doctor })}>
                    <td><b>{d.doctor}</b><br /><span className="faint">{d.specialty}</span></td>
                    <td className="r num">{d.encounters}</td>
                    <td className="r num">{pct(d.cleanRate)}</td>
                    <td className="r num">{sar(d.amountAtRisk)}</td>
                    <td className="r num">{sar(d.rejectedAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Most frequent findings</h2><p>top 10 rules</p></div>
        <div className="table-wrap" style={{ border: 0 }}>
          <table>
            <thead><tr><th>Rule</th><th>Area</th><th>Worst</th><th className="r">Findings</th><th className="r">SAR at risk</th></tr></thead>
            <tbody>
              {s.byRule.slice(0, 10).map((x) => (
                <tr key={x.ruleId}>
                  <td><span className="code">{x.ruleId}</span> {x.name}</td>
                  <td className="muted">{x.area}</td>
                  <td><Sev s={x.severity} /></td>
                  <td className="r num">{int(x.count)}</td>
                  <td className="r num">{sar(x.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
