import { useMemo, useRef, useState } from 'react';
import { useData } from '../App';
import type { FileType, Payer, ReferenceKind } from '../lib/types';
import { PAYERS } from '../lib/types';
import { analyzeFile, analyzeOverlap, blockers, fieldsFor, LAYOUT_LABEL, refresh, setType, type Decision, type Staged } from '../importer';
import { canon } from '../lib/parse';
import { exportBackup, importBackup, type ImportBundle } from '../db';
import { Empty, Icon, int } from '../ui';

const TYPE_LABEL: Record<string, string> = { claims: 'Claims', rejections: 'Rejections', 'reference:price-list': 'Reference – price list', 'reference:approval-list': 'Reference – approval list', 'reference:drug-formulary': 'Reference – CHI drug formulary', 'reference:other': 'Reference – other' };
const typeKey = (t: FileType | null, r?: ReferenceKind) => (t === 'reference' ? `reference:${r ?? 'other'}` : t ?? '');
const fmtBytes = (n?: number) => (n === undefined ? '—' : n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(1)} MB`);

export default function FilesPage() {
  const { focus } = useData();
  const [tab, setTab] = useState<'files' | 'upload' | 'storage'>(focus.tab === 'upload' ? 'upload' : 'files');
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Data management</span>
          <h1>All files</h1>
          <p>Every month of claims and rejections for Bupa and Tawuniya, plus reference data. New files extend the history; repeated uploads and revised files are detected and you decide what happens.</p>
        </div>
        <button className="btn primary" onClick={() => setTab('upload')}><Icon name="upload" />Upload files</button>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'files'} onClick={() => setTab('files')}>Imported files</button>
        <button role="tab" aria-selected={tab === 'upload'} onClick={() => setTab('upload')}>Upload & import</button>
        <button role="tab" aria-selected={tab === 'storage'} onClick={() => setTab('storage')}>Storage & backup</button>
      </div>
      {tab === 'files' && <FileTable />}
      {tab === 'upload' && <Uploader onDone={() => undefined} />}
      {tab === 'storage' && <StoragePanel />}
    </>
  );
}

function FileTable() {
  const { bundles, removeImport, go, ds } = useData();
  const [q, setQ] = useState('');
  const [type, setTypeF] = useState('');
  const [payer, setPayerF] = useState('');
  const [showReplaced, setShowReplaced] = useState(false);
  const [confirm, setConfirm] = useState('');
  const rows = bundles
    .filter((b) => showReplaced || b.meta.status === 'active')
    .filter((b) => !type || typeKey(b.meta.fileType, b.meta.refKind) === type)
    .filter((b) => !payer || (payer === 'Shared' ? !b.meta.payer : b.meta.payer === payer || (!b.meta.payer && b.rows.some((r) => r.payer === payer))))
    .filter((b) => !q || `${b.meta.filename} ${b.meta.periods.join(' ')}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.meta.uploadedAt.localeCompare(a.meta.uploadedAt));
  if (!bundles.length) {
    return <div className="card"><Empty title={ds.isDemo ? 'No files imported yet – the reports show demo data' : 'No files imported yet'}>Use “Upload & import” to add claim exports, payer rejection statements and reference data.</Empty></div>;
  }
  const payerLabel = (b: ImportBundle) => {
    if (b.meta.payer) return b.meta.payer;
    if (b.meta.fileType === 'reference') return 'Shared';
    const set = new Set(b.rows.map((r) => r.payer).filter(Boolean));
    return [...set].join(' + ') || '—';
  };
  return (
    <>
      <div className="filters">
        <input id="files-q" className="input" placeholder="Search file name or period" value={q} onChange={(e) => setQ(e.target.value)} />
        <select id="files-type" className="select" value={type} onChange={(e) => setTypeF(e.target.value)} aria-label="File type">
          <option value="">All types</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select id="files-payer" className="select" value={payer} onChange={(e) => setPayerF(e.target.value)} aria-label="Insurer">
          <option value="">All insurers</option><option>Bupa</option><option>Tawuniya</option><option value="Shared">Shared reference</option>
        </select>
        <label className="muted" style={{ fontSize: 13 }}><input type="checkbox" checked={showReplaced} onChange={(e) => setShowReplaced(e.target.checked)} /> Show replaced versions</label>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>File</th><th>Insurer</th><th>Type</th><th>Period</th><th>Uploaded</th><th className="r">Rows read</th><th className="r">Imported</th><th>Status</th><th>Warnings</th><th /></tr></thead>
          <tbody>
            {rows.map((b) => {
              const m = b.meta;
              const target = m.fileType === 'claims' ? 'audit' : m.fileType === 'rejections' ? 'rejections' : 'rules';
              return (
                <tr key={m.id}>
                  <td style={{ minWidth: 200 }}><b>{m.filename}</b><br /><span className="faint" style={{ fontSize: 12 }}>{LAYOUT_LABEL[m.layout]} · {m.format.toUpperCase()} · header row {m.headerRow}{m.sheet && m.sheet !== m.filename ? ` · sheet ${m.sheet}` : ''}</span></td>
                  <td>{payerLabel(b)}</td>
                  <td>{TYPE_LABEL[typeKey(m.fileType, m.refKind)]}</td>
                  <td className="num">{m.periods.join(', ') || '—'}</td>
                  <td className="num">{m.uploadedAt.slice(0, 16).replace('T', ' ')}</td>
                  <td className="r num">{int(m.rowsRead)}</td>
                  <td className="r num">{int(m.imported)}{m.duplicates ? <><br /><span className="faint">{int(m.duplicates)} dup. skipped</span></> : null}{m.skipped ? <><br /><span className="faint">{int(m.skipped)} skipped</span></> : null}</td>
                  <td>{m.status === 'active' ? <span className="sev sev-clean">Active</span> : <span className="sev sev-low">Replaced</span>}</td>
                  <td style={{ fontSize: 12, maxWidth: 280 }}>{[...m.errors, ...m.warnings].slice(0, 3).map((w) => <div key={w}>• {w}</div>)}{m.errors.length + m.warnings.length === 0 && <span className="faint">None</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {m.status === 'active' && <button className="btn small" onClick={() => go(target, { importId: m.id })}>Open analysis</button>}{' '}
                    {confirm === m.id
                      ? <><button className="btn small" onClick={() => { removeImport(m.id); setConfirm(''); }}>Confirm remove</button> <button className="btn small ghost" onClick={() => setConfirm('')}>Cancel</button></>
                      : <button className="btn small ghost" onClick={() => setConfirm(m.id)} aria-label={`Remove ${m.filename}`}><Icon name="trash" /></button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="faint" style={{ fontSize: 12 }}>Removing an import deletes its stored rows. If it had replaced an earlier version, that version becomes active again.</p>
    </>
  );
}

interface Result { name: string; ok: boolean; lines: string[]; target?: 'audit' | 'rejections' | 'rules'; importId?: string }

function Uploader({ onDone }: { onDone: () => void }) {
  const { bundles, importStaged, go } = useData();
  const [staged, setStaged] = useState<Staged[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const input = useRef<HTMLInputElement>(null);

  async function add(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    const out: Staged[] = [];
    for (const f of [...list]) out.push(...(await analyzeFile(f)));
    setStaged((s) => [...s, ...out]);
    setBusy(false);
    if (input.current) input.current.value = '';
  }
  const update = (key: string, fn: (s: Staged) => Staged) => setStaged((all) => all.map((s) => (s.key === key ? fn(s) : s)));

  async function doImport(s: Staged, d: Decision | 'skip') {
    if (d === 'skip') {
      setResults((r) => [{ name: s.filename, ok: true, lines: ['Not imported – identical to a file already imported.'] }, ...r]);
      setStaged((all) => all.filter((x) => x.key !== s.key));
      return;
    }
    try {
      const b = await importStaged(s, d);
      const m = b.meta;
      setResults((r) => [{
        name: m.filename, ok: true, importId: m.id,
        target: m.fileType === 'claims' ? 'audit' : m.fileType === 'rejections' ? 'rejections' : 'rules',
        lines: [
          `Rows read ${int(m.rowsRead)} · imported ${int(m.imported)} · skipped ${int(m.skipped)} · duplicates not re-imported ${int(m.duplicates)} · errors ${m.errors.length}`,
          `${m.payer ?? m.payerBasis} · ${m.periods.join(', ') || 'no period'}${m.supersedes?.length ? ` · replaced ${m.supersedes.length} earlier import(s)` : ''}`,
          ...m.errors, ...m.warnings,
        ],
      }, ...r]);
      setStaged((all) => all.filter((x) => x.key !== s.key));
      onDone();
    } catch (e) {
      setResults((r) => [{ name: s.filename, ok: false, lines: [`Import failed: ${String(e)}`] }, ...r]);
    }
  }

  return (
    <>
      <div
        className={`drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
      >
        <Icon name="upload" />
        <h2>{busy ? 'Reading files…' : 'Choose files or drop them here'}</h2>
        <p className="muted">HIS claim exports (.xls tab-separated text, .xlsx, .csv), Bupa and Tawuniya rejection statements, price lists, approval lists, CHI DDF. Several files and months at once.</p>
        <input ref={input} id="file-input" type="file" multiple accept=".xls,.xlsx,.csv,.txt,.tsv" hidden onChange={(e) => add(e.target.files)} />
      </div>
      {results.length > 0 && (
        <div className="report" role="status">
          {results.map((r, i) => (
            <div key={i} className={r.ok ? 'ok' : 'bad'}>
              <b>{r.ok ? '✓' : '✗'} {r.name}</b>
              {r.lines.map((l) => <div key={l} style={{ fontSize: 12 }}>{l}</div>)}
              {r.target && r.importId && <button className="btn small" style={{ marginTop: 6 }} onClick={() => go(r.target!, { importId: r.importId })}>Open analysis</button>}
            </div>
          ))}
        </div>
      )}
      {staged.map((s) => <StagedCard key={s.key} s={s} bundles={bundles} update={(fn) => update(s.key, fn)} onImport={(d) => doImport(s, d)} onDiscard={() => setStaged((all) => all.filter((x) => x.key !== s.key))} />)}
    </>
  );
}

function StagedCard({ s, bundles, update, onImport, onDiscard }: { s: Staged; bundles: ImportBundle[]; update: (fn: (s: Staged) => Staged) => void; onImport: (d: Decision | 'skip') => void; onDiscard: () => void }) {
  const fields = fieldsFor(s);
  const block = blockers(s);
  const ov = useMemo(() => (block.length ? null : analyzeOverlap(s, bundles)), [s, bundles, block.length]);
  const [mapOpen, setMapOpen] = useState(block.some((b) => b.startsWith('Map')));
  const [choice, setChoice] = useState<'new-only' | 'replace' | 'add-all' | 'skip' | ''>('');
  const [replaceIds, setReplaceIds] = useState<string[]>([]);
  const defaultChoice = ov?.exactDuplicateOf ? 'skip' : ov && ov.overlapRows ? 'new-only' : 'new-only';
  const ch = choice || defaultChoice;
  const payerFromColumn = s.detection.basis.startsWith('Insurer column') && !s.detection.mixed;
  const preview = s.mapping ? s.records.slice(0, 5).map((r) => ({ rowNo: r.rowNo, c: canon(r.values, s.mapping!) })) : [];
  const previewCols = s.fileType === 'claims' ? ['mrn', 'name', 'payer', 'invoice', 'serviceDate', 'physician', 'category', 'serviceCode', 'serviceDesc', 'net', 'icd1', 'dx2', 'gtin'] : fields ? fields.map((f) => f.key) : [];
  const counts = s.fileType === 'claims' && s.mapping ? s.records.reduce<Record<string, number>>((m, r) => { const k = (r.values[s.mapping!.category] ?? '').trim() || '(blank)'; m[k] = (m[k] ?? 0) + 1; return m; }, {}) : null;
  const invoices = s.fileType === 'claims' && s.mapping?.invoice ? new Set(s.records.map((r) => (r.values[s.mapping!.invoice] ?? '').trim()).filter((x) => x && x !== '-1')).size : null;
  const claimNoMissing = s.fileType === 'claims' && s.mapping?.claimNo ? s.records.filter((r) => ['', '-1'].includes((r.values[s.mapping!.claimNo] ?? '').trim())).length : 0;

  return (
    <section className="card staged" aria-label={`Import preview for ${s.filename}`}>
      <div className="card-head">
        <div>
          <h2>{s.filename}</h2>
          <p>{LAYOUT_LABEL[s.layout]} · detected format {s.format.toUpperCase()} · header on row {s.headerRow || '—'} · {int(s.records.length)} data rows{s.sheet && s.sheet !== s.filename ? ` · sheet “${s.sheet}”` : ''}</p>
        </div>
        <button className="btn small ghost" onClick={onDiscard}><Icon name="close" />Discard</button>
      </div>
      <div className="form-grid">
        <label>File type
          <select className="select" value={typeKey(s.fileType, s.refKind)} onChange={(e) => { const [t, r] = e.target.value.split(':'); update((x) => setType(x, t as FileType, r as ReferenceKind)); }}>
            <option value="" disabled>Choose…</option>
            {Object.entries(TYPE_LABEL).filter(([k]) => k !== 'reference:other').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {!(s.fileType === 'reference' && s.refKind === 'drug-formulary') && (
          <label>{s.detection.mixed ? 'Insurer for rows without a recognised insurer' : 'Insurer'}
            <select className="select" value={s.payer ?? ''} disabled={payerFromColumn} onChange={(e) => update((x) => ({ ...x, payer: (e.target.value || null) as Payer | null }))}>
              <option value="">Choose…</option>
              {PAYERS.map((p) => <option key={p}>{p}</option>)}
            </select>
            <span className="hint">{s.detection.basis}{payerFromColumn ? ' – taken from the file' : ''}</span>
          </label>
        )}
        <label>Reporting period
          <input className="input" placeholder="YYYY-MM" value={s.periodOverride || s.periods.join(', ')} onChange={(e) => update((x) => ({ ...x, periodOverride: /^\d{4}-\d{2}$/.test(e.target.value) ? e.target.value : e.target.value === '' ? '' : x.periodOverride }))} />
          <span className="hint">{s.periods.length ? `Detected from ${s.fileType === 'claims' ? 'service dates' : 'the file'}: ${s.periods.join(', ')}` : 'Not detected – type YYYY-MM'}</span>
        </label>
        {s.fileType === 'reference' && <label>Version / date<input className="input" value={s.version} onChange={(e) => update((x) => ({ ...x, version: e.target.value }))} placeholder="e.g. Contract 2026" /></label>}
      </div>
      {Object.keys(s.detection.counts).length > 0 && s.fileType !== 'reference' && (
        <p className="muted" style={{ fontSize: 13 }}>Insurer values in file: {Object.entries(s.detection.counts).map(([k, v]) => `${k} (${int(v)})`).join(' · ')}</p>
      )}
      {counts && <p className="muted" style={{ fontSize: 13 }}>Rows by category: {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${int(v)}`).join(' · ')}{invoices !== null ? ` · ${int(invoices)} distinct invoices` : ''}{claimNoMissing ? ` · ClaimNo missing/-1 on ${int(claimNoMissing)} rows (encounters are grouped by insurer + MRN + date + physician + encounter type instead)` : ''}</p>}

      {fields && (
        <details open={mapOpen} onToggle={(e) => setMapOpen((e.target as HTMLDetailsElement).open)}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Column mapping ({fields.filter((f) => s.mapping?.[f.key]).length}/{fields.length} mapped{block.some((b) => b.startsWith('Map')) ? ' – required columns missing' : ''})</summary>
          <div className="map-grid">
            {fields.map((f) => (
              <label key={f.key} className={f.required && !s.mapping?.[f.key] ? 'bad' : ''}>
                <span>{f.label}{f.required ? ' *' : ''}</span>
                <select className="select" value={s.mapping?.[f.key] ?? ''} onChange={(e) => update((x) => refresh({ ...x, mapping: { ...(x.mapping ?? {}), [f.key]: e.target.value } }))}>
                  <option value="">— not in file —</option>
                  {s.header.filter(Boolean).map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
        </details>
      )}

      {preview.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Row</th>{previewCols.map((c) => <th key={c}>{fields?.find((f) => f.key === c)?.label ?? c}</th>)}</tr></thead>
            <tbody>{preview.map((p) => <tr key={p.rowNo}><td className="num">{p.rowNo}</td>{previewCols.map((c) => <td key={c} className="mono" style={{ fontSize: 12, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.c[c] ?? ''}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {s.fileType === 'reference' && s.refKind === 'drug-formulary' && s.payload && <p className="muted">CHI DDF parsed: {int(Object.keys(s.payload.ingredients).length)} ingredients, {int(s.payload.products.length)} SFDA products. It will replace the built-in formulary for checks.</p>}

      {block.length > 0 && <div className="report"><div className="bad">{block.map((b) => <div key={b}>• {b}</div>)}</div></div>}
      {ov && (
        <div className="decision">
          {ov.exactDuplicateOf && <p><b>This exact file was already imported</b> ({ov.exactDuplicateOf.filename}, {ov.exactDuplicateOf.uploadedAt.slice(0, 10)}).</p>}
          {!ov.exactDuplicateOf && ov.overlapRows > 0 && <p><b>{int(ov.overlapRows)} of {int(s.records.length)} rows already exist</b> in {ov.overlapping.map((o) => `${o.meta.filename} (${int(o.rows)})`).join(', ')}.</p>}
          {!ov.exactDuplicateOf && !ov.overlapRows && ov.candidatesToReplace.length > 0 && <p><b>Possible revised file:</b> an import with the same name or period exists ({ov.candidatesToReplace.map((m) => m.filename).join(', ')}) but no rows are identical.</p>}
          {ov.withinFileRepeats > 0 && <p className="muted">{int(ov.withinFileRepeats)} identical rows inside this file will be kept as repeated services.</p>}
          <div className="choices" role="radiogroup" aria-label="How to import">
            {ov.exactDuplicateOf && <label><input type="radio" checked={ch === 'skip'} onChange={() => setChoice('skip')} /> Do not import (recommended)</label>}
            <label><input type="radio" checked={ch === 'new-only'} onChange={() => setChoice('new-only')} /> Add records{ov.overlapRows ? `, skipping the ${int(ov.overlapRows)} already imported` : ''}</label>
            {ov.candidatesToReplace.length > 0 && (
              <label><input type="radio" checked={ch === 'replace'} onChange={() => { setChoice('replace'); setReplaceIds(ov.candidatesToReplace.map((m) => m.id)); }} /> Replace earlier import(s) with this file:
                {ch === 'replace' && ov.candidatesToReplace.map((m) => (
                  <span key={m.id} style={{ display: 'block', marginLeft: 22 }}><input type="checkbox" checked={replaceIds.includes(m.id)} onChange={(e) => setReplaceIds((ids) => (e.target.checked ? [...ids, m.id] : ids.filter((x) => x !== m.id)))} /> {m.filename} ({m.periods.join(', ')}, {int(m.imported)} rows)</span>
                ))}
              </label>
            )}
            {ov.overlapRows > 0 && <label><input type="radio" checked={ch === 'add-all'} onChange={() => setChoice('add-all')} /> Add all rows as distinct records (will count overlapping rows twice)</label>}
          </div>
        </div>
      )}
      <div className="filters">
        <button className="btn primary" disabled={block.length > 0 || (ch === 'replace' && !replaceIds.length)} onClick={() => onImport(ch === 'skip' ? 'skip' : ch === 'replace' ? { mode: 'replace', replaceIds } : { mode: ch as 'new-only' | 'add-all' })}>
          {ch === 'skip' ? 'Skip this file' : 'Confirm and import'}
        </button>
        <span className="faint" style={{ fontSize: 12 }}>Original file name, row numbers, insurer, period and cell values are stored with every record.</span>
      </div>
    </section>
  );
}

function StoragePanel() {
  const { storage, bundles, reload } = useData();
  const [msg, setMsg] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const rows = bundles.reduce((s, b) => s + b.rows.length, 0);
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2>Where your data is stored</h2>
      <ul className="list" style={{ fontSize: 13 }}>
        <li>Imports are saved in this browser’s local database (IndexedDB) on this device: {int(bundles.length)} imports, {int(rows)} stored rows, about {fmtBytes(storage.usage)} used{storage.quota ? ` of ${fmtBytes(storage.quota)} available` : ''}.</li>
        <li>They remain after refreshing or reopening the page in the same browser profile. {storage.persisted ? 'The browser granted persistent storage, so it will not evict the data automatically.' : 'The browser has not granted persistent storage; under severe disk pressure it may evict site data.'}</li>
        <li>They are <b>not</b> shared with colleagues, other browsers or other devices, and are deleted if this site’s data is cleared (browser settings, private/incognito windows, some managed-device policies).</li>
        <li>Nothing is uploaded to a server. Keep a backup file after each monthly import if this browser is your only copy.</li>
      </ul>
      <div className="filters">
        <button className="btn" onClick={async () => {
          try {
            const blob = new Blob([await exportBackup()], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `WAD_claim_review_backup_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            setMsg('Backup file created. If no download appears, this viewer blocks downloads – run the app locally to back up.');
          } catch (e) { setMsg(`Backup failed: ${String(e)}`); }
        }}><Icon name="download" />Download backup</button>
        <button className="btn" onClick={() => file.current?.click()}><Icon name="upload" />Restore from backup</button>
        <input ref={file} type="file" accept=".json" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try { const n = await importBackup(await f.text()); await reload(); setMsg(`Restored ${n} import(s) that were not already present.`); } catch (err) { setMsg(`Restore failed: ${String(err)}`); }
        }} />
      </div>
      {msg && <p className="muted">{msg}</p>}
    </section>
  );
}
