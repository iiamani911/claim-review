import { useState } from 'react';
import { AREAS } from '../lib/engine';
import { RULES, SOURCES } from '../lib/kb/rules';
import { SERVICE_RULES } from '../lib/kb/services';
import { INTERACTIONS } from '../lib/kb/drugs';
import { CAUSES } from '../lib/kb/rejectionCodes';
import { Sev } from '../ui';

export default function Rulebook() {
  const [tab, setTab] = useState<'rules' | 'services' | 'ddi' | 'causes' | 'sources'>('rules');
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Transparency</span>
          <h1>Rulebook & sources</h1>
          <p>Every check the audit runs, the evidence behind it and the severity it carries. Levels: <b>Must fix</b> – likely or near-certain rejection, change before submission; <b>Review</b> – weak point a reviewer may reject; <b>Info</b> – coding hygiene. Items in the always-rejected list are always Must fix.</p>
        </div>
        <div className="seg" role="group" aria-label="Section">
          {([['rules', `Audit rules (${RULES.length})`], ['services', `Service criteria (${SERVICE_RULES.length})`], ['ddi', `Interactions (${INTERACTIONS.length})`], ['causes', 'Rejection causes'], ['sources', 'Sources']] as const).map(([k, l]) => (
            <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>
      {tab === 'rules' && AREAS.map((a) => (
        <section className="card" key={a}>
          <div className="card-head"><h2>{a}</h2></div>
          <div className="table-wrap" style={{ border: 0 }}>
            <table><tbody>
              {RULES.filter((r) => r.area === a).map((r) => (
                <tr key={r.id}><td style={{ width: 90 }}><span className="code">{r.id}</span></td><td><b>{r.name}</b><br /><span className="muted">{r.what}</span></td><td style={{ width: 110 }}>{r.severity === 'varies' ? <span className="faint">varies</span> : <Sev s={r.severity} />}</td><td className="faint" style={{ fontSize: 12, width: 220 }}>{r.source}</td></tr>
              ))}
            </tbody></table>
          </div>
        </section>
      ))}
      {tab === 'services' && (
        <div className="table-wrap"><table>
          <thead><tr><th>Service</th><th>Justifying ICD groups</th><th>Justified only when documented</th><th>Guidance</th></tr></thead>
          <tbody>{SERVICE_RULES.map((r) => (
            <tr key={r.id}>
              <td style={{ minWidth: 160 }}><b>{r.label}</b><br /><span className="code">{r.id}</span>{r.coverageNote && <><br /><span className="faint" style={{ fontSize: 12 }}>{r.coverageNote}</span></>}</td>
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
        <div className="grid g2">{CAUSES.map((c) => (
          <div className="card cause-card" key={c.id}>
            <div className="meta"><span className={`tag ${c.group === 'Medical' ? 'tag-med' : 'tag-tech'}`}>{c.group}</span><span className="code">{c.nphies}</span></div>
            <h3>{c.label}</h3>
            <ul className="list" style={{ fontSize: 13 }}>{c.prevent.map((p) => <li key={p}>{p}</li>)}</ul>
            <p style={{ fontSize: 12 }}><b>Appeal:</b> <span className="muted">{c.appeal}</span></p>
          </div>))}
        </div>
      )}
      {tab === 'sources' && (
        <section className="card">
          <ul className="list">{SOURCES.map((s) => <li key={s.name}><b>{s.name}</b><br /><span className="muted">{s.use}</span></li>)}</ul>
          <p className="faint" style={{ marginTop: 14, fontSize: 12 }}>The audit supports, and does not replace, the clinical judgement of the treating doctor. Payer contracts and the CHI formulary change: update the formulary file (scripts/build_formulary.py) when CHI publishes a new DDF version.</p>
        </section>
      )}
    </>
  );
}
