import { useMemo, useState } from 'react';
import { useData } from '../App';
import type { Rejection } from '../lib/types';
import { adviseRejection, normService, summarizeRejections } from '../lib/analytics';
import { CAUSES, OTHER_CAUSE } from '../lib/kb/rejectionCodes';
import { exportRejections } from '../lib/exportXlsx';
import { Empty, HBars, Icon, Kpi, Legend, int, pct, sar } from '../ui';

type Metric = 'amount' | 'count';
type Dim = 'cause' | 'service' | 'category' | 'doctor';

export default function RejectionsPage() {
  const { rejections, formulary, go } = useData();
  const [payer, setPayer] = useState('');
  const [group, setGroup] = useState<'' | 'Medical' | 'Technical'>('');
  const [metric, setMetric] = useState<Metric>('amount');
  const [pick, setPick] = useState<{ dim: Dim; key: string } | null>(null);

  const payers = useMemo(() => [...new Set(rejections.map((r) => r.payer))], [rejections]);
  const base = useMemo(() => rejections.filter((r) => (!payer || r.payer === payer) && (!group || r.group === group)), [rejections, payer, group]);
  const s = useMemo(() => summarizeRejections(base), [base]);
  const shown = useMemo(() => {
    if (!pick) return base;
    return base.filter((r) =>
      pick.dim === 'cause' ? r.causeId === pick.key : pick.dim === 'service' ? normService(r) === pick.key : pick.dim === 'category' ? (r.category || '—') === pick.key : (r.doctor || 'Not linked to an HIS export') === pick.key,
    );
  }, [base, pick]);

  if (!rejections.length) {
    return (
      <>
        <div className="page-head"><div><h1>Rejection analytics</h1></div></div>
        <div className="card"><Empty title="No payer statements loaded">Import a Tawuniya / Waseel statement of account or a Bupa CLPROVSTM rejection file.<button className="btn primary" onClick={() => go('import')}>Import files</button></Empty></div>
      </>
    );
  }

  const val = (b: { amount: number; count: number }) => (metric === 'amount' ? b.amount : b.count);
  const disp = (b: { amount: number; count: number }) => (metric === 'amount' ? `${sar(b.amount)} · ${b.count}` : `${b.count} · ${sar(b.amount)}`);
  const split = (b: { amount: number; count: number; medical: number; technical: number }) =>
    metric === 'amount'
      ? [{ name: 'Medical SAR', value: b.medical, color: 'var(--s1)' }, { name: 'Technical SAR', value: b.technical, color: 'var(--s2)' }]
      : [{ name: 'Lines', value: b.count, color: b.medical >= b.technical ? 'var(--s1)' : 'var(--s2)' }];
  const causeHint = (causes: Record<string, number>) => Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(' · ');

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Payer statements · {payers.join(', ')}</span>
          <h1>Rejection analytics</h1>
          <p>What was rejected, why, by which doctor, and how to prevent each cause. Click any bar to filter the line list.</p>
        </div>
        <div className="filters">
          <select id="rej-payer" className="select" value={payer} onChange={(e) => setPayer(e.target.value)}><option value="">All payers</option>{payers.map((p) => <option key={p}>{p}</option>)}</select>
          <div className="seg" role="group" aria-label="Rejection type">
            {(['', 'Medical', 'Technical'] as const).map((g) => <button key={g || 'all'} aria-pressed={group === g} onClick={() => setGroup(g)}>{g || 'All'}</button>)}
          </div>
          <div className="seg" role="group" aria-label="Measure">
            <button aria-pressed={metric === 'amount'} onClick={() => setMetric('amount')}>SAR</button>
            <button aria-pressed={metric === 'count'} onClick={() => setMetric('count')}>Lines</button>
          </div>
          <button className="btn" onClick={() => exportRejections(shown, (r) => adviseRejection(r, formulary))}><Icon name="download" />Export</button>
        </div>
      </div>

      <section className="kpis">
        <Kpi label="Rejected" value={sar(s.amount, 2)} sub={`${int(s.lines)} service lines`} tone="crit" />
        <Kpi label="Medical rejections" value={sar(s.medical, 2)} sub={`${pct(s.amount ? s.medical / s.amount : 0)} of SAR · fixable by documentation & coding`} tone="accent" />
        <Kpi label="Technical rejections" value={sar(s.technical, 2)} sub="price list, pre-auth, follow-up, duplicates" tone="high" />
        <Kpi label="Appeals" value={`${s.disagreed} disagreed`} sub={`${s.agreed} accepted by clinic`} />
        <Kpi label="Linked to HIS claims" value={pct(s.lines ? s.linked / s.lines : 0)} sub={`${s.linked} lines matched by invoice → doctor & ICD`} />
      </section>

      <section className="grid g2">
        <ChartCard title="By cause" note="medical vs technical" legend>
          <HBars rows={s.byCause.map((b) => ({ key: b.key, label: b.label, display: disp(b), segs: split(b) }))} onPick={(k) => setPick({ dim: 'cause', key: k })} />
        </ChartCard>
        <ChartCard title="By service category" note="what kind of service is rejected" legend>
          <HBars rows={s.byCategory.map((b) => ({ key: b.key, label: b.label, display: disp(b), segs: split(b), hint: causeHint(b.causes) }))} onPick={(k) => setPick({ dim: 'category', key: k })} />
        </ChartCard>
        <ChartCard title="Most rejected services" note="top 12 · hover for causes" legend>
          <HBars rows={[...s.byService].sort((a, b) => val(b) - val(a)).slice(0, 12).map((b) => ({ key: b.key, label: b.label, display: disp(b), segs: split(b), hint: causeHint(b.causes) }))} onPick={(k) => setPick({ dim: 'service', key: k })} />
        </ChartCard>
        <ChartCard title="By doctor" note="linked through invoice number" legend>
          <HBars rows={[...s.byDoctor].sort((a, b) => val(b) - val(a)).slice(0, 14).map((b) => ({ key: b.key, label: b.label, display: disp(b), segs: split(b), hint: causeHint(b.causes) }))} onPick={(k) => setPick({ dim: 'doctor', key: k })} />
        </ChartCard>
      </section>

      <section>
        <div className="card-head"><h2>Cause playbook</h2><p>how to stop each rejection before it happens</p></div>
        <div className="grid g3">
          {s.byCause.map((b) => {
            const c = CAUSES.find((x) => x.id === b.key) ?? OTHER_CAUSE;
            const top = base.filter((r) => r.causeId === b.key);
            const svc = Object.entries(top.reduce<Record<string, number>>((m, r) => ({ ...m, [r.serviceDesc]: (m[r.serviceDesc] ?? 0) + 1 }), {})).sort((x, y) => y[1] - x[1]).slice(0, 3);
            return (
              <div className="card cause-card" key={b.key}>
                <div className="meta"><span className={`tag ${c.group === 'Medical' ? 'tag-med' : 'tag-tech'}`}>{c.group}</span><span className="code">{c.nphies}</span></div>
                <h3>{c.label}</h3>
                <p className="num">{sar(b.amount, 2)} · {b.count} lines</p>
                {svc.length > 0 && <p className="faint" style={{ fontSize: 12 }}>Top: {svc.map(([n, k]) => `${n} (${k})`).join('; ')}</p>}
                <ul className="list" style={{ fontSize: 13 }}>{c.prevent.map((p) => <li key={p}>{p}</li>)}</ul>
                <p style={{ fontSize: 12 }}><b>Appeal:</b> <span className="muted">{c.appeal}</span></p>
                <button className="btn small" onClick={() => setPick({ dim: 'cause', key: b.key })}>Show these lines</button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Rejected lines {pick ? <span className="muted">· filtered</span> : null}</h2>
          {pick && <button className="btn small" onClick={() => setPick(null)}><Icon name="close" />Clear filter</button>}
        </div>
        <div className="table-wrap" style={{ maxHeight: 640, overflowY: 'auto' }}>
          <table>
            <thead><tr><th>Service</th><th>Doctor / ICD</th><th>Payer reason</th><th>Recommendation</th><th className="r">SAR</th></tr></thead>
            <tbody>{shown.map((r) => <RejRow key={r.id} r={r} />)}</tbody>
          </table>
        </div>
      </section>
    </>
  );

  function RejRow({ r }: { r: Rejection }) {
    const advice = adviseRejection(r, formulary);
    return (
      <tr className={r.linkedClaim ? 'clickable' : undefined} onClick={() => r.linkedClaim && go('audit', { claimId: r.linkedClaim })} title={r.linkedClaim ? 'Open the audited claim' : undefined}>
        <td style={{ minWidth: 200 }}>{r.serviceDesc}<br /><span className="faint mono" style={{ fontSize: 11 }}>{r.serviceCode} · {r.category}</span></td>
        <td style={{ minWidth: 150 }}>{r.doctor || <span className="faint">not linked</span>}<br /><span className="faint mono" style={{ fontSize: 11 }}>{r.icd}</span></td>
        <td style={{ minWidth: 220 }}><span className={`tag ${r.group === 'Medical' ? 'tag-med' : 'tag-tech'}`}>{r.cause}</span><br /><span className="muted" style={{ fontSize: 12 }}>{r.reasonRaw.slice(0, 220)}</span>{r.appealStatus && <><br /><span className="faint" style={{ fontSize: 12 }}>Appeal: {r.appealStatus}</span></>}</td>
        <td style={{ minWidth: 260, fontSize: 12 }}>{advice.map((a) => <p key={a} style={{ marginBottom: 4 }}>{a}</p>)}</td>
        <td className="r num">{r.amount.toFixed(2)}</td>
      </tr>
    );
  }
}

function ChartCard({ title, note, legend, children }: { title: string; note: string; legend?: boolean; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="card-head"><h2>{title}</h2><p>{note}</p></div>
      {children}
      {legend && <div style={{ marginTop: 12 }}><Legend items={[{ name: 'Medical', color: 'var(--s1)' }, { name: 'Technical', color: 'var(--s2)' }]} /></div>}
    </div>
  );
}
