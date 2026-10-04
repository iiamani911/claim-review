import { Fragment, useState, type ReactNode } from 'react';
import type { ClaimAudit, Finding, Severity } from '../lib/types';
import { AREAS, SEVERITY_ORDER, type AuditView } from '../lib/engine';
import { useData } from '../App';
import { SECTION_LABEL } from '../store';
import { TERMS, negatedAt } from '../lib/text';
import { CopyButton, Sev, sar, sevColor } from '../ui';

const HIGHLIGHT = new RegExp([TERMS.feverPos.source, TERMS.afebrile.source, TERMS.trauma.source, TERMS.severeOnly.source, TERMS.duration.source, TERMS.pregnant.source, TERMS.tachypnea.source, TERMS.dehydration.source, TERMS.workPositive.source].join('|'), 'gi');

function highlight(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(HIGHLIGHT)) {
    if (!m[0].trim()) continue;
    const i = m.index ?? 0;
    out.push(text.slice(last, i));
    out.push(<mark key={i} className={negatedAt(text, i) ? 'neg' : undefined} title={negatedAt(text, i) ? 'negated (denied / absent)' : undefined}>{m[0]}</mark>);
    last = i + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

export function doctorQuery(a: ClaimAudit): string {
  const c = a.claim;
  const items = a.findings.filter((f) => f.severity !== 'low');
  return [
    `Dear ${c.physician},`,
    `Claim ${c.claimNo} – ${c.patientName || c.mrn} (MRN ${c.mrn}), ${c.serviceDate}, ICD ${c.diagnoses.map((d) => d.code).join(', ') || 'none'}.`,
    `Before submission to ${c.payer || 'the payer'}, please review and correct:`,
    ...items.map((f, i) => `${i + 1}. [${f.severity.toUpperCase()}] ${f.title}\n   Action: ${f.fix}${f.suggestedNote ? `\n   Suggested note: "${f.suggestedNote}"` : ''}`),
    '',
    'Thank you – Insurance office, WAD Clinic.',
  ].join('\n');
}

export default function ClaimDetail({ a, view = 'all' }: { a: ClaimAudit; view?: AuditView }) {
  const c = a.claim;
  const { review, setReview } = useData();
  const marked = a.findings.some((f) => f.severity === 'critical' || f.severity === 'high');
  const reviewed = review[c.id]?.status === 'reviewed';
  const v = c.vitals;
  const lineSev = new Map<string, Severity>();
  for (const f of a.findings) for (const id of f.lineIds ?? []) {
    const cur = lineSev.get(id);
    if (!cur || SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(cur)) lineSev.set(id, f.severity);
  }
  const vitalFlag = (k: string) => a.findings.some((f) => f.ruleId.startsWith('VIT') && f.title.toLowerCase().includes(k));
  const vit: [string, string, boolean][] = [
    ['Temp', v.temp ? `${v.temp}°` : '—', vitalFlag('temperature') || vitalFlag('fever')],
    ['Pulse', v.pulse ? `${v.pulse}` : '—', vitalFlag('pulse') || vitalFlag('tachy')],
    ['BP', v.bpSys ? `${v.bpSys}/${v.bpDia}` : '—', vitalFlag('bp') || vitalFlag('hypotens')],
    ['RR', v.rr ? `${v.rr}` : '—', vitalFlag('rr ') || vitalFlag('respiratory')],
    ['SpO₂', v.spo2 ? `${v.spo2}%` : '—', false],
    ['Weight', v.weight ? `${v.weight} kg` : '—', vitalFlag('weight')],
  ];
  const grouped = AREAS.map((ar) => [ar, a.findings.filter((f) => f.area === ar)] as const).filter(([, fs]) => fs.length);
  // Quickest, surest fixes first: always-rejected items, then drug/diagnosis and coding, then the rest.
  const ORDER = ['Always-rejected items', 'Drug ↔ Diagnosis', 'ICD coding quality', 'Diagnosis ↔ Service', 'Follow-up & duplicates', 'Drug safety & interactions', 'Vital signs ↔ History', 'Severity / Justification', 'Missing medical data'];
  const must = a.findings.filter((f) => f.severity === 'critical' || f.severity === 'high').sort((x, y) => ORDER.indexOf(x.area) - ORDER.indexOf(y.area));
  const reviewItems = a.findings.filter((f) => f.severity === 'medium');
  const lineById = new Map(c.lines.map((l) => [l.id, l]));
  const watchLines = new Set(a.findings.filter((f) => f.area === 'Always-rejected items').flatMap((f) => f.lineIds ?? []));
  const [tab, setTab] = useState<'fix' | 'why' | 'record'>('fix');
  void view;

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card-head" style={{ marginBottom: 0 }}>
        <div>
          <h2>{c.patientName || `MRN ${c.mrn}`}</h2>
          <span className="muted" style={{ fontSize: 13 }}><span className="mono">File {c.mrn}</span> · {c.ageText} {c.gender} · {c.serviceDate} · {c.physician}</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          {reviewed ? <span className="flag-chip done">✓ Reviewed</span> : <Sev s={a.worst} />}
          <div className="num faint" style={{ marginTop: 4, fontSize: 12 }}>{sar(a.amountAtRisk, 2)} at risk</div>
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'fix'} onClick={() => setTab('fix')}>Fix now{must.length ? ` (${must.length})` : ''}</button>
        <button role="tab" aria-selected={tab === 'why'} onClick={() => setTab('why')}>Explanation & notes</button>
        <button role="tab" aria-selected={tab === 'record'} onClick={() => setTab('record')}>Clinical record</button>
      </div>

      {tab === 'fix' && (
        <>
          {must.length === 0 && <div className="ready">✓ Nothing must be changed on this claim.{reviewItems.length ? ` ${reviewItems.length} item(s) to review below.` : ' Ready to submit.'}</div>}
          {must.length > 0 && (
            <ol className="fix-list">
              {must.map((f) => {
                const lines = (f.lineIds ?? []).map((id) => lineById.get(id)).filter(Boolean);
                const watch = f.area === 'Always-rejected items';
                return (
                  <li key={f.id} className={watch ? 'watch' : ''}>
                    <div className="fix-title">{watch ? <span className="watch-badge">⛔</span> : null}{f.title}</div>
                    {lines.length > 0 && !watch && <div className="fix-line">{lines.map((l) => l!.desc).join(' · ')}</div>}
                    <div className="fix-do"><b>Change:</b> {f.fix}</div>
                  </li>
                );
              })}
            </ol>
          )}
          {reviewItems.length > 0 && (
            <details className="review-box">
              <summary>Also review ({reviewItems.length}) – not blocking</summary>
              <ul className="list" style={{ fontSize: 13, marginTop: 8 }}>{reviewItems.map((f) => <li key={f.id}><b>{f.title}</b> – {f.fix}</li>)}</ul>
            </details>
          )}
          <div className="filters">
            {marked && <button className="btn small primary" onClick={() => setReview([c.id], reviewed ? 'open' : 'reviewed')}>{reviewed ? 'Reopen' : '✓ Mark as fixed / reviewed'}</button>}
            {a.findings.length > 0 && <CopyButton text={doctorQuery(a)} label="Copy message to doctor" />}
          </div>
        </>
      )}

      {tab === 'why' && (
        <div>
          {a.findings.length === 0 && <p className="muted">No findings – this claim is ready to submit.</p>}
          {grouped.map(([area, fs]) => (
            <div key={area} style={{ marginTop: 6 }}>
              <h3 style={{ fontSize: 13, color: 'var(--ink-2)' }}>{area}</h3>
              {fs.map((f) => <FindingView key={f.id} f={f} />)}
            </div>
          ))}
        </div>
      )}

      {tab === 'record' && (
        <>
          <div className="vitals" aria-label="Vital signs">
            {vit.map(([k, val, bad]) => (
              <div key={k} className={`vital ${bad ? 'bad' : ''} ${val === '—' ? 'missing' : ''}`}><div className="k">{k}</div><div className="v">{val}</div></div>
            ))}
          </div>
          <div>
            <span className="eyebrow">History / chief complaint</span>
            <p className="history" style={{ marginTop: 6 }}>{c.history ? highlight(c.history) : <span className="faint">No history recorded.</span>}</p>
            {c.examination && <p className="history" style={{ marginTop: 6 }}><b>Examination: </b>{c.examination}</p>}
            {c.plan && <p className="history" style={{ marginTop: 6 }}><b>Plan: </b>{c.plan}</p>}
            {c.lmp && <p className="faint" style={{ marginTop: 6 }}>LMP {c.lmp}</p>}
          </div>
          <div>
            <span className="eyebrow">Diagnoses</span>
            <dl className="kv" style={{ marginTop: 6 }}>
              {c.diagnoses.length ? c.diagnoses.map((d) => <Fragment key={d.code}><dt><span className="code">{d.code}</span></dt><dd>{d.desc}</dd></Fragment>) : <dd className="faint">No diagnosis coded</dd>}
            </dl>
          </div>
          <div>
            <span className="eyebrow">Services billed</span>
            <div className="table-wrap" style={{ marginTop: 6 }}>
              <table>
                <thead><tr><th>Service</th><th className="r">Qty</th><th className="r">Net</th><th>Flag</th></tr></thead>
                <tbody>
                  {c.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{watchLines.has(l.id) && <span className="watch-badge" title="Always rejected">⛔ </span>}{l.desc}<br /><span className="faint mono" style={{ fontSize: 11 }}>{l.category} · {l.code}{l.tooth ? ` · tooth ${l.tooth}` : ''}</span></td>
                      <td className="r num">{l.units}</td>
                      <td className="r num">{l.net.toFixed(2)}</td>
                      <td>{lineSev.has(l.id) ? <Sev s={lineSev.get(l.id)!} /> : <span className="faint">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="faint" style={{ fontSize: 12 }}>Claim {c.claimNo} · {c.payer} · {c.specialty} · source {c.sourceFile} · {SECTION_LABEL[c.section ?? 'medical']}</p>
        </>
      )}
    </div>
  );
}

function FindingView({ f }: { f: Finding }) {
  return (
    <div className="finding">
      <span className="stripe" style={{ background: sevColor(f.severity) }} />
      <div className="body">
        <div className="top"><Sev s={f.severity} /><span className="title">{f.title}</span></div>
        <p className="muted" style={{ fontSize: 13 }}>{f.detail}</p>
        {f.suggestedNote && <div className="note-box"><span>Suggested wording (only if true): {f.suggestedNote}</span><CopyButton text={f.suggestedNote} /></div>}
        <span className="refs"><span className="code">{f.ruleId}</span> {f.refs.join(' · ')}</span>
      </div>
    </div>
  );
}
