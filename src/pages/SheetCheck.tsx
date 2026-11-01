import { useMemo, useState } from 'react';
import { useData } from '../App';
import type { ClaimAudit, Section } from '../lib/types';
import { CATS, CAT_ORDER, LEVEL_LABEL, checkSheet, type Cat, type SheetCheck, type SheetRow } from '../lib/precheck';
import { autoFix, type Change } from '../lib/autofix';
import { auditAll } from '../lib/engine';
import { buildClaims } from '../lib/parse';
import { FIXED, exportChecked, exportCorrected } from '../lib/exportChecked';
import { Empty, Icon, int } from '../ui';

/** Key columns shown on screen (every original column is in the Excel file). */
const KEY: { label: string; field: string; mono?: boolean; wide?: boolean }[] = [
  { label: 'File No', field: 'mrn', mono: true },
  { label: 'Patient', field: 'name' },
  { label: 'Claim', field: 'claim', mono: true },
  { label: 'Date', field: 'date', mono: true },
  { label: 'Doctor', field: 'physician' },
  { label: 'Member ID', field: 'member', mono: true },
  { label: 'ICD', field: 'icd', mono: true },
  { label: 'Service code', field: 'code', mono: true },
  { label: 'Service', field: 'service', wide: true },
  { label: 'Qty', field: 'units' },
  { label: 'Billed', field: 'amount' },
  { label: 'Approval', field: 'approval', mono: true },
  { label: 'Temp', field: 'temp' },
  { label: 'BP', field: 'bp' },
  { label: 'Pulse', field: 'pulse' },
  { label: 'RR', field: 'rr' },
  { label: 'Weight', field: 'weight' },
  { label: 'History', field: 'history', wide: true },
];

const PAGE = 300;

export default function SheetCheckView({ section, autofix = false }: { section: Section; autofix?: boolean }) {
  const { files, audits, formulary, watch } = useData();
  const sources = useMemo(() => files.filter((f) => f.section === section && f.kind === 'claims' && f.records.length), [files, section]);
  const byId = useMemo(() => new Map<string, ClaimAudit>(audits.map((a) => [a.claim.id, a])), [audits]);
  // With auto-correction the corrected rows are audited again, so only the problems that remain are coloured.
  const fixed = useMemo(() => sources.map((f) => (autofix ? autoFix(f.header, f.records) : { records: f.records, changes: [] as Change[] })), [sources, autofix]);
  const checks = useMemo(() => sources.map((f, k) => {
    let map = byId;
    if (autofix) {
      const claims = buildClaims(fixed[k].records, f.name).map((c) => ({ ...c, id: `${f.section}:${c.id}`, section: f.section, sourceFileId: f.id }));
      map = new Map(auditAll(claims, formulary, watch).map((a) => [a.claim.id, a]));
    }
    return checkSheet({ name: f.name, section: f.section, header: f.header, records: fixed[k].records }, map);
  }), [sources, fixed, byId, autofix, formulary, watch]);

  const [fi, setFi] = useState(0);
  const [cats, setCats] = useState<Set<Cat>>(new Set());
  const [level, setLevel] = useState<'all' | 'must' | 'review' | 'problems' | 'fixed'>('must');
  const [q, setQ] = useState('');
  const [allCols, setAllCols] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const k = Math.min(fi, checks.length - 1);
  const ch: SheetCheck | undefined = checks[k];
  const changes = useMemo(() => {
    const m = new Map<number, Change[]>();
    for (const x of fixed[k]?.changes ?? []) m.set(x.row, [...(m.get(x.row) ?? []), x]);
    return m;
  }, [fixed, k]);
  const rows = useMemo(() => {
    if (!ch) return [];
    const t = q.trim().toLowerCase();
    return ch.rows.filter((r) =>
      (level === 'all' || (level === 'fixed' ? changes.has(r.i) : level === 'problems' ? r.issues.length > 0 : r.level === level)) &&
      (!cats.size || r.issues.some((x) => cats.has(x.cat))) &&
      (!t || r.cells.join(' ').toLowerCase().includes(t)));
  }, [ch, level, cats, q, changes]);

  if (!ch) return <div className="card"><Empty title="Upload a file to start analysis.">Upload the sheet you are about to send to the insurance portal. Every row is checked and coloured by type of mistake, with a short correction{autofix ? '; data-entry mistakes in vital signs and codes are corrected automatically' : ''}.</Empty></div>;

  const total = CAT_ORDER.reduce((s, c) => s + ch.counts[c], 0);
  const problemRows = ch.rows.filter((r) => r.issues.length).length;
  const toggle = (c: Cat) => { const n = new Set(cats); if (n.has(c)) n.delete(c); else n.add(c); setCats(n); setLimit(PAGE); };
  const cols = allCols
    ? ch.header.map((h, i) => ({ label: h, idx: [i], mono: false, wide: h.length > 0 && /complaint|history|desc|note/i.test(h) }))
    : KEY.map((k) => ({ label: k.label, idx: ch.colsOf(k.field), mono: !!k.mono, wide: !!k.wide })).filter((k) => k.idx.length);

  return (
    <>
      <div className="stat-strip">
        {checks.length > 1 && (
          <select className="select" value={fi} onChange={(e) => { setFi(+e.target.value); setLimit(PAGE); }} aria-label="Sheet">
            {checks.map((c, i) => <option key={c.name + i} value={i}>{c.name}</option>)}
          </select>
        )}
        <span className="stat"><b className="num">{int(ch.rows.length)}</b> rows · {int(ch.encounters)} claims</span>
        <button className={`stat ${level === 'must' ? 'on' : ''}`} onClick={() => setLevel('must')}><span className="dot crit" /><b className="num">{int(ch.mustRows)}</b> rows must fix</button>
        <button className={`stat ${level === 'problems' ? 'on' : ''}`} onClick={() => setLevel('problems')}><b className="num">{int(problemRows)}</b> rows with problems · {int(total)} problems</button>
        {autofix && <button className={`stat ${level === 'fixed' ? 'on' : ''}`} onClick={() => setLevel('fixed')} title="Values corrected automatically"><span className="dot" style={{ background: `#${FIXED.fill}` }} /><b className="num">{int(fixed[k].changes.length)}</b> auto-corrected in {int(changes.size)} rows</button>}
        <button className={`stat ${level === 'all' ? 'on' : ''}`} onClick={() => setLevel('all')}>Show all rows</button>
        <span style={{ flex: 1 }} />
        {autofix && <button className="btn small" onClick={() => exportCorrected(ch.header, fixed[k].records, `${ch.name.replace(/\.[a-z]+$/i, '')}_corrected.xlsx`)} title="Original columns with the automatic corrections applied – no colours"><Icon name="download" />Corrected file only</button>}
        <button className="btn small primary" onClick={() => exportChecked(checks, autofix ? 'WAD_corrected_and_highlighted.xlsx' : 'WAD_checked_sheet.xlsx', autofix ? fixed.map((x) => x.changes) : undefined)}><Icon name="download" />Download {autofix ? 'corrected + highlighted' : 'highlighted'} sheet</button>
      </div>

      <div className="cat-legend" role="group" aria-label="Problem types">
        {CAT_ORDER.map((c) => (
          <button key={c} className="cat-chip" aria-pressed={cats.has(c)} onClick={() => toggle(c)} title={CATS[c].covers} style={{ background: `#${CATS[c].fill}`, color: `#${CATS[c].ink}` }}>
            {CATS[c].label} <b className="num">{int(ch.counts[c])}</b>
          </button>
        ))}
        {cats.size > 0 && <button className="btn small ghost" onClick={() => setCats(new Set())}>Clear</button>}
      </div>

      <div className="filters">
        <input className="input" placeholder="Search file no, patient, code, service…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
        <div className="seg" role="group" aria-label="Columns">
          <button aria-pressed={!allCols} onClick={() => setAllCols(false)}>Key columns</button>
          <button aria-pressed={allCols} onClick={() => setAllCols(true)}>All columns</button>
        </div>
        <span className="faint" style={{ fontSize: 12 }}>Coloured cell = where the mistake is{autofix ? '; dark green = corrected automatically' : ''}. Hover it for details.</span>
      </div>

      {rows.length ? (
        <div className="table-wrap sheet-wrap">
          <table className="sheet">
            <thead>
              <tr>
                <th className="sticky-a">Row</th>
                <th className="sticky-b">Status</th>
                {autofix && <th className="fix-col">Auto-corrected</th>}
                <th className="fix-col">Suggested correction</th>
                <th className="prob-col">Problems found</th>
                {cols.map((c, i) => <th key={i}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>{rows.slice(0, limit).map((r) => <SheetLine key={r.i} r={r} cols={cols} fixes={autofix ? changes.get(r.i) ?? [] : undefined} />)}</tbody>
          </table>
        </div>
      ) : <div className="card"><Empty title={level === 'must' ? 'No row must be fixed' : 'No rows match'}>{level === 'must' ? 'Nothing will be rejected for certain in this sheet. Check the Review rows.' : 'Clear a filter or search.'}</Empty></div>}
      {rows.length > limit && <p style={{ marginTop: 10 }}><button className="btn small" onClick={() => setLimit(limit + PAGE)}>Show {int(Math.min(PAGE, rows.length - limit))} more of {int(rows.length - limit)}</button></p>}
    </>
  );
}

function SheetLine({ r, cols, fixes }: { r: SheetRow; cols: { label: string; idx: number[]; mono: boolean; wide: boolean }[]; fixes?: Change[] }) {
  return (
    <tr>
      <td className="sticky-a num faint">{r.i + 2}</td>
      <td className="sticky-b">{r.level ? <span className={`lvl lvl-${r.level}`}>{LEVEL_LABEL[r.level]}</span> : <span className="lvl lvl-ok">OK</span>}</td>
      {fixes && <td className="fix-col">{fixes.map((x, k) => <div key={k} className="auto-item" title={x.why}>✓ {x.column}: <s>{x.from || 'empty'}</s> → <b>{x.to}</b></div>)}</td>}
      <td className="fix-col">{[...new Set(r.issues.map((x) => x.fix))].map((f, k) => {
        const is = r.issues.find((x) => x.fix === f)!;
        return <div key={k} className="fix-item" style={{ borderLeftColor: `#${CATS[is.cat].ink}` }}>{f}</div>;
      })}</td>
      <td className="prob-col">{r.issues.map((x, k) => (
        <div key={k} className="prob-item"><span className="cat-dot" style={{ background: `#${CATS[x.cat].ink}` }} title={CATS[x.cat].label} />{x.text}</div>
      ))}</td>
      {cols.map((c, k) => {
        const cat = c.idx.map((i) => r.marks.get(i)).find(Boolean);
        const fx = fixes?.find((x) => c.idx.includes(x.col));
        const v = c.idx.map((i) => r.cells[i]).filter(Boolean).join(', ');
        const why = [fx ? `Auto-corrected – was: ${fx.from || 'empty'} (${fx.why})` : '', ...(cat ? r.issues.filter((x) => x.cols.some((i) => c.idx.includes(i))).map((x) => `${x.text} → ${x.fix}`) : [])].filter(Boolean).join('\n') || undefined;
        return (
          <td key={k} className={`${c.mono ? 'mono' : ''} ${c.wide ? 'wide' : ''}`} title={why ?? (c.wide ? v : undefined)}
            style={cat ? { background: `#${CATS[cat].fill}`, color: `#${CATS[cat].ink}`, fontWeight: 600 } : fx ? { background: `#${FIXED.fill}`, color: `#${FIXED.ink}`, fontWeight: 700 } : undefined}>
            {c.wide && v.length > 90 ? `${v.slice(0, 90)}…` : v || (cat ? '— missing —' : '')}
          </td>
        );
      })}
    </tr>
  );
}
