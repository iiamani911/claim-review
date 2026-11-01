import XLSX from 'xlsx-js-style';
import { CATS, CAT_ORDER, LEVEL_LABEL, type SheetCheck } from './precheck';

type Cell = { v: string | number; t: 's' | 'n'; s?: Record<string, unknown>; c?: { a: string; t: string }[] & { hidden?: boolean } };

const border = { top: { style: 'thin', color: { rgb: 'BFBFBF' } }, bottom: { style: 'thin', color: { rgb: 'BFBFBF' } }, left: { style: 'thin', color: { rgb: 'BFBFBF' } }, right: { style: 'thin', color: { rgb: 'BFBFBF' } } };
const head = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '1F4E4A' } }, alignment: { vertical: 'center', wrapText: true }, border };
const base = { alignment: { vertical: 'top', wrapText: false }, border };
const fillOf = (rgb: string, ink?: string, bold = false) => ({ ...base, fill: { patternType: 'solid', fgColor: { rgb } }, font: { color: { rgb: ink ?? '000000' }, bold } });
const LEVEL_STYLE = { must: fillOf('C00000', 'FFFFFF', true), review: fillOf('FFC000', '000000', true), info: fillOf('DDEBF7', '1F3864') };

const cell = (v: unknown, s?: Record<string, unknown>): Cell => {
  const n = typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? { v: n, t: 'n', s } : { v: String(v ?? ''), t: 's', s };
};

function writeSheet(rows: Cell[][], widths: number[]) {
  const ws = XLSX.utils.aoa_to_sheet([]);
  rows.forEach((r, ri) => r.forEach((c, ci) => { ws[XLSX.utils.encode_cell({ r: ri, c: ci })] = c; }));
  const cols = Math.max(...rows.map((r) => r.length), 1);
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: cols - 1 } });
  ws['!cols'] = widths.map((w) => ({ wch: w }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: cols - 1 } }) };
  return ws;
}

/**
 * The uploaded sheet handed back for correction: original columns untouched (problem cells coloured by type,
 * with a hover note), and four columns in front – status, problem type, problems, suggested correction.
 */
export function exportChecked(checks: SheetCheck[], file = 'WAD_checked_sheet.xlsx') {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const list: Cell[][] = [['Sheet', 'Row', 'File No', 'Patient', 'Claim No', 'Doctor', 'Level', 'Type', 'Problem', 'Suggested correction'].map((h) => cell(h, head))];

  for (const ch of checks) {
    const extra = ['Status', 'Problem type', 'Problems found', 'Suggested correction'];
    const out: Cell[][] = [[...extra, ...ch.header].map((h) => cell(h, head))];
    const mrn = ch.col('mrn'), nm = ch.col('name'), cl = ch.col('claim'), dr = ch.col('physician');
    let sheetName = ch.name.replace(/\.[a-z]+$/i, '').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Sheet';
    for (let k = 2; used.has(sheetName); k++) sheetName = `${sheetName.slice(0, 25)} (${k})`;
    used.add(sheetName);

    for (const row of ch.rows) {
      const top = row.issues[0];
      const types = [...new Set(row.issues.map((x) => CATS[x.cat].label))].join(' | ');
      const problems = row.issues.map((x) => `• ${x.text}`).join('\n');
      const fixes = [...new Set(row.issues.map((x) => `• ${x.fix}`))].join('\n');
      const wrap = (s: Record<string, unknown>) => ({ ...s, alignment: { vertical: 'top', wrapText: true } });
      const tint = top ? fillOf(CATS[top.cat].fill, CATS[top.cat].ink) : base;
      const status = row.level ? cell(LEVEL_LABEL[row.level].toUpperCase(), LEVEL_STYLE[row.level]) : cell('OK', { ...base, font: { color: { rgb: '006100' }, bold: true } });
      const line: Cell[] = [status, cell(types, wrap(tint)), cell(problems, wrap(tint)), cell(fixes, wrap({ ...tint, font: { bold: true, color: { rgb: top ? CATS[top.cat].ink : '000000' } } }))];
      row.cells.forEach((v, ci) => {
        const cat = row.marks.get(ci);
        const c = cell(v, cat ? fillOf(CATS[cat].fill, CATS[cat].ink, true) : base);
        if (cat) {
          const notes = row.issues.filter((x) => x.cols.includes(ci)).map((x) => `${x.text} → ${x.fix}`).join('\n');
          const cm = [{ a: 'WAD review', t: notes }] as Cell['c'] & { hidden?: boolean };
          cm!.hidden = true;
          c.c = cm;
        }
        line.push(c);
      });
      out.push(line);
      for (const x of row.issues) {
        list.push([
          cell(sheetName), cell(row.i + 2), cell(row.cells[mrn] ?? ''), cell(row.cells[nm] ?? ''), cell(row.cells[cl] ?? ''), cell(row.cells[dr] ?? ''),
          cell(LEVEL_LABEL[x.level], LEVEL_STYLE[x.level]), cell(CATS[x.cat].label, fillOf(CATS[x.cat].fill, CATS[x.cat].ink, true)),
          cell(x.text, { ...base, alignment: { vertical: 'top', wrapText: true } }), cell(x.fix, { ...base, font: { bold: true }, alignment: { vertical: 'top', wrapText: true } }),
        ]);
      }
    }
    const widths = [10, 24, 55, 45, ...ch.header.map((h, ci) => Math.min(40, Math.max(h.length + 2, ...ch.rows.slice(0, 200).map((r) => (r.cells[ci] ?? '').length))))];
    XLSX.utils.book_append_sheet(wb, writeSheet(out, widths), sheetName);
  }

  const legend: Cell[][] = [['Colour', 'Problem type', 'What it covers', 'Problems found'].map((h) => cell(h, head))];
  for (const c of CAT_ORDER) legend.push([cell('', fillOf(CATS[c].fill)), cell(CATS[c].label, fillOf(CATS[c].fill, CATS[c].ink, true)), cell(CATS[c].covers, base), cell(checks.reduce((s, ch) => s + ch.counts[c], 0), base)]);
  legend.push([], [cell('Status', head), cell('Meaning', head)]);
  legend.push([cell('MUST FIX', LEVEL_STYLE.must), cell('Will be rejected – correct before uploading to the portal', base)]);
  legend.push([cell('REVIEW', LEVEL_STYLE.review), cell('Weak point a reviewer may reject – check it', base)]);
  legend.push([cell('INFO', LEVEL_STYLE.info), cell('Coding hygiene – correct when possible', base)]);
  legend.push([], [cell('Hover a coloured cell to see the problem and the correction.')]);
  const lw = writeSheet(legend, [10, 30, 80, 15]);
  delete lw['!autofilter'];
  XLSX.utils.book_append_sheet(wb, lw, 'Legend');
  XLSX.utils.book_append_sheet(wb, writeSheet(list, [20, 6, 10, 24, 12, 24, 10, 24, 60, 50]), 'All problems');
  XLSX.writeFile(wb, file);
}
