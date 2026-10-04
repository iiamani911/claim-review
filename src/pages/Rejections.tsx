import { useMemo, useState } from 'react';
import { useData } from '../App';
import type { Rejection } from '../lib/types';
import { adviseRejection, normService, summarizeRejections } from '../lib/analytics';
import { CAUSES, OTHER_CAUSE } from '../lib/kb/rejectionCodes';
import { exportRejections } from '../lib/exportXlsx';
import { Empty, HBars, Icon, Kpi, Legend, Sev, int, pct, sar } from '../ui';
import UploadZone from '../UploadZone';
import { AuditWorkspace } from './Audit';
import type { ClaimAudit, Finding } from '../lib/types';
import { ruleName } from '../lib/kb/rules';

const digits = (x: string) => x.replace(/\D/g, '').slice(-10);
/** Audit findings that sit on the rejected service line (same invoice). */
function rootCause(r: Rejection, audits: Map<string, ClaimAudit>): Finding[] {
  const a = r.linkedClaim ? audits.get(r.linkedClaim) : undefined;
  if (!a) return [];
  const onInv = a.claim.lines.filter((l) => digits(l.invoice) === digits(r.invoice));
  // One pharmacy invoice holds several drugs: narrow to the line whose name matches the rejected service.
  const word = (x: string) => x.toLowerCase().match(/[a-z]{3,}/)?.[0] ?? '';
  const same = onInv.filter((l) => word(l.desc) === word(r.serviceDesc) || l.code === r.serviceCode);
  const lines = new Set((same.length ? same : onInv).map((l) => l.id));
  const onLine = a.findings.filter((f) => f.lineIds?.some((id) => lines.has(id)));
  return onLine.length ? onLine : a.findings.filter((f) => !f.lineIds?.length && (f.severity === 'critical' || f.severity === 'high'));
}

type Metric = 'amount' | 'count';
type Dim = 'cause' | 'service' | 'category' | 'doctor';

export default function RejectionsPage() {
  const { rejections, formulary, go, audits, focus } = useData();
  const rejectedClaims = useMemo(() => audits.filter((a) => a.claim.section === 'rejection'), [audits]);
  const [tab, setTab] = useState<'statements' | 'claims'>(focus.claimId?.startsWith('rejection:') ? 'claims' : 'statements');
  const auditById = useMemo(() => new Map(audits.map((a) => [a.claim.id, a])), [audits]);
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

  const head = (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Already rejected · {payers.join(', ') || 'no statements yet'}</span>
          <h1>Rejection analysis</h1>
          <p>Files uploaded here are treated as rejected. Payer statements are analysed by cause, service, category and doctor. Rejected claim files get the same full medical audit (temperature vs history, code mismatches, trauma details, labs and radiology vs diagnosis…) so you can see the root cause and fix it before re-submission or appeal.</p>
        </div>
      </div>
      <UploadZone section="rejection" compact />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'statements'} onClick={() => setTab('statements')}>Statement analysis ({int(rejections.length)} lines)</button>
        <button role="tab" aria-selected={tab === 'claims'} onClick={() => setTab('claims')}>Rejected claims – full medical audit ({int(rejectedClaims.length)})</button>
      </div>
    </>
  );
  if (tab === 'claims') {
    return (
      <>
        {head}
        <AuditWorkspace audits={rejectedClaims} view="all" exportName="WAD_rejected_claims_audit.xlsx" emptyText="Upload the HIS export of the rejected claims above. Each one gets the full medical and technical audit; statement lines link to them by invoice number." />
      </>
    );
  }
  if (!rejections.length) {
    return (
      <>
        {head}
        <div className="card"><Empty title="No payer statements loaded">Upload a Tawuniya / Waseel statement of account or a Bupa CLPROVSTM rejection file above.</Empty></div>
      </>
    );
  }
  const rootCounts = new Map<string, { n: number; sar: number }>();
  let explained = 0;
  for (const r of base) {
    const rc = rootCause(r, auditById).filter((f) => f.severity !== 'low');
    if (rc.length) explained++;
    for (const id of new Set(rc.map((f) => f.ruleId))) {
      const x = rootCounts.get(id) ?? { n: 0, sar: 0 };
      x.n++;
      x.sar += r.amount;
      rootCounts.set(id, x);
    }
  }
  const linkedCount = base.filter((r) => r.linkedClaim).length;

  const val = (b: { amount: number; count: number }) => (metric === 'amount' ? b.amount : b.count);
  const disp = (b: { amount: number; count: number }) => (metric === 'amount' ? `${sar(b.amount)} · ${b.count}` : `${b.count} · ${sar(b.amount)}`);
  const split = (b: { amount: number; count: number; medical: number; technical: number }) =>
    metric === 'amount'
      ? [{ name: 'Medical SAR', value: b.medical, color: 'var(--s1)' }, { name: 'Technical SAR', value: b.technical, color: 'var(--s2)' }]
      : [{ name: 'Lines', value: b.count, color: b.medical >= b.technical ? 'var(--s1)' : 'var(--s2)' }];
  const causeHint = (causes: Record<string, number>) => Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(' · ');

  return (
    <>
      {head}
      <div className="filters" style={{ justifyContent: 'space-between' }}>
        <span className="muted">Click any bar to filter the line list.</span>
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

      <section className="card">
        <div className="card-head"><h2>Root cause found by the audit</h2><p>{int(explained)} of {int(linkedCount)} linked lines explained by an audit finding on the same service</p></div>
        {rootCounts.size ? (
          <HBars rows={[...rootCounts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12).map(([id, x]) => ({ key: id, label: `${id} · ${ruleName(id)}`, display: `${x.n} lines · ${sar(x.sar)}`, segs: [{ name: 'Lines', value: x.n, color: 'var(--accent)' }] }))} />
        ) : <p className="muted">Upload the HIS export for these rejected claims (above) so each rejected line can be linked to its encounter and audited.</p>}
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
            <thead><tr><th>Service</th><th>File · doctor / ICD</th><th>Payer reason</th><th>Audit root cause</th><th>Recommendation</th><th className="r">SAR</th></tr></thead>
            <tbody>{shown.map((r) => <RejRow key={r.id} r={r} />)}</tbody>
          </table>
        </div>
      </section>
    </>
  );

  function RejRow({ r }: { r: Rejection }) {
    const advice = adviseRejection(r, formulary);
    const linked = r.linkedClaim ? auditById.get(r.linkedClaim) : undefined;
    const rc = rootCause(r, auditById);
    return (
      <tr className={r.linkedClaim ? 'clickable' : undefined} onClick={() => { if (!r.linkedClaim) return; if (r.linkedClaim.startsWith('rejection:')) { setTab('claims'); go('rejections', { claimId: r.linkedClaim }); } else go(r.linkedClaim.startsWith('technical:') ? 'technical' : 'audit', { claimId: r.linkedClaim }); }} title={r.linkedClaim ? 'Open the audited claim' : undefined}>
        <td style={{ minWidth: 200 }}>{r.serviceDesc}<br /><span className="faint mono" style={{ fontSize: 11 }}>{r.serviceCode} · {r.category}</span></td>
        <td style={{ minWidth: 150 }}>{linked && <><b className="mono">File {linked.claim.mrn}</b> · {linked.claim.patientName}<br /></>}{r.doctor || <span className="faint">not linked</span>}<br /><span className="faint mono" style={{ fontSize: 11 }}>{r.icd}</span></td>
        <td style={{ minWidth: 220 }}><span className={`tag ${r.group === 'Medical' ? 'tag-med' : 'tag-tech'}`}>{r.cause}</span><br /><span className="muted" style={{ fontSize: 12 }}>{r.reasonRaw.slice(0, 220)}</span>{r.appealStatus && <><br /><span className="faint" style={{ fontSize: 12 }}>Appeal: {r.appealStatus}</span></>}</td>
        <td style={{ minWidth: 220, fontSize: 12 }}>{rc.length ? rc.slice(0, 3).map((f) => <div key={f.id} style={{ marginBottom: 4 }}><Sev s={f.severity} /> {f.title}</div>) : <span className="faint">{linked ? 'No finding on this line' : 'Upload the HIS export to audit'}</span>}</td>
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
