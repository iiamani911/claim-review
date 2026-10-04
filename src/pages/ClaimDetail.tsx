import { Fragment, type ReactNode } from 'react';
import type { ClaimAudit, Finding, Severity } from '../lib/types';
import { AREAS, SEVERITY_ORDER, type AuditView } from '../lib/engine';
import { useData } from '../App';
import { SECTION_LABEL } from '../store';
import { TERMS, negatedAt } from '../lib/text';
import { CopyButton, Score, Sev, sar, sevColor } from '../ui';

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

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card-head" style={{ marginBottom: 0 }}>
        <div>
          <span className="eyebrow">Claim {c.claimNo} · {c.serviceDate} · {c.payer}</span>
          <h2 style={{ marginTop: 4 }}>{c.patientName || `MRN ${c.mrn}`}</h2>
          <span className="muted">{c.ageText} {c.gender === 'M' ? 'male' : c.gender === 'F' ? 'female' : ''} · MRN {c.mrn} · {c.physician} ({c.specialty})</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <Sev s={a.worst} />
          <div style={{ marginTop: 6 }}><Score score={a.score} /></div>
          <div className="num" style={{ marginTop: 4 }}>{sar(a.amountAtRisk, 2)} at risk</div>
        </div>
      </div>

      {marked && (
        <div className={`marker ${reviewed ? 'done' : ''}`} role="status">
          <span className="marker-flag">{reviewed ? '✓' : '⚑'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{reviewed ? 'Reviewed' : 'This file should be reviewed'}</b>
            <div className="mono" style={{ fontSize: 13 }}>File {c.mrn} · {c.patientName || 'name not recorded'} · Claim {c.claimNo}</div>
            <span className="faint" style={{ fontSize: 12 }}>{SECTION_LABEL[c.section ?? 'medical']}{view === 'technical' ? ' · technical findings' : view === 'medical' ? ' · medical findings' : ''}{reviewed ? ` · marked reviewed ${review[c.id].at.slice(0, 10)}` : ''}</span>
          </div>
          <button className="btn small" onClick={() => setReview([c.id], reviewed ? 'open' : 'reviewed')}>{reviewed ? 'Reopen' : 'Mark reviewed'}</button>
        </div>
      )}

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
            <thead><tr><th>Service</th><th>Category</th><th className="r">Qty</th><th className="r">Net</th><th>Flag</th></tr></thead>
            <tbody>
              {c.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.desc}<br /><span className="faint mono" style={{ fontSize: 11 }}>{l.code}{l.tooth ? ` · tooth ${l.tooth}` : ''}</span></td>
                  <td className="muted">{l.category}</td>
                  <td className="r num">{l.units}</td>
                  <td className="r num">{l.net.toFixed(2)}</td>
                  <td>{lineSev.has(l.id) ? <Sev s={lineSev.get(l.id)!} /> : <span className="faint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="card-head" style={{ marginBottom: 4 }}>
          <span className="eyebrow">Findings ({a.findings.length})</span>
          {a.findings.length > 0 && <CopyButton text={doctorQuery(a)} label="Copy doctor query" />}
        </div>
        {a.findings.length === 0 && <p className="muted">No findings – this claim is ready to submit.</p>}
        {grouped.map(([area, fs]) => (
          <div key={area} style={{ marginTop: 10 }}>
            <h3 style={{ fontSize: 13, color: 'var(--ink-2)' }}>{area}</h3>
            {fs.map((f) => <FindingView key={f.id} f={f} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function FindingView({ f }: { f: Finding }) {
  return (
    <div className="finding">
      <span className="stripe" style={{ background: sevColor(f.severity) }} />
      <div className="body">
        <div className="top"><Sev s={f.severity} /><span className="code">{f.ruleId}</span><span className="title">{f.title}</span>{f.amountAtRisk > 0 && <span className="num faint">{sar(f.amountAtRisk, 2)}</span>}</div>
        <p className="muted" style={{ fontSize: 13 }}>{f.detail}</p>
        <p className="fix"><b>Fix: </b>{f.fix}</p>
        {f.suggestedNote && <div className="note-box"><span>{f.suggestedNote}</span><CopyButton text={f.suggestedNote} /></div>}
        <span className="refs">{f.refs.join(' · ')}</span>
      </div>
    </div>
  );
}
