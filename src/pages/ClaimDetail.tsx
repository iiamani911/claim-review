import { Fragment, type ReactNode } from 'react';
import type { ClaimAudit, Finding, FindingKind, Severity } from '../lib/types';
import { AREAS, SEVERITY_ORDER } from '../lib/engine';
import { ruleType } from '../lib/kb/rules';
import { useData } from '../App';
import { TERMS, negatedAt } from '../lib/text';
import { CopyButton, Score, Sev, sar, sevColor } from '../ui';

export const KIND_LABEL: Record<FindingKind, string> = {
  'data-error': 'Confirmed data error',
  'missing-documentation': 'Missing documentation',
  'clinical-concern': 'Possible clinical concern',
  'historical-pattern': 'Historical rejection pattern',
  'unable-to-verify': 'Unable to verify / needs review',
};

const HIGHLIGHT = new RegExp([TERMS.feverPos.source, TERMS.afebrile.source, TERMS.trauma.source, TERMS.severeOnly.source, TERMS.duration.source, TERMS.pregnant.source, TERMS.tachypnea.source, TERMS.dehydration.source, TERMS.workPositive.source].join('|'), 'gi');

function highlight(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(HIGHLIGHT)) {
    if (!m[0].trim()) continue;
    const i = m.index ?? 0;
    out.push(text.slice(last, i));
    const neg = negatedAt(text, i);
    out.push(<mark key={i} className={neg ? 'neg' : undefined} title={neg ? 'negated (denied / absent)' : undefined}>{m[0]}</mark>);
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
    `${c.payer} claim – ${c.patientName || ''} (MRN ${c.mrn}), visit ${c.serviceDate}, ICD ${c.diagnoses.map((d) => d.code).join(', ') || 'none'}.`,
    'Before submission, please review (suggestions only – confirm clinically before changing anything):',
    ...items.map((f, i) => `${i + 1}. [${f.severity.toUpperCase()}] ${f.title}\n   Suggested action: ${f.fix}${f.suggestedNote ? `\n   Possible note wording (only if true): "${f.suggestedNote}"` : ''}`),
    '',
    'Insurance office, WAD Clinic.',
  ].join('\n');
}

export default function ClaimDetail({ a }: { a: ClaimAudit }) {
  const c = a.claim;
  const { kv, setReview } = useData();
  const flagged = a.findings.some((f) => f.severity === 'critical' || f.severity === 'high');
  const reviewed = kv.review[c.id]?.status === 'reviewed';
  const v = c.vitals;
  const lineSev = new Map<string, Severity>();
  for (const f of a.findings) for (const id of f.lineIds ?? []) {
    const cur = lineSev.get(id);
    if (!cur || SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(cur)) lineSev.set(id, f.severity);
  }
  const vit: [string, string][] = [
    ['Temp', v.temp ? `${v.temp}°` : '—'], ['Pulse', v.pulse ? `${v.pulse}` : '—'], ['BP', v.bpSys ? `${v.bpSys}/${v.bpDia}` : '—'], ['RR', v.rr ? `${v.rr}` : '—'], ['SpO₂', v.spo2 ? `${v.spo2}%` : '—'], ['Weight', v.weight ? `${v.weight} kg` : '—'],
  ];
  const lineById = new Map(c.lines.map((l) => [l.id, l]));
  const grouped = AREAS.map((ar) => [ar, a.findings.filter((f) => f.area === ar)] as const).filter(([, fs]) => fs.length);

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card-head" style={{ marginBottom: 0 }}>
        <div>
          <span className="eyebrow">{c.payer} · visit {c.serviceDate} · {c.encounterType === 'I' ? 'inpatient' : 'outpatient'}</span>
          <h2 style={{ marginTop: 4 }}>{c.patientName || `MRN ${c.mrn}`}</h2>
          <span className="muted">MRN <span className="mono">{c.mrn || '—'}</span> · {c.ageText} {c.gender === 'M' ? 'male' : c.gender === 'F' ? 'female' : ''} · {c.physician} ({c.specialty}){c.approvalNo ? ` · approval ${c.approvalNo}` : ' · no approval no.'}</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <Sev s={a.worst} />
          <div style={{ marginTop: 6 }}><Score score={a.score} /></div>
          <div className="num" style={{ marginTop: 4 }}>{sar(a.amountAtRisk, 2)} at risk</div>
        </div>
      </div>

      {flagged && (
        <div className={`marker ${reviewed ? 'done' : ''}`} role="status">
          <span className="marker-flag">{reviewed ? '✓' : '⚑'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{reviewed ? 'Reviewed' : 'This encounter should be reviewed'}</b>
            <div className="mono" style={{ fontSize: 13 }}>MRN {c.mrn} · {c.patientName || 'name not recorded'} · invoices {c.invoices.join(', ') || '—'}</div>
          </div>
          <button className="btn small" onClick={() => setReview([c.id], reviewed ? 'open' : 'reviewed')}>{reviewed ? 'Reopen' : 'Mark reviewed'}</button>
        </div>
      )}

      <p className="faint" style={{ fontSize: 12 }}>Source: {c.sourceFile} · rows {c.lines.map((l) => l.rowNo).join(', ')} · grouped by {c.groupingBasis}{c.claimNo ? ` · HIS ClaimNo ${c.claimNo}` : ' · HIS ClaimNo not provided (-1)'}</p>
      {c.groupingWarnings.length > 0 && <div className="banner" style={{ fontSize: 13 }}>Grouping needs review: {c.groupingWarnings.join('; ')}.</div>}

      <div className="vitals" aria-label="Vital signs">
        {vit.map(([k, val]) => <div key={k} className={`vital ${val === '—' ? 'missing' : ''}`}><div className="k">{k}</div><div className="v">{val}</div></div>)}
      </div>

      <div>
        <span className="eyebrow">Chief complaint / history (as documented)</span>
        <p className="history" style={{ marginTop: 6 }}>{c.history ? highlight(c.history) : <span className="faint">No history recorded.</span>}</p>
        {c.examination && <p className="history" style={{ marginTop: 6 }}><b>Examination: </b>{c.examination}</p>}
        {c.plan && <p className="history" style={{ marginTop: 6 }}><b>Plan: </b>{c.plan}</p>}
        {c.lmp && <p className="faint" style={{ marginTop: 6 }}>LMP {c.lmp}</p>}
      </div>

      <div>
        <span className="eyebrow">Diagnoses (all diagnosis columns)</span>
        <dl className="kv" style={{ marginTop: 6 }}>
          {c.diagnoses.length ? c.diagnoses.map((d) => <Fragment key={d.code}><dt><span className="code">{d.code}</span></dt><dd>{d.desc || <span className="faint">no description</span>} <span className="faint" style={{ fontSize: 11 }}>({d.column})</span></dd></Fragment>) : <dd className="faint">No diagnosis coded</dd>}
        </dl>
      </div>

      <div>
        <span className="eyebrow">Billing lines</span>
        <div className="table-wrap" style={{ marginTop: 6 }}>
          <table>
            <thead><tr><th>Row</th><th>Service / medication</th><th>Invoice</th><th className="r">Qty</th><th className="r">Net</th><th>Flag</th></tr></thead>
            <tbody>
              {c.lines.map((l) => (
                <tr key={l.id}>
                  <td className="num">{l.rowNo}</td>
                  <td>{l.desc}<br /><span className="faint mono" style={{ fontSize: 11 }}>{l.category} · {l.code}{l.gtin ? ` · GTIN ${l.gtin}` : ''}{l.tooth ? ` · tooth ${l.tooth}` : ''}</span></td>
                  <td className="mono" style={{ fontSize: 12 }}>{l.invoice}</td>
                  <td className="r num">{l.units}</td>
                  <td className="r num">{l.net.toFixed(2)}{l.netVat ? <><br /><span className="faint">VAT {l.netVat.toFixed(2)}</span></> : null}</td>
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
        {a.findings.length === 0 && <p className="muted">No findings from the checks that could run.</p>}
        {grouped.map(([area, fs]) => (
          <div key={area} style={{ marginTop: 10 }}>
            <h3 style={{ fontSize: 13, color: 'var(--ink-2)' }}>{area}</h3>
            {fs.map((f) => <FindingView key={f.id} f={f} lines={(f.lineIds ?? []).map((id) => lineById.get(id)).filter(Boolean) as typeof c.lines} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function FindingView({ f, lines }: { f: Finding; lines: ClaimAudit['claim']['lines'] }) {
  return (
    <div className="finding">
      <span className="stripe" style={{ background: sevColor(f.severity) }} />
      <div className="body">
        <div className="top"><Sev s={f.severity} /><span className="tag">{KIND_LABEL[f.kind]}</span><span className="code">{f.ruleId}</span><span className="title">{f.title}</span></div>
        {lines.length > 0 && <p className="faint" style={{ fontSize: 12 }}>Affects: {lines.map((l) => `row ${l.rowNo} – ${l.desc}`).join('; ')}{f.amountAtRisk > 0 ? ` · ${sar(f.amountAtRisk, 2)}` : ''}</p>}
        <p className="muted" style={{ fontSize: 13 }}>{f.detail}</p>
        {f.evidence && <p style={{ fontSize: 12 }}><b>Evidence:</b> {f.evidence}</p>}
        <p className="fix"><b>Suggested action (review manually): </b>{f.fix}</p>
        {f.suggestedNote && <div className="note-box"><span>Only if clinically true: {f.suggestedNote}</span><CopyButton text={f.suggestedNote} /></div>}
        <span className="refs">{ruleType(f.ruleId)} · scope {f.scope === 'Shared' ? 'shared (Bupa and Tawuniya)' : f.scope} · {f.refs.join(' · ')}</span>
      </div>
    </div>
  );
}
