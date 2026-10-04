import { useMemo, useState } from 'react';
import { useData } from '../App';
import type { ClaimAudit, Rejection, Section } from '../lib/types';
import { AREAS, viewAudit } from '../lib/engine';
import { ruleName } from '../lib/kb/rules';
import { causeById } from '../lib/kb/rejectionCodes';
import { SECTION_LABEL } from '../store';
import { Empty, HBars, Legend, int, pct, sar } from '../ui';

const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', '#eda100', '#e87ba4', '#4a3aa7'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = (m: string) => (m.length === 7 ? `${MONTH_NAMES[+m.slice(5) - 1]} ${m.slice(0, 4)}` : m);
const serious = (a: ClaimAudit) => a.findings.some((f) => f.severity === 'critical' || f.severity === 'high');

interface MonthStats {
  month: string;
  enc: number;
  billed: number;
  clean: number;
  critical: number;
  findings: number;
  atRisk: number;
  area: Record<string, number>; // encounters with ≥1 finding in area
  rules: Record<string, number>;
  doctors: Record<string, { enc: number; clean: number }>;
  rejSar: number;
  rejLines: number;
  rejMedical: number;
  causes: Record<string, number>;
}

function stats(month: string, audits: ClaimAudit[], rej: Rejection[]): MonthStats {
  const s: MonthStats = { month, enc: audits.length, billed: 0, clean: 0, critical: 0, findings: 0, atRisk: 0, area: {}, rules: {}, doctors: {}, rejSar: 0, rejLines: rej.length, rejMedical: 0, causes: {} };
  for (const a of audits) {
    s.billed += a.claim.lines.reduce((x, l) => x + (l.net > 0 ? l.net : l.billed), 0);
    s.atRisk += a.amountAtRisk;
    s.findings += a.findings.length;
    const ok = !serious(a);
    if (ok) s.clean++;
    const d = (s.doctors[a.claim.physician] ??= { enc: 0, clean: 0 });
    d.enc++;
    if (ok) d.clean++;
    const areas = new Set<string>();
    for (const f of a.findings) {
      if (f.severity === 'critical') s.critical++;
      areas.add(f.area);
      s.rules[f.ruleId] = (s.rules[f.ruleId] ?? 0) + 1;
    }
    for (const ar of areas) s.area[ar] = (s.area[ar] ?? 0) + 1;
  }
  for (const r of rej) {
    s.rejSar += r.amount;
    if (r.group === 'Medical') s.rejMedical += r.amount;
    s.causes[r.causeId] = (s.causes[r.causeId] ?? 0) + r.amount;
  }
  return s;
}

/** Change vs the previous month; `goodWhenUp` decides the colour. */
function Delta({ cur, prev, goodWhenUp, fmt }: { cur: number; prev?: number; goodWhenUp: boolean; fmt: (n: number) => string }) {
  if (prev === undefined) return null;
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return <span className="delta same">=</span>;
  const better = goodWhenUp ? d > 0 : d < 0;
  const txt = fmt === pct ? `${(Math.abs(d) * 100).toFixed(1)} pts` : fmt(Math.abs(d));
  return <span className={`delta ${better ? 'better' : 'worse'}`}>{d > 0 ? '▲' : '▼'} {txt}</span>;
}

export default function ComparePage() {
  const { audits, rejections } = useData();
  const sections = (['medical', 'rejection', 'technical'] as Section[]).filter((s) => audits.some((a) => a.claim.section === s));
  const [section, setSection] = useState<Section | 'all'>(sections[0] ?? 'all');

  const months = useMemo(() => {
    const scoped = audits.filter((a) => section === 'all' || a.claim.section === section).map((a) => viewAudit(a, section === 'technical' ? 'technical' : section === 'medical' ? 'medical' : 'all'));
    const ms = [...new Set([...scoped.map((a) => a.claim.serviceDate.slice(0, 7)), ...rejections.map((r) => r.serviceDate.slice(0, 7))].filter(Boolean))].sort();
    return ms.map((m) => stats(m, scoped.filter((a) => a.claim.serviceDate.startsWith(m)), rejections.filter((r) => r.serviceDate.startsWith(m))));
  }, [audits, rejections, section]);

  if (months.length < 2) {
    return (
      <>
        <div className="page-head"><div><span className="eyebrow">Trends</span><h1>Month comparison</h1></div></div>
        <div className="card"><Empty title="Upload at least two months">Upload claim exports or statements from different months (any section). The comparison builds itself from the service dates.</Empty></div>
      </>
    );
  }

  const shown = months.slice(-6);
  const color = (i: number) => SERIES[i % SERIES.length];
  const rows: { label: string; get: (m: MonthStats) => number; fmt: (n: number) => string; goodWhenUp: boolean }[] = [
    { label: 'Encounters', get: (m) => m.enc, fmt: int, goodWhenUp: true },
    { label: 'Billed (net)', get: (m) => m.billed, fmt: (n) => sar(n), goodWhenUp: true },
    { label: 'Clean-claim rate', get: (m) => (m.enc ? m.clean / m.enc : 0), fmt: pct, goodWhenUp: true },
    { label: 'Marked for review', get: (m) => m.enc - m.clean, fmt: int, goodWhenUp: false },
    { label: 'Findings per encounter', get: (m) => (m.enc ? m.findings / m.enc : 0), fmt: (n) => n.toFixed(1), goodWhenUp: false },
    { label: 'Critical findings', get: (m) => m.critical, fmt: int, goodWhenUp: false },
    { label: 'SAR at risk', get: (m) => m.atRisk, fmt: (n) => sar(n), goodWhenUp: false },
    { label: 'At risk as % of billed', get: (m) => (m.billed ? m.atRisk / m.billed : 0), fmt: pct, goodWhenUp: false },
    { label: 'Rejected SAR (statements)', get: (m) => m.rejSar, fmt: (n) => sar(n), goodWhenUp: false },
    { label: 'Rejected lines', get: (m) => m.rejLines, fmt: int, goodWhenUp: false },
    { label: 'Medical share of rejections', get: (m) => (m.rejSar ? m.rejMedical / m.rejSar : 0), fmt: pct, goodWhenUp: false },
  ];
  const topRules = Object.entries(shown.reduce<Record<string, number>>((acc, m) => { for (const [k, v] of Object.entries(m.rules)) acc[k] = (acc[k] ?? 0) + v; return acc; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k);
  const causes = [...new Set(shown.flatMap((m) => Object.keys(m.causes)))].sort((a, b) => shown.reduce((s, m) => s + (m.causes[b] ?? 0), 0) - shown.reduce((s, m) => s + (m.causes[a] ?? 0), 0));
  const doctors = [...new Set(shown.flatMap((m) => Object.keys(m.doctors)))].sort();
  const last = shown[shown.length - 1], prev = shown[shown.length - 2];

  // Plain-language headline of what changed between the last two months.
  const moves = topRules
    .map((r) => ({ r, d: (last.enc ? (last.rules[r] ?? 0) / last.enc : 0) - (prev.enc ? (prev.rules[r] ?? 0) / prev.enc : 0) }))
    .filter((x) => Math.abs(x.d) >= 0.05)
    .sort((a, b) => b.d - a.d);
  const worse = moves.filter((x) => x.d > 0).slice(0, 3);
  const better = moves.filter((x) => x.d < 0).slice(-3).reverse();

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Trends · {shown.length} months</span>
          <h1>Month comparison</h1>
          <p>Each month side by side, with the change against the month before. Red arrows are getting worse, green arrows are improving.</p>
        </div>
        <select id="cmp-section" className="select" value={section} onChange={(e) => setSection(e.target.value as Section | 'all')} aria-label="Section">
          {sections.map((s) => <option key={s} value={s}>{SECTION_LABEL[s]}</option>)}
          <option value="all">All sections</option>
        </select>
      </div>

      <section className="grid g2">
        <div className="card">
          <div className="card-head"><h2>{label(last.month)} vs {label(prev.month)}: getting worse</h2></div>
          {worse.length ? <ul className="list">{worse.map((x) => <li key={x.r}><b>{ruleName(x.r)}</b> <span className="delta worse">▲ {Math.round(x.d * 100)} per 100 encounters</span></li>)}</ul> : <p className="muted">No rule rose by 5 or more per 100 encounters.</p>}
        </div>
        <div className="card">
          <div className="card-head"><h2>{label(last.month)} vs {label(prev.month)}: improving</h2></div>
          {better.length ? <ul className="list">{better.map((x) => <li key={x.r}><b>{ruleName(x.r)}</b> <span className="delta better">▼ {Math.round(-x.d * 100)} per 100 encounters</span></li>)}</ul> : <p className="muted">No rule fell by 5 or more per 100 encounters.</p>}
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Key figures by month</h2><p>change vs previous month</p></div>
        <div className="table-wrap" style={{ border: 0 }}>
          <table>
            <thead><tr><th>Measure</th>{shown.map((m) => <th key={m.month} className="r">{label(m.month)}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  {shown.map((m, i) => <td key={m.month} className="r num">{r.fmt(r.get(m))}<Delta cur={r.get(m)} prev={i ? r.get(shown[i - 1]) : undefined} goodWhenUp={r.goodWhenUp} fmt={r.fmt} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid g2">
        <div className="card">
          <div className="card-head"><h2>Encounters with a finding, by area</h2><p>% of the month’s encounters</p></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {AREAS.map((ar) => (
              <div key={ar}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{ar}</div>
                <HBars max={1} rows={shown.map((m, i) => ({ key: m.month, label: label(m.month), display: pct(m.enc ? (m.area[ar] ?? 0) / m.enc : 0), segs: [{ name: label(m.month), value: m.enc ? (m.area[ar] ?? 0) / m.enc : 0, color: color(i) }] }))} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12 }}><Legend items={shown.map((m, i) => ({ name: label(m.month), color: color(i) }))} /></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-head"><h2>Top findings per 100 encounters</h2></div>
            <div className="table-wrap" style={{ border: 0 }}>
              <table>
                <thead><tr><th>Finding</th>{shown.map((m) => <th key={m.month} className="r">{label(m.month)}</th>)}</tr></thead>
                <tbody>
                  {topRules.map((r) => (
                    <tr key={r}>
                      <td><span className="code">{r}</span> {ruleName(r)}</td>
                      {shown.map((m, i) => {
                        const v = m.enc ? ((m.rules[r] ?? 0) / m.enc) * 100 : 0;
                        const pv = i && shown[i - 1].enc ? ((shown[i - 1].rules[r] ?? 0) / shown[i - 1].enc) * 100 : undefined;
                        return <td key={m.month} className="r num">{v.toFixed(0)}<Delta cur={v} prev={i ? pv : undefined} goodWhenUp={false} fmt={(n) => n.toFixed(0)} /></td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {causes.length > 0 && (
            <div className="card">
              <div className="card-head"><h2>Rejections by cause (SAR)</h2></div>
              <div className="table-wrap" style={{ border: 0 }}>
                <table>
                  <thead><tr><th>Cause</th>{shown.map((m) => <th key={m.month} className="r">{label(m.month)}</th>)}</tr></thead>
                  <tbody>
                    {causes.map((c) => (
                      <tr key={c}>
                        <td>{causeById(c).label} <span className={`tag ${causeById(c).group === 'Medical' ? 'tag-med' : 'tag-tech'}`}>{causeById(c).group}</span></td>
                        {shown.map((m, i) => <td key={m.month} className="r num">{(m.causes[c] ?? 0).toFixed(0)}<Delta cur={m.causes[c] ?? 0} prev={i ? shown[i - 1].causes[c] ?? 0 : undefined} goodWhenUp={false} fmt={(n) => n.toFixed(0)} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Clean-claim rate by doctor</h2><p>encounters in brackets</p></div>
        <div className="table-wrap" style={{ border: 0 }}>
          <table>
            <thead><tr><th>Doctor</th>{shown.map((m) => <th key={m.month} className="r">{label(m.month)}</th>)}</tr></thead>
            <tbody>
              {doctors.map((d) => (
                <tr key={d}>
                  <td>{d}</td>
                  {shown.map((m, i) => {
                    const x = m.doctors[d];
                    const p = shown[i - 1]?.doctors[d];
                    return <td key={m.month} className="r num">{x ? <>{pct(x.clean / x.enc)} <span className="faint">({x.enc})</span><Delta cur={x.clean / x.enc} prev={i && p ? p.clean / p.enc : undefined} goodWhenUp fmt={pct} /></> : <span className="faint">—</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
