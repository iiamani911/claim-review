import { useMemo, useState } from 'react';
import { useData } from '../App';
import { checkIndication, type DrugMatch } from '../lib/formulary';
import { AGE_RULES, classesOf, isTopical } from '../lib/kb/drugs';
import { Empty } from '../ui';

const EDIT_LABEL: Record<string, string> = { PA: 'Prior authorisation', QL: 'Quantity limit', MD: 'Specialist prescriber', AGE: 'Age restriction', ST: 'Step therapy', CU: 'Concurrent use', EU: 'Emergency use', PE: 'Protocol', IP: 'Inpatient' };

interface Resolved { input: string; match: DrugMatch | null; how: string }

export default function DrugChecker() {
  const { formulary, formularySource } = useData();
  const [drugs, setDrugs] = useState('3103210658\n06285111001021\nAUGMENTIN 625 mg tablet');
  const [icd, setIcd] = useState('J06.9, R50.9');
  const [pick, setPick] = useState(0);
  const icds = icd.toUpperCase().split(/[\s,;]+/).filter((x) => /^[A-Z]\d{2}/.test(x));
  const resolved: Resolved[] = useMemo(() => {
    if (!formulary) return [];
    return drugs.split('\n').map((s) => s.trim()).filter(Boolean).map((input) => {
      const isCode = /^[\d-]+$/.test(input);
      const m = isCode ? formulary.lookup(input, input, '') : formulary.lookup('', '', input) ?? formulary.search(input, 1)[0] ?? null;
      return { input, match: m, how: m ? m.matchedBy : 'Not resolved' };
    });
  }, [formulary, drugs]);
  if (!formulary) return <div className="card"><Empty title="Drug formulary not loaded">Upload the CHI DDF workbook under All files → Reference data.</Empty></div>;
  const cur = resolved[pick] ?? resolved[0];

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Source: {formularySource}</span>
          <h1>Drug ↔ ICD checker</h1>
          <p>Enter one or more drugs (SFDA register number / service code, GTIN, or trade or scientific name, one per line) and the diagnosis codes. Each drug is resolved to its active ingredient and checked against the CHI formulary indications. An unresolved drug is not assumed incompatible.</p>
        </div>
      </div>
      <div className="form-grid">
        <label>Drugs (one per line)<textarea id="dc-drugs" className="input" rows={4} style={{ width: '100%' }} value={drugs} onChange={(e) => { setDrugs(e.target.value); setPick(0); }} /></label>
        <label>Diagnosis codes (several allowed)<input id="dc-icd" className="input" style={{ width: '100%' }} value={icd} onChange={(e) => setIcd(e.target.value)} placeholder="e.g. J02.9, R50.9" /><span className="hint">{icds.length ? `Checking ${icds.join(', ')}` : 'Enter ICD-10 codes'}</span></label>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Input</th><th>Resolved ingredient</th><th>How resolved</th><th>Result for {icds.join(', ') || '—'}</th></tr></thead>
          <tbody>{resolved.map((r, i) => {
            const chk = r.match ? checkIndication(r.match.ingredient, icds) : null;
            const verdict = !r.match ? <span className="sev sev-low">Unresolved – cannot assess</span>
              : !chk!.listed ? <span className="sev sev-medium">Not in CHI indication list</span>
              : !icds.length ? <span className="faint">enter diagnoses</span>
              : chk!.matched.length ? <span className="sev sev-clean">Indicated: {chk!.matched.map((m) => m.icd).join(', ')}</span>
              : <span className="sev sev-critical">No listed indication matches</span>;
            return (
              <tr key={r.input + i} className="clickable" aria-selected={i === pick} onClick={() => setPick(i)}>
                <td className="mono">{r.input}</td>
                <td>{r.match ? <><b>{r.match.scientific}</b><br /><span className="faint">{r.match.trade}</span></> : <span className="faint">—</span>}</td>
                <td className="muted">{r.how}</td>
                <td>{verdict}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {cur?.match && (() => {
        const m = cur.match;
        const chk = checkIndication(m.ingredient, icds);
        const cls = [...classesOf(m.scientific + ' ' + m.trade)];
        const ages = AGE_RULES.filter((x) => x.re.test(m.scientific));
        return (
          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <span className="eyebrow">{m.ingredient.c || 'Pharmacological class not listed'}</span>
              <h2>{m.scientific}</h2>
              <span className="muted">{m.trade} · {m.form} · {m.route} · ATC {m.atc || '—'} · resolved by {m.matchedBy}</span>
            </div>
            {chk.matched.length > 0 && <p style={{ fontSize: 13 }}><b>Compatibility evidence:</b> {chk.matched.map((x) => `${x.icd} → “${x.indication}”${x.edits ? ` (edits: ${x.edits})` : ''}`).join('; ')}.</p>}
            {cls.length > 0 && <p style={{ fontSize: 13 }}><b>Safety classes used by the audit:</b> {cls.join(', ')}{isTopical(m.trade, m.route) ? ' (topical)' : ''}</p>}
            {ages.length > 0 && <ul className="list" style={{ fontSize: 13 }}>{ages.map((x) => <li key={x.effect}>{x.effect}</li>)}</ul>}
            <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
              <table>
                <thead><tr><th>CHI indication</th><th>ICD-10</th><th>Edits</th></tr></thead>
                <tbody>{m.ingredient.i.map((x) => (
                  <tr key={x[0] + x[1]}>
                    <td>{x[1]}{x[5] ? <span className="faint"> · inpatient</span> : null}{x[3] && <><br /><span className="faint" style={{ fontSize: 11 }}>MDD adult: {x[3]}</span></>}</td>
                    <td><span className="codes">{x[0].split(',').map((c) => <span className="code" key={c} style={icds.some((y) => y.replace('.', '').startsWith(c.replace('.', '')) || c.replace('.', '').startsWith(y.replace('.', ''))) ? { borderColor: 'var(--good)', background: 'var(--good-soft)' } : undefined}>{c}</span>)}</span></td>
                    <td className="muted" style={{ fontSize: 12 }}>{x[2].split(/[,\s]+/).filter(Boolean).map((e) => EDIT_LABEL[e] ?? e).join(', ')}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className="faint" style={{ fontSize: 12 }}>Source: {formularySource}. A missing indication means the formulary does not list it – it is not proof of clinical incompatibility; insurers may still apply their own rules.</p>
          </section>
        );
      })()}
    </>
  );
}
