import { useState } from 'react';
import { useData } from '../App';
import { RULES, SOURCES, ruleScope, ruleType, ruleVersion } from '../lib/kb/rules';
import { SERVICE_RULES } from '../lib/kb/services';
import { INTERACTIONS } from '../lib/kb/drugs';
import { CAUSES, NEEDS_REVIEW } from '../lib/rejections';
import { Empty, Sev, int } from '../ui';

type Tab = 'rules' | 'proposed' | 'reference' | 'services' | 'ddi' | 'causes' | 'sources';

export default function Rulebook() {
  const { kv, markVerified, decideRule, ds, formularySource, bundles, go } = useData();
  const [tab, setTab] = useState<Tab>('rules');
  const [type, setType] = useState('');
  const proposed = kv.rules;
  const refs = bundles.filter((b) => b.meta.fileType === 'reference');
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Transparency</span>
          <h1>Rulebook & sources</h1>
          <p>Every rule the audit runs, what kind of rule it is, who it applies to, where it comes from and when it was last verified. Hospital rules are this tool’s own clinical and documentation checks; official reference rules come from the CHI formulary file; insurer reference rules need that insurer’s uploaded file; historical patterns come from your imports.</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {([['rules', `Audit rules (${RULES.length})`], ['proposed', `Proposed rules (${proposed.filter((r) => r.status === 'proposed').length})`], ['reference', 'Reference datasets'], ['services', `Service criteria (${SERVICE_RULES.length})`], ['ddi', `Interactions (${INTERACTIONS.length})`], ['causes', 'Rejection classification'], ['sources', 'Sources']] as [Tab, string][]).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === 'rules' && (
        <>
          <div className="filters">
            <select id="rb-type" className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Rule type">
              <option value="">All rule types</option><option>Hospital rule</option><option>Official reference rule</option><option>Insurer reference rule</option><option>Historical pattern</option>
            </select>
            <span className="faint" style={{ fontSize: 12 }}>“Last verified” is set by a reviewer in this browser; rules never verified say so.</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Rule</th><th>Description</th><th>Type</th><th>Scope</th><th>Source</th><th>Version / date</th><th>Severity</th><th>Last verified</th></tr></thead>
              <tbody>
                {RULES.filter((r) => !type || ruleType(r.id) === type).map((r) => (
                  <tr key={r.id}>
                    <td><span className="code">{r.id}</span></td>
                    <td style={{ minWidth: 240 }}><b>{r.name}</b><br /><span className="muted" style={{ fontSize: 12 }}>{r.what}</span></td>
                    <td style={{ fontSize: 12 }}>{ruleType(r.id)}</td>
                    <td style={{ fontSize: 12 }}>{ruleScope(r.id) === 'Shared' ? 'Shared (Bupa + Tawuniya)' : 'Per insurer'}</td>
                    <td style={{ fontSize: 12, minWidth: 160 }}>{r.source}</td>
                    <td style={{ fontSize: 12 }}>{ruleVersion(r.id)}</td>
                    <td>{r.severity === 'varies' ? <span className="faint">varies</span> : <Sev s={r.severity} />}</td>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{kv.verified[r.id] ? kv.verified[r.id].slice(0, 10) : <span className="faint">Not verified</span>}<br /><button className="btn small ghost" style={{ padding: 0 }} onClick={() => markVerified(r.id)}>Mark verified today</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'proposed' && (
        proposed.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Insurer</th><th>Service</th><th>Diagnosis group</th><th className="r">Evidence</th><th>Status</th><th /></tr></thead>
              <tbody>{proposed.map((r) => (
                <tr key={r.id}>
                  <td>{r.payer}</td>
                  <td>{r.serviceLabel}<br /><span className="faint mono" style={{ fontSize: 11 }}>{r.serviceKey.replace(/^code:|^name:/, '')}</span></td>
                  <td className="mono">{r.dxGroup || 'any'}</td>
                  <td className="r num">{r.rejected} / {r.submitted} rejected<br /><span className="faint">{r.periods.join(', ')}</span></td>
                  <td>{r.status === 'accepted' ? <span className="sev sev-clean">Active</span> : r.status === 'rejected' ? <span className="sev sev-low">Rejected</span> : <span className="sev sev-medium">Proposed – inactive</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.status !== 'accepted' && <button className="btn small" onClick={() => decideRule(r.id, 'accepted')}>Accept & activate</button>}{' '}
                    {r.status !== 'rejected' && <button className="btn small ghost" onClick={() => decideRule(r.id, 'rejected')}>Reject</button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="card"><Empty title="No proposed rules">Propose rules from Rejection analysis → Historical patterns. They stay inactive until accepted here.</Empty></div>
      )}

      {tab === 'reference' && (
        <section className="card">
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead><tr><th>Dataset</th><th>Scope</th><th>File / version</th><th>Loaded</th><th>Used by</th></tr></thead>
              <tbody>
                <tr><td><b>CHI Drug Formulary (DDF)</b></td><td>Shared</td><td style={{ fontSize: 12 }}>{formularySource}</td><td className="num">{ds.formulary ? ds.formulary.uploadedAt.slice(0, 10) : 'built into the app'}</td><td style={{ fontSize: 12 }}>Drug ↔ diagnosis rules, Drug ↔ ICD checker</td></tr>
                {(['Bupa', 'Tawuniya'] as const).map((p) => <tr key={`pl-${p}`}><td><b>{p} price list</b></td><td>{p}</td><td style={{ fontSize: 12 }}>{ds.priceListMeta[p].length ? ds.priceListMeta[p].map((m) => `${m.filename}${m.version ? ` (${m.version})` : ''}`).join(', ') : <span className="faint">Not uploaded – price checks show “Unable to verify”</span>}</td><td className="num">{ds.priceListMeta[p][0]?.uploadedAt.slice(0, 10) ?? '—'}</td><td style={{ fontSize: 12 }}>{int(ds.priceLists[p].size)} codes · TEC-PRICE rules</td></tr>)}
                {(['Bupa', 'Tawuniya'] as const).map((p) => <tr key={`al-${p}`}><td><b>{p} approval list</b></td><td>{p}</td><td style={{ fontSize: 12 }}>{ds.approvalMeta[p].length ? ds.approvalMeta[p].map((m) => m.filename).join(', ') : <span className="faint">Not uploaded</span>}</td><td className="num">{ds.approvalMeta[p][0]?.uploadedAt.slice(0, 10) ?? '—'}</td><td style={{ fontSize: 12 }}>{int(ds.approvalLists[p].size)} codes · TEC-PA-001</td></tr>)}
                {refs.filter((b) => b.meta.refKind === 'other').map((b) => <tr key={b.meta.id}><td>{b.meta.filename}</td><td>{b.meta.payer ?? 'Shared'}</td><td>{b.meta.version ?? '—'}</td><td className="num">{b.meta.uploadedAt.slice(0, 10)}</td><td className="faint">Stored for reference</td></tr>)}
              </tbody>
            </table>
          </div>
          <button className="btn small" style={{ marginTop: 10 }} onClick={() => go('files', { tab: 'upload' })}>Upload reference data</button>
        </section>
      )}

      {tab === 'services' && (
        <div className="table-wrap"><table>
          <thead><tr><th>Service</th><th>Justifying ICD groups</th><th>Justified only when documented</th><th>Basis</th></tr></thead>
          <tbody>{SERVICE_RULES.map((r) => (
            <tr key={r.id}>
              <td style={{ minWidth: 160 }}><b>{r.label}</b><br /><span className="code">{r.id}</span><br /><span className="faint" style={{ fontSize: 11 }}>Hospital rule · shared</span></td>
              <td style={{ minWidth: 200 }}><span className="codes">{r.icd.slice(0, 24).map((c) => <span className="code" key={c}>{c}</span>)}{r.icd.length > 24 && <span className="faint">+{r.icd.length - 24}</span>}</span></td>
              <td style={{ minWidth: 200, fontSize: 12 }}>{(r.conditional ?? []).map((c) => <p key={c.needsLabel}><span className="mono">{c.icd.slice(0, 8).join(', ')}{c.icd.length > 8 ? '…' : ''}</span> → {c.needsLabel}</p>)}</td>
              <td style={{ minWidth: 260, fontSize: 12 }}>{r.why}<br /><span className="faint">{r.refs.join(' · ')}</span></td>
            </tr>))}</tbody>
        </table></div>
      )}

      {tab === 'ddi' && (
        <div className="table-wrap"><table>
          <thead><tr><th>Combination</th><th>Severity</th><th>Effect</th><th>Action</th></tr></thead>
          <tbody>{INTERACTIONS.map((i) => <tr key={i.a + i.b}><td className="mono" style={{ fontSize: 12 }}>{i.a === i.b ? `${i.a} ×2` : `${i.a} + ${i.b}`}</td><td><Sev s={i.severity} /></td><td>{i.effect}</td><td className="muted">{i.action}</td></tr>)}</tbody>
        </table></div>
      )}

      {tab === 'causes' && (
        <div className="table-wrap"><table>
          <thead><tr><th>Cause</th><th>Type / subcategory</th><th>Recognised codes</th><th>Description pattern</th></tr></thead>
          <tbody>{[...CAUSES, NEEDS_REVIEW].map((c) => (
            <tr key={c.id}>
              <td><b>{c.label}</b><br /><span className="code">{c.id}</span></td>
              <td style={{ fontSize: 12 }}>{c.group}<br /><span className="faint">{c.subcategory}</span></td>
              <td style={{ fontSize: 12 }}>{c.codes.length ? c.codes.map((k) => `${k.code} (${k.scope === 'NPHIES' ? 'NPHIES' : `${k.scope} code`})`).join(', ') : '—'}</td>
              <td className="mono" style={{ fontSize: 11, maxWidth: 320 }}>{c.match.source.slice(0, 140)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}

      {tab === 'sources' && (
        <section className="card">
          <ul className="list">{SOURCES.map((s) => <li key={s.name}><b>{s.name}</b><br /><span className="muted">{s.use}</span></li>)}</ul>
          <p className="faint" style={{ marginTop: 14, fontSize: 12 }}>Guideline names identify the evidence each hospital rule is based on; they are not insurer policies. Verify current editions before relying on a rule, and record the verification date in the rules table.</p>
        </section>
      )}
    </>
  );
}
