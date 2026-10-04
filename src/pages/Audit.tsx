import { useEffect, useMemo, useState } from 'react';
import { useData } from '../App';
import type { ClaimAudit, FindingKind, Severity, AuditArea } from '../lib/types';
import { AREAS, SEVERITY_ORDER, finalize } from '../lib/engine';
import { inView, isFlagged, summarizeAudits } from '../lib/analytics';
import { exportFindings, exportMarked } from '../lib/exportXlsx';
import { Codes, Empty, Icon, Kpi, Score, Sev, int, sar } from '../ui';
import ClaimDetail, { KIND_LABEL } from './ClaimDetail';

type SevFilter = Severity | 'clean';
type Tab = 'claims' | 'flagged' | 'technical' | 'coverage';
const rank = (a: ClaimAudit) => (a.worst ? SEVERITY_ORDER.indexOf(a.worst) : 9);

export default function AuditPage() {
  const { audits, payer, focus, go, ds } = useData();
  const [tab, setTab] = useState<Tab>((focus.tab as Tab) || 'claims');
  const [importId, setImportId] = useState(focus.importId ?? '');
  const [period, setPeriod] = useState('');
  const scoped = useMemo(() => audits.filter((a) => inView(a.claim.payer, payer) && (!importId || a.claim.importId === importId) && (!period || a.claim.period === period)), [audits, payer, importId, period]);
  const s = useMemo(() => summarizeAudits(scoped), [scoped]);
  const periods = useMemo(() => [...new Set(audits.filter((a) => inView(a.claim.payer, payer)).map((a) => a.claim.period).filter(Boolean))].sort(), [audits, payer]);
  const files = useMemo(() => [...new Map(audits.map((a) => [a.claim.importId, a.claim.sourceFile])).entries()], [audits]);
  const rejected = useMemo(() => ds.rejections.filter((r) => inView(r.payer, payer) && (!period || r.period === period)).reduce((x, r) => x + r.amount, 0), [ds.rejections, payer, period]);
  const tech = useMemo(() => scoped.map((a) => finalize(a.claim, a.findings.filter((f) => f.area === 'Technical & administrative'))).filter((a) => a.findings.length), [scoped]);

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Pre-submission review · {payer === 'Both' ? 'Bupa + Tawuniya' : payer}</span>
          <h1>Medical audit</h1>
          <p>Each encounter is checked before NPHIES submission: diagnosis ↔ service, drug ↔ diagnosis, codes, documentation, vitals vs history, duplication and safety, authorisation, and technical completeness where reference data exists. Findings are suggestions for manual review.</p>
        </div>
        <div className="filters">
          <select id="aud-period" className="select" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period"><option value="">All months</option>{periods.map((p) => <option key={p}>{p}</option>)}</select>
          {files.length > 1 && <select id="aud-file" className="select" value={importId} onChange={(e) => setImportId(e.target.value)} aria-label="File"><option value="">All claim files</option>{files.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>}
          <button className="btn primary" onClick={() => go('files', { tab: 'upload' })}><Icon name="upload" />Upload claims</button>
        </div>
      </div>
      <section className="kpis">
        <Kpi label="Encounters" value={int(s.encounters)} sub={`${int(s.lines)} billing lines · ${sar(s.submittedNet)} net`} tone="accent" />
        <Kpi label="Flagged for review" value={int(s.flagged)} sub="≥ 1 critical or high finding" tone="high" />
        <Kpi label="Amount at risk (predicted)" value={sar(s.amountAtRisk)} sub="net of distinct lines with critical/high findings" tone="crit" />
        <Kpi label="Actually rejected (statements)" value={sar(rejected)} sub="from Rejection analysis – kept separate" />
      </section>
      <div className="tabs" role="tablist">
        {([['claims', 'Encounters & findings'], ['flagged', `Flagged claims (${int(s.flagged)})`], ['technical', `Technical & administrative (${int(tech.length)})`], ['coverage', 'What was checked']] as [Tab, string][]).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'claims' && <AuditWorkspace audits={scoped} exportName="WAD_medical_audit.xlsx" />}
      {tab === 'flagged' && <Flagged audits={scoped} />}
      {tab === 'technical' && <AuditWorkspace audits={tech} exportName="WAD_technical_findings.xlsx" defaultAll />}
      {tab === 'coverage' && <Coverage audits={scoped} />}
    </>
  );
}

export function AuditWorkspace({ audits, exportName, defaultAll }: { audits: ClaimAudit[]; exportName: string; defaultAll?: boolean }) {
  const { focus, kv, bundles } = useData();
  const [q, setQ] = useState('');
  const [sevs, setSevs] = useState<Set<SevFilter>>(new Set(defaultAll || focus.claimId || focus.importId ? [] : ['critical', 'high']));
  const [area, setArea] = useState<AuditArea | ''>('');
  const [kind, setKind] = useState<FindingKind | ''>('');
  const [doctor, setDoctor] = useState(focus.doctor ?? '');
  const [sel, setSel] = useState<string | null>(focus.claimId ?? null);
  useEffect(() => { if (focus.claimId) { setSel(focus.claimId); setSevs(new Set()); } }, [focus.claimId]);

  const doctors = useMemo(() => [...new Set(audits.map((a) => a.claim.physician))].sort(), [audits]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return audits
      .filter((a) => !sevs.size || sevs.has(a.worst ?? 'clean') || (sevs.has('clean') && !isFlagged(a)))
      .filter((a) => !area || a.findings.some((f) => f.area === area))
      .filter((a) => !kind || a.findings.some((f) => f.kind === kind))
      .filter((a) => !doctor || a.claim.physician === doctor)
      .filter((a) => !t || [a.claim.mrn, a.claim.patientName, a.claim.physician, ...a.claim.invoices, ...a.claim.diagnoses.map((d) => d.code), ...a.claim.lines.map((l) => `${l.desc} ${l.code}`)].join(' ').toLowerCase().includes(t))
      .sort((a, b) => rank(a) - rank(b) || b.score - a.score || b.amountAtRisk - a.amountAtRisk);
  }, [audits, q, sevs, area, kind, doctor]);
  const counts = useMemo(() => {
    const c: Record<SevFilter, number> = { critical: 0, high: 0, medium: 0, low: 0, clean: 0 };
    for (const a of audits) c[a.worst ?? 'clean']++;
    return c;
  }, [audits]);
  const selected = audits.find((a) => a.claim.id === sel) ?? null;
  const toggle = (x: SevFilter) => setSevs((prev) => { const n = new Set(prev); n.has(x) ? n.delete(x) : n.add(x); return n; });
  if (!audits.length) return <div className="card"><Empty title="No encounters in this view">Upload a claims export under All files, or change the insurer / month filter.</Empty></div>;
  return (
    <>
      <div className="filters" role="group" aria-label="Filters">
        <input id="audit-q" className="input" placeholder="Search MRN, patient, invoice, ICD, service…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chipset">
          {(['critical', 'high', 'medium', 'clean'] as SevFilter[]).map((x) => <button key={x} className="chip-btn" aria-pressed={sevs.has(x)} onClick={() => toggle(x)}>{x === 'clean' ? 'No critical/high' : x[0].toUpperCase() + x.slice(1)} <span className="num">{counts[x]}</span></button>)}
        </div>
        <select id="audit-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as FindingKind | '')} aria-label="Finding type"><option value="">All finding types</option>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select id="audit-area" className="select" value={area} onChange={(e) => setArea(e.target.value as AuditArea | '')} aria-label="Area"><option value="">All areas</option>{AREAS.map((a) => <option key={a}>{a}</option>)}</select>
        <select id="audit-doctor" className="select" value={doctor} onChange={(e) => setDoctor(e.target.value)} aria-label="Doctor"><option value="">All doctors</option>{doctors.map((d) => <option key={d}>{d}</option>)}</select>
        <button className="btn" onClick={() => exportFindings(list, bundles, exportName)} disabled={!list.length}><Icon name="download" />Export {int(list.length)}</button>
      </div>
      <div className="split">
        <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>
          {list.length ? (
            <table>
              <thead><tr><th>Patient · visit</th><th>Doctor</th><th>Diagnoses</th><th>Risk</th><th className="r">At risk</th></tr></thead>
              <tbody>
                {list.slice(0, 400).map((a) => {
                  const c = a.claim;
                  const reviewed = kv.review[c.id]?.status === 'reviewed';
                  return (
                    <tr key={c.id} className="clickable" aria-selected={c.id === sel} onClick={() => setSel(c.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSel(c.id)}>
                      <td>
                        {isFlagged(a) && <span className={`flag-chip ${reviewed ? 'done' : ''}`}>{reviewed ? '✓ Reviewed' : '⚑ Review'}</span>} <span className="tag">{c.payer}</span>
                        <div style={{ marginTop: 2 }}><b className="mono">MRN {c.mrn || '—'}</b> {c.patientName}</div>
                        <span className="faint num">{c.serviceDate} · {c.invoices.length} invoice{c.invoices.length === 1 ? '' : 's'}{c.groupingWarnings.length ? ' · grouping ⚠' : ''}</span>
                      </td>
                      <td>{c.physician}<br /><span className="faint">{c.specialty}</span></td>
                      <td><Codes codes={c.diagnoses.map((d) => d.code)} /></td>
                      <td><Sev s={a.worst} /><div style={{ marginTop: 4 }}><Score score={a.score} /></div></td>
                      <td className="r num">{sar(a.amountAtRisk)}<br /><span className="faint">{a.findings.length} findings</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <Empty title="No encounters match these filters">Clear a filter or choose another severity.</Empty>}
          {list.length > 400 && <p className="faint" style={{ padding: 12 }}>Showing 400 of {int(list.length)} – narrow the filters or export.</p>}
        </div>
        <div className="detail">{selected ? <ClaimDetail a={selected} /> : <div className="card"><Empty title="Select an encounter">Pick an encounter to see its lines, evidence, findings and suggested actions.</Empty></div>}</div>
      </div>
    </>
  );
}

function Flagged({ audits }: { audits: ClaimAudit[] }) {
  const { kv, setReview, bundles } = useData();
  const [status, setStatus] = useState<'open' | 'reviewed' | ''>('open');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const marked = audits.filter(isFlagged).sort((a, b) => rank(a) - rank(b) || b.amountAtRisk - a.amountAtRisk);
  const isRev = (id: string) => kv.review[id]?.status === 'reviewed';
  const list = marked.filter((a) => !status || (status === 'reviewed') === isRev(a.claim.id));
  return (
    <>
      <div className="filters">
        <div className="seg" role="group" aria-label="Status">{([['open', `Open (${marked.filter((a) => !isRev(a.claim.id)).length})`], ['reviewed', `Reviewed (${marked.filter((a) => isRev(a.claim.id)).length})`], ['', 'All']] as const).map(([k, l]) => <button key={l} aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}</div>
        {picked.size > 0 && <button className="btn small" onClick={() => { setReview([...picked], 'reviewed'); setPicked(new Set()); }}>Mark {picked.size} reviewed</button>}
        <button className="btn" onClick={() => exportMarked(marked, bundles, isRev)}><Icon name="download" />Download marked claim files</button>
      </div>
      <div className="table-wrap">
        {list.length ? (
          <table>
            <thead><tr><th><input type="checkbox" aria-label="Select all" checked={picked.size > 0 && picked.size === list.length} onChange={(e) => setPicked(e.target.checked ? new Set(list.map((a) => a.claim.id)) : new Set())} /></th><th>Marker</th><th>MRN · patient</th><th>Visit</th><th>Doctor</th><th>Why it needs review</th><th className="r">At risk</th></tr></thead>
            <tbody>{list.slice(0, 500).map((a) => {
              const c = a.claim, rv = isRev(c.id);
              const why = a.findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
              return (
                <tr key={c.id}>
                  <td><input type="checkbox" aria-label={`Select MRN ${c.mrn}`} checked={picked.has(c.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); e.target.checked ? n.add(c.id) : n.delete(c.id); return n; })} /></td>
                  <td><span className={`flag-chip ${rv ? 'done' : ''}`}>{rv ? '✓ Reviewed' : '⚑ Review'}</span><div style={{ marginTop: 4 }}><Sev s={a.worst} /></div></td>
                  <td><b className="mono">MRN {c.mrn}</b><br />{c.patientName}<br /><span className="tag">{c.payer}</span></td>
                  <td className="num">{c.serviceDate}<br /><span className="faint">{c.sourceFile}</span></td>
                  <td>{c.physician}</td>
                  <td style={{ fontSize: 12, minWidth: 260 }}>{why.slice(0, 3).map((f) => <div key={f.id}>• {f.title}</div>)}{why.length > 3 && <span className="faint">+{why.length - 3} more</span>}</td>
                  <td className="r num">{sar(a.amountAtRisk)}<br /><button className="btn small" style={{ marginTop: 4 }} onClick={() => setReview([c.id], rv ? 'open' : 'reviewed')}>{rv ? 'Reopen' : 'Done'}</button></td>
                </tr>
              );
            })}</tbody>
          </table>
        ) : <Empty title="Nothing in this list" />}
      </div>
    </>
  );
}

function Coverage({ audits }: { audits: ClaimAudit[] }) {
  const { ds, formulary, formularySource, payer } = useData();
  const lines = audits.flatMap((a) => a.claim.lines.filter((l) => /medic|pharm|drug|inventory/i.test(l.category)));
  const resolved = formulary ? lines.filter((l) => formulary.lookup(l.code, l.gtin, l.desc)).length : 0;
  const grouping = audits.filter((a) => a.claim.groupingWarnings.length).length;
  const payers = payer === 'Both' ? (['Bupa', 'Tawuniya'] as const) : [payer];
  const Row = ({ name, ok, text }: { name: string; ok: boolean | null; text: string }) => (
    <tr><td><b>{name}</b></td><td>{ok === null ? <span className="sev sev-medium">Partial</span> : ok ? <span className="sev sev-clean">Checked</span> : <span className="sev sev-low">Unable to verify</span>}</td><td style={{ fontSize: 13 }}>{text}</td></tr>
  );
  return (
    <section className="card">
      <div className="card-head"><h2>What could and could not be verified</h2><p>checks without reference data are not guessed</p></div>
      <div className="table-wrap" style={{ border: 0 }}>
        <table><tbody>
          <Row name="Drug ↔ diagnosis" ok={formulary ? (resolved === lines.length ? true : null) : false} text={formulary ? `${formularySource}. ${int(resolved)} of ${int(lines.length)} medication lines resolved to an ingredient; unresolved drugs are not assumed incompatible.` : 'No formulary loaded.'} />
          <Row name="Diagnosis ↔ service, documentation, vitals, safety, ICD quality" ok text={`Hospital rule set applied to all ${int(audits.length)} encounters (see Rulebook & sources).`} />
          {payers.map((p) => <Row key={`p-${p}`} name={`${p} contracted prices`} ok={ds.priceLists[p].size > 0} text={ds.priceLists[p].size ? `${int(ds.priceLists[p].size)} codes from ${ds.priceListMeta[p].map((m) => m.filename).join(', ')}.` : `No ${p} price list uploaded – price mapping and contracted-price checks are not run. Upload it under All files → Reference data.`} />)}
          {payers.map((p) => <Row key={`a-${p}`} name={`${p} pre-authorisation list`} ok={ds.approvalLists[p].size > 0} text={ds.approvalLists[p].size ? `${int(ds.approvalLists[p].size)} codes from ${ds.approvalMeta[p].map((m) => m.filename).join(', ')}.` : `No ${p} approval list uploaded – approval requirements are shown as “verify” only for CT/MRI.`} />)}
          <Row name="Encounter grouping" ok={grouping === 0 ? true : null} text={`${int(grouping)} encounter(s) have a grouping warning (different complaints/diagnoses or repeated consultations in one group). ClaimNo is not used for grouping.`} />
          <Row name="Historical rejection patterns" ok={null} text="Uses only imported months that have both claims and rejection files for the same insurer; see Rejection analysis → Historical patterns." />
        </tbody></table>
      </div>
    </section>
  );
}
