import { useMemo, useState } from 'react';
import { useData } from '../App';
import type { Payer, Rejection } from '../lib/types';
import { PAYERS } from '../lib/types';
import { adviseRejection, byAmount, byCount, bucketize, denominators, inView, normService, round2, summarizeRejections, sum, type Bucket } from '../lib/analytics';
import { CAUSES, NEEDS_REVIEW, causeById } from '../lib/rejections';
import { evidenceText, significant, MIN_REJECTED, MIN_SUBMITTED, MIN_RATE } from '../lib/history';
import { exportRejections } from '../lib/exportXlsx';
import { Empty, HBars, Icon, Kpi, Legend, Sev, int, pct, sar } from '../ui';

type Tab = 'summary' | 'trends' | 'services' | 'doctors' | 'lines' | 'patterns';
const GROUP_COLOR = { Medical: 'var(--s1)', 'Technical/Administrative': 'var(--s2)', 'Needs review': 'var(--low)' } as const;
const LINK_LABEL = { linked: 'Linked to claim line', probable: 'Probable line match', 'invoice-only': 'Invoice matched, line uncertain', unmatched: 'Not matched to a claim' };

export default function RejectionsPage() {
  const { ds, payer, focus, formulary, go, audits } = useData();
  const [tab, setTab] = useState<Tab>((focus.tab as Tab) || 'summary');
  const [period, setPeriod] = useState(focus.period ?? '');
  const [importId, setImportId] = useState(focus.importId ?? '');
  const scoped = useMemo(() => ds.rejections.filter((r) => inView(r.payer, payer) && (!importId || r.importId === importId)), [ds.rejections, payer, importId]);
  const periods = useMemo(() => [...new Set(scoped.map((r) => r.period).filter(Boolean))].sort(), [scoped]);
  const rs = useMemo(() => scoped.filter((r) => !period || r.period === period), [scoped, period]);
  const files = useMemo(() => [...new Map(ds.rejections.filter((r) => inView(r.payer, payer)).map((r) => [r.importId, r.source])).entries()], [ds.rejections, payer]);
  const auditById = useMemo(() => new Map(audits.map((a) => [a.claim.id, a])), [audits]);

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Actual payer rejections · {payer === 'Both' ? 'Bupa + Tawuniya' : payer}</span>
          <h1>Rejection analysis</h1>
          <p>What Bupa and Tawuniya actually rejected, analysed separately from the pre-submission audit. Amounts are rejected net amounts; VAT is shown only where the insurer file provides it per line.</p>
        </div>
        <div className="filters">
          <select id="rej-period" className="select" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
            <option value="">All months ({periods.length})</option>
            {periods.map((p) => <option key={p}>{p}</option>)}
          </select>
          {files.length > 1 && (
            <select id="rej-file" className="select" value={importId} onChange={(e) => setImportId(e.target.value)} aria-label="File">
              <option value="">All rejection files</option>
              {files.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
          <button className="btn" onClick={() => exportRejections(rs, (r) => adviseRejection(r, formulary))} disabled={!rs.length}><Icon name="download" />Export</button>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {([['summary', 'Summary'], ['trends', 'Monthly trends'], ['services', 'Services & medications'], ['doctors', 'Doctors & specialties'], ['lines', `Rejected lines (${int(rs.length)})`], ['patterns', 'Historical patterns']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {!scoped.length && tab !== 'patterns' ? (
        <div className="card"><Empty title={`No rejection files for ${payer === 'Both' ? 'Bupa or Tawuniya' : payer}`}>Upload the insurer’s rejection statement under All files.<button className="btn primary" onClick={() => go('files', { tab: 'upload' })}>Upload files</button></Empty></div>
      ) : tab === 'summary' ? <Summary rs={rs} period={period} />
        : tab === 'trends' ? <Trends rs={scoped} />
        : tab === 'services' ? <Services rs={rs} />
        : tab === 'doctors' ? <Doctors rs={rs} />
        : tab === 'lines' ? <Lines rs={rs} auditById={auditById} />
        : <Patterns />}
    </>
  );
}

function Summary({ rs, period }: { rs: Rejection[]; period: string }) {
  const { ds, payer } = useData();
  const s = summarizeRejections(rs);
  const den = denominators(ds.claims);
  const months = [...new Set(rs.map((r) => `${r.payer}|${r.period}`))];
  const covered = months.filter((k) => den.has(k));
  const denNet = sum(covered.map((k) => den.get(k)!.net));
  const denLines = sum(covered.map((k) => den.get(k)!.lines));
  const rsCovered = rs.filter((r) => den.has(`${r.payer}|${r.period}`));
  const adj = ds.adjustments.filter((a) => inView(a.payer, payer) && (!period || a.period === period));
  const sub = bucketize(rs, (r) => `${r.group}|${r.subcategory}`, (r) => r.subcategory).sort(byAmount);
  const reasons = bucketize(rs, (r) => r.reasonRaw.toLowerCase().slice(0, 90), (r) => r.reasonRaw, (r) => [r.nphiesCode, r.reasonCode].filter(Boolean).join(' / ')).sort(byCount).slice(0, 12);
  return (
    <>
      <section className="kpis">
        <Kpi label="Rejected amount (net)" value={sar(s.amount, 2)} sub={`${int(s.lines)} rejected lines`} tone="crit" />
        <Kpi label="Rejected VAT" value={s.vatLines ? sar(s.vat, 2) : 'Not provided'} sub={s.vatLines ? `from ${int(s.vatLines)} of ${int(s.lines)} lines with line-level VAT` : 'insurer file has no VAT per line'} />
        <Kpi label="Medical" value={sar(s.medical, 2)} sub={pct(s.amount ? s.medical / s.amount : 0) + ' of rejected amount'} tone="accent" />
        <Kpi label="Technical / administrative" value={sar(s.technical, 2)} sub={pct(s.amount ? s.technical / s.amount : 0) + ' of rejected amount'} tone="high" />
        <Kpi label="Needs review" value={sar(s.review, 2)} sub="reason missing or not recognised" />
        <Kpi label={covered.length ? `Rejection rate · ${covered.map((k) => k.replace('|', ' ')).join(', ')}` : 'Rejection rate'} value={covered.length ? pct(denNet ? sum(rsCovered.map((r) => r.amount)) / denNet : 0) : '—'} sub={covered.length ? `by amount (rejected ÷ submitted net) for the ${covered.length} of ${months.length} insurer-month(s) that have a matching claims file · by lines: ${pct(denLines ? rsCovered.length / denLines : 0)}` : 'Not shown: no claims file for the same insurer and month'} />
      </section>
      {(adj.length > 0 || s.priceExcess > 0) && (
        <p className="muted" style={{ fontSize: 13 }}>Excluded from rejected amounts: {Object.entries(adj.reduce<Record<string, { n: number; amt: number }>>((m, a) => { const k = a.label.split(' – ')[0]; m[k] = { n: (m[k]?.n ?? 0) + 1, amt: (m[k]?.amt ?? 0) + a.amount }; return m; }, {})).map(([k, v]) => `${k}: ${v.n} line(s), ${sar(v.amt, 2)}`).join('; ')}{s.priceExcess ? `; price excess on rejected lines ${sar(s.priceExcess, 2)}` : ''}. Patient share, deductibles, discounts and price differences are not counted as rejections.</p>
      )}
      <section className="grid g2">
        <div className="card">
          <div className="card-head"><h2>By type and subcategory</h2><p>rejected amount</p></div>
          <HBars rows={sub.map((b) => ({ key: b.key, label: `${b.key.split('|')[0] === 'Medical' ? 'Medical' : b.key.split('|')[0] === 'Needs review' ? 'Needs review' : 'Tech/Admin'} · ${b.label}`, display: `${sar(b.amount)} · ${b.count}`, segs: [{ name: 'SAR', value: b.amount, color: GROUP_COLOR[b.key.split('|')[0] as keyof typeof GROUP_COLOR] }] }))} />
          <div style={{ marginTop: 12 }}><Legend items={Object.entries(GROUP_COLOR).map(([name, color]) => ({ name, color }))} /></div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Most frequent reasons & codes</h2><p>original insurer wording</p></div>
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead><tr><th>Reason (as sent by insurer)</th><th>Code</th><th className="r">Lines</th><th className="r">SAR</th></tr></thead>
              <tbody>{reasons.map((b) => <tr key={b.key}><td style={{ fontSize: 12 }}>{b.label.slice(0, 160)}</td><td className="mono" style={{ fontSize: 12 }}>{b.extra || '—'}</td><td className="r num">{b.count}</td><td className="r num">{b.amount.toFixed(2)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Cause playbook</h2><p>prevention steps for the causes in this view</p></div>
        <div className="grid g3">
          {bucketize(rs, (r) => r.causeId).sort(byAmount).map((b) => {
            const c = causeById(b.key);
            return (
              <div key={b.key} className="cause-card">
                <div className="meta"><span className={`tag ${c.group === 'Medical' ? 'tag-med' : 'tag-tech'}`}>{c.group}</span><span className="faint" style={{ fontSize: 12 }}>{c.subcategory}</span></div>
                <h3>{c.label}</h3>
                <p className="num">{sar(b.amount, 2)} · {b.count} lines</p>
                <ul className="list" style={{ fontSize: 13 }}>{c.prevent.map((p) => <li key={p}>{p}</li>)}</ul>
                <p style={{ fontSize: 12 }}><b>Appeal:</b> <span className="muted">{c.appeal}</span></p>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function Trends({ rs }: { rs: Rejection[] }) {
  const { ds, payer } = useData();
  const den = denominators(ds.claims);
  const months = [...new Set(rs.map((r) => r.period).filter(Boolean))].sort();
  const payers: Payer[] = payer === 'Both' ? PAYERS : [payer];
  const cell = (p: Payer | 'Both', m: string) => {
    const x = rs.filter((r) => r.period === m && (p === 'Both' || r.payer === p));
    const s = summarizeRejections(x);
    const d = p === 'Both' ? (() => { const a = PAYERS.map((q) => den.get(`${q}|${m}`)); return a.every(Boolean) ? { net: sum(a.map((y) => y!.net)), lines: sum(a.map((y) => y!.lines)) } : null; })() : den.get(`${p}|${m}`) ?? null;
    return { s, d };
  };
  const rows = [...payers, ...(payer === 'Both' ? (['Both'] as const) : [])];
  if (!months.length) return <div className="card"><Empty title="No dated rejection lines" /></div>;
  return (
    <>
      {rows.map((p) => (
        <section className="card" key={p}>
          <div className="card-head"><h2>{p === 'Both' ? 'Both insurers combined' : p}</h2><p>{p === 'Both' ? 'sum of the Bupa and Tawuniya tables above' : 'change vs previous month in brackets'}</p></div>
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead><tr><th>Month</th><th className="r">Rejected SAR</th><th className="r">Lines</th><th className="r">Medical</th><th className="r">Tech/Admin</th><th className="r">Needs review</th><th className="r">VAT (line-level)</th><th className="r">Rate by amount</th><th className="r">Rate by lines</th></tr></thead>
              <tbody>
                {months.map((m, i) => {
                  const { s, d } = cell(p, m);
                  const prev = i ? cell(p, months[i - 1]).s : null;
                  const delta = prev ? s.amount - prev.amount : null;
                  return (
                    <tr key={m}>
                      <td className="num">{m}</td>
                      <td className="r num">{s.amount.toFixed(2)}{delta !== null && <span className={`delta ${delta > 0 ? 'worse' : delta < 0 ? 'better' : 'same'}`}>{delta > 0 ? '▲' : delta < 0 ? '▼' : '='} {Math.abs(delta).toFixed(0)}</span>}</td>
                      <td className="r num">{s.lines}</td>
                      <td className="r num">{s.medical.toFixed(2)}</td>
                      <td className="r num">{s.technical.toFixed(2)}</td>
                      <td className="r num">{s.review.toFixed(2)}</td>
                      <td className="r num">{s.vatLines ? s.vat.toFixed(2) : '—'}</td>
                      <td className="r num">{d ? pct(d.net ? s.amount / d.net : 0) : <span className="faint">no claims file</span>}</td>
                      <td className="r num">{d ? pct(d.lines ? s.lines / d.lines : 0) : <span className="faint">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {payer === 'Both' && (() => {
        const both = summarizeRejections(rs).amount;
        const parts = PAYERS.map((p) => summarizeRejections(rs.filter((r) => r.payer === p)).amount);
        const ok = Math.abs(both - sum(parts)) < 0.01;
        return <p className={ok ? 'muted' : 'banner'} style={{ fontSize: 13 }}>Reconciliation: Both {sar(both, 2)} {ok ? '=' : '≠'} Bupa {sar(parts[0], 2)} + Tawuniya {sar(parts[1], 2)}.</p>;
      })()}
    </>
  );
}

function RankTable({ title, buckets }: { title: string; buckets: Bucket[] }) {
  const [by, setBy] = useState<'amount' | 'count'>('amount');
  const list = [...buckets].sort(by === 'amount' ? byAmount : byCount).slice(0, 20);
  return (
    <div className="card">
      <div className="card-head">
        <h2>{title}</h2>
        <div className="seg" role="group" aria-label="Rank by"><button aria-pressed={by === 'amount'} onClick={() => setBy('amount')}>By amount</button><button aria-pressed={by === 'count'} onClick={() => setBy('count')}>By frequency</button></div>
      </div>
      {list.length ? (
        <div className="table-wrap" style={{ border: 0 }}>
          <table>
            <thead><tr><th>#</th><th>Item</th><th>Code</th><th className="r">Lines</th><th className="r">SAR</th><th>Main causes</th></tr></thead>
            <tbody>{list.map((b, i) => (
              <tr key={b.key}>
                <td className="num">{i + 1}</td>
                <td>{b.label}</td>
                <td className="mono" style={{ fontSize: 12 }}>{b.key.split('|')[0] || '—'}</td>
                <td className="r num">{b.count}</td>
                <td className="r num">{b.amount.toFixed(2)}</td>
                <td style={{ fontSize: 12 }}>{Object.entries(b.causes).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k, v]) => `${k} (${v})`).join('; ')}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="muted">None in this view.</p>}
    </div>
  );
}

function Services({ rs }: { rs: Rejection[] }) {
  const meds = rs.filter((r) => /medic|pharm|drug|inventory/i.test(r.category));
  const svc = rs.filter((r) => !meds.includes(r));
  return (
    <section className="grid g2">
      <RankTable title={`Services (${svc.length} lines)`} buckets={bucketize(svc, normService, (r) => r.serviceDesc)} />
      <RankTable title={`Medications (${meds.length} lines)`} buckets={bucketize(meds, normService, (r) => r.serviceDesc)} />
    </section>
  );
}

function Doctors({ rs }: { rs: Rejection[] }) {
  const linked = rs.filter((r) => r.linkedClaim);
  const doc = bucketize(rs, (r) => r.doctor || '— not linked to a claim —').sort(byAmount);
  const spec = bucketize(linked, (r) => r.specialty || 'Unspecified').sort(byAmount);
  const split = (b: Bucket) => [{ name: 'Medical', value: b.medical, color: GROUP_COLOR.Medical }, { name: 'Tech/Admin', value: b.technical, color: GROUP_COLOR['Technical/Administrative'] }, { name: 'Needs review', value: b.review, color: GROUP_COLOR['Needs review'] }];
  return (
    <>
      <p className="muted" style={{ fontSize: 13 }}>{int(linked.length)} of {int(rs.length)} rejected lines are linked to an imported claim (by insurer + invoice). Unlinked lines cannot be attributed to a doctor.</p>
      <section className="grid g2">
        <div className="card"><div className="card-head"><h2>By doctor</h2></div><HBars rows={doc.slice(0, 20).map((b) => ({ key: b.key, label: b.label, display: `${sar(b.amount)} · ${b.count}`, segs: split(b), hint: Object.entries(b.causes).map(([k, v]) => `${k}: ${v}`).join(' · ') }))} /><div style={{ marginTop: 12 }}><Legend items={Object.entries(GROUP_COLOR).map(([name, color]) => ({ name, color }))} /></div></div>
        <div className="card"><div className="card-head"><h2>By specialty</h2><p>linked lines only</p></div>{spec.length ? <HBars rows={spec.map((b) => ({ key: b.key, label: b.label, display: `${sar(b.amount)} · ${b.count}`, segs: split(b) }))} /> : <p className="muted">No rejected lines are linked to claims yet – import the claims export for the same insurer and month.</p>}</div>
      </section>
    </>
  );
}

function Lines({ rs, auditById }: { rs: Rejection[]; auditById: Map<string, import('../lib/types').ClaimAudit> }) {
  const { formulary, setOverride, go } = useData();
  const [group, setGroup] = useState('');
  const [link, setLink] = useState('');
  const [q, setQ] = useState('');
  const list = rs.filter((r) => (!group || r.group === group) && (!link || r.link === link) && (!q || `${r.serviceDesc} ${r.serviceCode} ${r.reasonRaw} ${r.invoice} ${r.doctor}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <div className="filters">
        <input id="rej-q" className="input" placeholder="Search service, reason, invoice, doctor" value={q} onChange={(e) => setQ(e.target.value)} />
        <select id="rej-group" className="select" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Type"><option value="">All types</option><option>Medical</option><option>Technical/Administrative</option><option>Needs review</option></select>
        <select id="rej-link" className="select" value={link} onChange={(e) => setLink(e.target.value)} aria-label="Link"><option value="">All link states</option>{Object.entries(LINK_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <span className="faint" style={{ fontSize: 12 }}>{int(list.length)} lines · {sar(round2(sum(list.map((r) => r.amount))), 2)}</span>
      </div>
      <div className="table-wrap" style={{ maxHeight: 720, overflowY: 'auto' }}>
        <table>
          <thead><tr><th>Source</th><th>Service</th><th>Original insurer reason</th><th>Classification</th><th>Link · audit finding on that line</th><th>Suggestion (review manually)</th><th className="r">SAR</th></tr></thead>
          <tbody>
            {list.slice(0, 600).map((r) => {
              const a = r.linkedClaim ? auditById.get(r.linkedClaim) : undefined;
              const onLine = a && r.linkedLine ? a.findings.filter((f) => f.lineIds?.includes(r.linkedLine!)) : [];
              return (
                <tr key={r.id}>
                  <td style={{ fontSize: 12, minWidth: 130 }}><b>{r.payer}</b> · {r.period}<br /><span className="faint">{r.source} · row {r.rowNo}</span><br /><span className="mono">inv {r.invoice || '—'}</span></td>
                  <td style={{ minWidth: 180 }}>{r.serviceDesc}<br /><span className="faint mono" style={{ fontSize: 11 }}>{r.serviceCode} · {r.category}</span>{r.icd && <><br /><span className="faint mono" style={{ fontSize: 11 }}>ICD {r.icd}</span></>}</td>
                  <td style={{ fontSize: 12, minWidth: 200 }}>{r.reasonRaw}{(r.nphiesCode || r.reasonCode) && <div className="mono faint">{[r.nphiesCode, r.reasonCode].filter(Boolean).join(' / ')}</div>}{r.appealStatus && <div className="faint">Appeal: {r.appealStatus}</div>}</td>
                  <td style={{ minWidth: 200 }}>
                    <select className="select" style={{ width: '100%', fontSize: 12 }} value={r.causeId} onChange={(e) => setOverride(r.id, e.target.value)} aria-label="Classification">
                      {[...CAUSES, NEEDS_REVIEW].map((c) => <option key={c.id} value={c.id}>{c.group === 'Medical' ? 'Med' : c.group === 'Needs review' ? 'Review' : 'Tech'} · {c.label}</option>)}
                    </select>
                    <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>{r.overridden ? <>Corrected manually · <button className="btn small ghost" style={{ padding: 0 }} onClick={() => setOverride(r.id, null)}>undo</button></> : r.confidence === 'code' ? 'From reason code' : r.confidence === 'description' ? 'From description' : 'Needs review'}</div>
                  </td>
                  <td style={{ fontSize: 12, minWidth: 200 }}>
                    <span className={`tag ${r.link === 'linked' ? 'tag-med' : r.link === 'unmatched' ? 'tag-tech' : ''}`}>{LINK_LABEL[r.link]}</span>
                    {a && <div style={{ marginTop: 4 }}><button className="btn small ghost" style={{ padding: 0 }} onClick={() => go('audit', { claimId: a.claim.id })}>MRN {a.claim.mrn} · {a.claim.physician}</button></div>}
                    {onLine.slice(0, 2).map((f) => <div key={f.id} style={{ marginTop: 3 }}><Sev s={f.severity} /> {f.title}</div>)}
                  </td>
                  <td style={{ fontSize: 12, minWidth: 220 }}>{adviseRejection(r, formulary).map((x) => <p key={x} style={{ marginBottom: 4 }}>{x}</p>)}</td>
                  <td className="r num">{r.amount.toFixed(2)}{r.vat !== null && <><br /><span className="faint">VAT {r.vat.toFixed(2)}</span></>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {list.length > 600 && <p className="faint">Showing 600 of {int(list.length)}; use filters or export.</p>}
    </>
  );
}

function Patterns() {
  const { history, payer, kv, proposeRule } = useData();
  const list = [...history.patterns.values()].filter((p) => inView(p.payer, payer) && p.rejected > 0).sort((a, b) => b.rejected / b.submitted - a.rejected / a.submitted || b.rejected - a.rejected);
  const proposed = new Set(kv.rules.map((r) => r.id));
  return (
    <>
      <div className="phase-note">
        <b>How this works:</b> imported claim lines and rejected lines that link to them (same insurer and invoice) are counted per service, and per service with the same 3-character principal diagnosis group. Only months that have both a claims file and a rejection file for the insurer are used ({payer === 'Both' ? `Bupa: ${history.comparable.Bupa.join(', ') || 'none'} · Tawuniya: ${history.comparable.Tawuniya.join(', ') || 'none'}` : history.comparable[payer as Payer].join(', ') || 'none'}). {int(history.unlinkedRejections)} rejected lines could not be linked and are not counted. This is descriptive statistics on your own records, not a trained model and not an insurer rule. Patterns marked “significant” have ≥ {MIN_REJECTED} rejected of ≥ {MIN_SUBMITTED} submitted lines and a rate ≥ {Math.round(MIN_RATE * 100)}%; they appear in the Medical audit as historical-pattern findings. You can propose a pattern as a rule; it only becomes active after acceptance in Rulebook & sources.
      </div>
      {list.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Insurer</th><th>Service</th><th>Diagnosis group</th><th className="r">Rejected / submitted</th><th className="r">Rate</th><th>Evidence</th><th /></tr></thead>
            <tbody>
              {list.slice(0, 300).map((p) => {
                const id = `rule-${p.key}`;
                return (
                  <tr key={p.key}>
                    <td>{p.payer}</td>
                    <td>{p.serviceLabel}<br /><span className="faint mono" style={{ fontSize: 11 }}>{p.serviceKey.replace(/^code:|^name:/, '')}</span></td>
                    <td className="mono">{p.dxGroup || 'any'}</td>
                    <td className="r num">{p.rejected} / {p.submitted}</td>
                    <td className="r num">{pct(p.rejected / p.submitted)}{significant(p) ? <><br /><span className="sev sev-medium">significant</span></> : <><br /><span className="faint" style={{ fontSize: 11 }}>small sample</span></>}</td>
                    <td style={{ fontSize: 12, minWidth: 260 }}>{evidenceText(p)}</td>
                    <td>{proposed.has(id) ? <span className="faint">{kv.rules.find((r) => r.id === id)?.status}</span> : <button className="btn small" onClick={() => proposeRule({ id, payer: p.payer, serviceKey: p.serviceKey, serviceLabel: p.serviceLabel, dxGroup: p.dxGroup, rejected: p.rejected, submitted: p.submitted, periods: p.periods, reasons: Object.keys(p.reasons), status: 'proposed', createdAt: new Date().toISOString() })}>Propose rule</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <div className="card"><Empty title="No historical patterns yet">Patterns need claims and rejection files for the same insurer and month, with rejected lines linked to claim lines.</Empty></div>}
    </>
  );
}
