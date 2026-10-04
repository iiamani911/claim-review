import { useRef, useState } from 'react';
import { useData } from './App';
import type { Section } from './lib/types';
import { ingestFile, SECTION_LABEL } from './store';
import { Icon, int } from './ui';

const HELP: Record<Section, string> = {
  medical: 'Drop the HIS claim export (output.xls) for claims you are about to submit. Every encounter is audited medically.',
  rejection: 'Drop the payer statements (Tawuniya / Waseel, Bupa CLPROVSTM…) and the HIS export of the rejected claims. Rejected claims get the same full medical audit to show the root cause.',
  technical: 'Drop the HIS export for the technical audit. Price-list, contract and pre-authorisation rules will be added when you send the technical data.',
};

/** Upload area bound to one section: files dropped here are treated according to that section. */
export default function UploadZone({ section, compact }: { section: Section; compact?: boolean }) {
  const { files, addFiles, removeFile, isDemo } = useData();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const mine = files.filter((f) => f.section === section);

  async function handle(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setMsg('');
    try {
      const loaded = (await Promise.all([...list].map((f) => ingestFile(f, section)))).flat();
      const bad = loaded.filter((f) => f.kind === 'unknown');
      const good = loaded.filter((f) => f.kind !== 'unknown');
      addFiles(good);
      const moved = good.filter((f) => f.note).map((f) => `${f.name}: ${f.note}`);
      const enc = good.reduce((s, f) => s + f.claims.length, 0);
      const rej = good.reduce((s, f) => s + f.rejections.length, 0);
      setMsg([
        good.length ? `Added ${good.length} file(s) to ${SECTION_LABEL[section]}: ${int(enc)} encounters, ${int(rej)} rejected lines.` : '',
        ...moved,
        bad.length ? `Not recognised: ${bad.map((b) => b.name).join(', ')}. Expected an HIS claim export (ClaimNo, ServiceDescription, ICD1…) or a payer rejection statement.` : '',
      ].filter(Boolean).join(' '));
    } catch (e) {
      setMsg(`Import failed: ${String(e)}`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <section className="upload-zone" aria-label={`Upload to ${SECTION_LABEL[section]}`}>
      <div
        className={`drop ${over ? 'over' : ''} ${compact ? 'compact' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
      >
        <Icon name="upload" />
        <div style={{ textAlign: 'left' }}>
          <b>{busy ? 'Reading files…' : `Upload to ${SECTION_LABEL[section]}`}</b>
          <p className="muted" style={{ fontSize: 13 }}>{HELP[section]} Several files and months at once (.xls, .xlsx, .csv).</p>
        </div>
        <input ref={input} id={`file-input-${section}`} type="file" multiple accept=".xls,.xlsx,.csv,.txt" hidden onChange={(e) => handle(e.target.files)} />
      </div>
      {msg && <div className="banner" role="status">{msg}</div>}
      {mine.length > 0 && (
        <div className="file-chips">
          {mine.map((f) => (
            <span key={f.id} className="file-chip">
              <b>{f.name}</b>{f.demo && <span className="faint"> · demo</span>}
              <span className="faint num">{f.claims.length ? `${int(f.claims.length)} enc.` : `${int(f.rejections.length)} lines`}</span>
              {!f.demo && <button className="btn small ghost" onClick={() => removeFile(f.id)} aria-label={`Remove ${f.name}`}><Icon name="close" /></button>}
            </span>
          ))}
          {isDemo && <span className="faint" style={{ fontSize: 12 }}>Demo files are replaced as soon as you upload your own.</span>}
        </div>
      )}
    </section>
  );
}
