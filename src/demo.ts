/**
 * Synthetic demo dataset (fictional patients, doctors and claim numbers) so the platform opens in a working
 * state. It mirrors the WAD Clinic HIS export and the Tawuniya statement layouts. No real patient data.
 */
import type { Payer } from './lib/types';
import { CLAIM_FIELDS, autoMap, rowHash } from './lib/parse';
import type { ImportBundle, ImportMeta, StoredRow } from './db';

type Line = [category: string, code: string, desc: string, net: number, units?: number];
interface Visit {
  claim: string; mrn: string; name: string; gender: 'Male' | 'Female'; age: string; date: string; doc: [string, string, string];
  icd: [string, string][]; vit: [bp: string, temp: string, pulse: string, rr: string, h: string, w: string]; lmp?: string; hx: string; lines: Line[]; tooth?: string; approval?: string;
}

const DOCS = {
  er1: ['9001', 'Dr. Sara Demo (ER)', 'Emergency Doctors'],
  er2: ['9002', 'Dr. Khalid Example (ER)', 'Emergency Doctors'],
  gyn: ['9003', 'Dr. Noura Sample (OB/GYN)', 'Gynecologist'],
  ortho: ['9004', 'Dr. Faisal Test (Ortho)', 'Orthopedic Surgeon'],
  dent: ['9005', 'Dr. Lama Demo (Dental)', 'Dentist'],
  ped: ['9006', 'Dr. Omar Example (Peds)', 'Pediatrician'],
} as const;

const CONS: Line = ['Dr. Consultations', 'CO0011000', 'ER G P Consultation', 24];
const SPEC: Line = ['Dr. Consultations', 'CO0012000', 'Specialist Consultation', 44];

const VISITS: Visit[] = [
  { claim: 'D-1001', mrn: 'DM-01', name: 'Demo Patient A', gender: 'Male', age: '31Y', date: '2026-07-03', doc: [...DOCS.er1], icd: [['J06.9', 'Acute upper respiratory infection, unspecified'], ['R50.9', 'Fever, unspecified']], vit: ['118/76', '36.8', '84', '18', '175', '78'],
    hx: '31-year-old male presented with sore throat, runny nose and fever since 1 day. He denied cough or shortness of breath.',
    lines: [CONS, ['Laboratory', 'LA0010', 'COMPLETE BLOOD COUNT (CBC)', 36], ['Procedures', 'PR0021', 'I.V. INFUSION MON.', 43.2], ['Medicine', '0109222573', 'NS NORMAL SALINE 0.9 %/ml 100 ML/Bottle', 3.3], ['Medicine', '69-188-15', 'PARACETAMOL/parafusive Injection 10 MG/1ML, 100ML/Bottle', 6], ['Medicine', '3103210658', 'Pantrox 40 mg/ampoule, Ampoule', 6.5]] },
  { claim: 'D-1001', mrn: 'DM-01', name: 'Demo Patient A', gender: 'Male', age: '31Y', date: '2026-07-08', doc: [...DOCS.er1], icd: [['J06.9', 'Acute upper respiratory infection, unspecified']], vit: ['120/78', '36.6', '80', '16', '175', '78'],
    hx: 'Follow up, sore throat improving, mild cough for 6 days. O/E throat mildly congested, chest clear. Plan: continue symptomatic treatment.', lines: [CONS] },
  { claim: 'D-1002', mrn: 'DM-02', name: 'Demo Patient B', gender: 'Female', age: '29Y', date: '2026-07-05', doc: [...DOCS.gyn], icd: [['Z34.9', 'Supervision of normal pregnancy, unspecified'], ['R30.0', 'Dysuria'], ['N39.0', 'Urinary tract infection, site not specified']], vit: ['110/70', '36.7', '88', '18', '160', '66'], lmp: '20/05/2026',
    hx: 'ANC. G2P1. LMP 20/5/2026, pregnancy 6 weeks. Burning micturition for 3 days, mild lower abdominal pain, no vaginal bleeding.',
    lines: [SPEC, ['Laboratory', 'LA0201', 'Blood grouping', 16.8], ['Laboratory', 'LA0202', 'URINE CULTURE AND SENSITIVITY', 42], ['Medicine', '1308258025', 'BRUFEN Tablet 600MG/1Tablet, 30Tablet/Box', 12]] },
  { claim: 'D-1003', mrn: 'DM-03', name: 'Demo Child C', gender: 'Female', age: '4Y', date: '2026-07-06', doc: [...DOCS.ped], icd: [['J00', 'Acute nasopharyngitis [common cold]']], vit: ['', '37.1', '110', '24', '', ''],
    hx: '4 years old girl with runny nose and nasal congestion for 2 days. Good activity and oral intake.',
    lines: [SPEC, ['Medicine', '2511211365', 'OTRIVIN NASAL SPRAY 0.1%/1Applicator', 14], ['Medicine', '2610200242', 'LORINASE-D 120 mg tablet, 20 TABLET/BOX', 22], ['Medicine', '1111246173', 'AZIMAC Film coated tablet 500MG/1Tablet, 3Tablet/Box', 28]] },
  { claim: 'D-1004', mrn: 'DM-04', name: 'Demo Patient D', gender: 'Male', age: '38Y', date: '2026-07-09', doc: [...DOCS.ortho], icd: [['S93.4', 'Sprain of ankle']], vit: ['126/80', '36.5', '76', '16', '178', '85'],
    hx: 'Right ankle pain and swelling after twisting injury.',
    lines: [SPEC, ['Radiology', 'XY0057', 'X-RAY ANKLE JOINT AP & LAT VIEWS', 84], ['Procedures', 'PR0090', 'Crepe Bandage (Small)', 12], ['Medicine', '0902221709', 'DIVIDO Capsule 75MG/1Capsule, 20Capsule/Box', 24.5], ['Medicine', '1308258025', 'BRUFEN Tablet 600MG/1Tablet, 30Tablet/Box', 12]] },
  { claim: 'D-1005', mrn: 'DM-05', name: 'Demo Patient E', gender: 'Male', age: '42Y', date: '2026-07-10', doc: [...DOCS.er2], icd: [['S61.4', 'Open wound of hand']], vit: ['130/84', '36.6', '90', '18', '170', '80'],
    hx: 'Laceration of left hand by machine blade at work 2 hours ago. O/E 3 cm clean wound, no tendon injury. Plan: suturing and dressing.',
    lines: [CONS, ['Procedures', 'PR0110', 'DRESSING FOR MEDIUM WOUND', 40], ['Procedures', 'PR0111', 'Suturing of wound, small', 120]] },
  { claim: 'D-1006', mrn: 'DM-06', name: 'Demo Patient F', gender: 'Female', age: '26Y', date: '2026-07-11', doc: [...DOCS.er2], icd: [['A09.0', 'Other and unspecified gastroenteritis and colitis of infectious origin'], ['E86.0', 'Dehydration']], vit: ['98/62', '37.2', '112', '20', '163', '58'],
    hx: 'Vomiting 6 episodes and watery diarrhoea since yesterday, unable to keep fluids down. O/E dry mucosa, delayed capillary refill, abdomen soft. Plan: IV fluids, antiemetic, oral rehydration advice, review if worse.',
    lines: [CONS, ['Procedures', 'PR0021', 'I.V. INFUSION MON.', 43.2], ['Medicine', '1203245043', 'RS RINGER SOLUTION 500ml For Infusion, Bottle', 6], ['Medicine', '1202256889', 'ONDANSETRON 4 mg/2 ml Injection, 5 Ampoule/Box', 10.7]] },
  { claim: 'D-1007', mrn: 'DM-07', name: 'Demo Patient G', gender: 'Male', age: '45Y', date: '2026-07-12', doc: [...DOCS.ortho], icd: [['M54.5', 'Low back pain']], vit: ['134/86', '36.6', '78', '16', '172', '92'],
    hx: 'Low back pain for 2 weeks after lifting at home. No numbness, no weakness, no bladder symptoms.',
    lines: [SPEC, ['Radiology', 'XY0070', 'X-RAY LUMBO-SACRAL SPINE (AP & LAT)', 96], ['Radiology', 'XY0099', 'Magnetic resonance imaging of other site without contrast medium', 720], ['Medicine', '3006222294', 'XEFO Injection 8MG/1Vial, 1Vial/Vial', 16.5], ['Procedures', 'PR0031', 'IM INJECTION (WITHOUT MEDICATION)', 12]] },
  { claim: 'D-1008', mrn: 'DM-08', name: 'Demo Patient H', gender: 'Female', age: '33Y', date: '2026-07-13', doc: [...DOCS.dent], icd: [['K04.0', 'Pulpitis']], vit: ['', '', '', '', '', ''],
    hx: 'Severe throbbing pain lower left tooth, worse at night, for 3 days.',
    lines: [['Procedures', 'DE0010', 'SIMPLE EXTRACTION', 150], ['Procedures', 'DE0020', 'PERIAPICAL X-RAY SINGLE FILM', 30]] },
  { claim: 'D-1009', mrn: 'DM-09', name: 'Demo Patient I', gender: 'Male', age: '58Y', date: '2026-07-14', doc: [...DOCS.er1], icd: [['I10', 'Essential (primary) hypertension'], ['J01.9', 'Acute sinusitis, unspecified']], vit: ['162/98', '37.0', '88', '16', '169', '90'],
    hx: 'Known hypertensive on amlodipine. Facial pain and nasal blockage for 10 days, purulent nasal discharge. O/E tender maxillary sinuses. Plan: antibiotic and decongestant.',
    lines: [CONS, ['Medicine', '80-334-02', 'RINOFED PLUS Tablet /1Tablet, 30Tablet/Box', 14], ['Medicine', '1111246173', 'AZIMAC Film coated tablet 500MG/1Tablet, 3Tablet/Box', 28], ['Laboratory', 'LA0301', 'TSH ( Thyroid Stimulating Hormone )', 60]] },
  { claim: 'D-1010', mrn: 'DM-10', name: 'Demo Patient J', gender: 'Female', age: '24Y', date: '2026-07-15', doc: [...DOCS.er2], icd: [['J03.9', 'Acute tonsillitis, unspecified'], ['R50.9', 'Fever, unspecified']], vit: ['112/70', '38.7', '104', '18', '158', '55'],
    hx: 'Sore throat, painful swallowing and fever up to 39 for 3 days, no cough. O/E enlarged tonsils with exudate, tender anterior cervical lymph nodes, Centor 4. Plan: amoxicillin-clavulanate 7 days, paracetamol, fluids, review in 3 days if no improvement.',
    lines: [CONS, ['Medicine', '1-836-12', 'Panadol Advance 500 mg/tablet, 24 Tablet/Box', 6], ['Medicine', 'AUG-625', 'AUGMENTIN 625 mg tablet, 14 tablet/box', 38]] },
  { claim: 'D-1011', mrn: 'DM-11', name: 'Demo Patient K', gender: 'Male', age: '36Y', date: '2026-07-16', doc: [...DOCS.er1], icd: [['G43.9', 'Migraine, unspecified']], vit: ['122/80', '36.9', '72', '16', '180', '82'],
    hx: 'Known migraine. Severe left-sided headache 8/10 since morning with nausea and two vomits, not responding to oral analgesic. O/E no neurological deficit. Plan: IV analgesia and antiemetic.',
    lines: [CONS, ['Medicine', '0509234141', 'AMBAFEN 400 mg/100 ml Solution For Injection', 21], ['Medicine', '0902221709', 'DIVIDO Capsule 75MG/1Capsule, 20Capsule/Box', 24.5], ['Medicine', '1202256889', 'ONDANSETRON 4 mg/2 ml Injection, 5 Ampoule/Box', 10.7], ['Medicine', '1111246173', 'AZIMAC Film coated tablet 500MG/1Tablet, 3Tablet/Box', 28], ['Procedures', 'PR0010', 'I.V. INJECTION (WITHOUT MEDICATION)', 12]] },
  { claim: 'D-1012', mrn: 'DM-12', name: 'Demo Infant L', gender: 'Male', age: '7M', date: '2026-07-17', doc: [...DOCS.ped], icd: [['Z00.1', 'Routine child health examination']], vit: ['', '36.9', '120', '32', '68', '8'],
    hx: 'Routine visit, feeding well.', lines: [SPEC, ['Inventory Items', 'COSM0805', 'NESTLE NAN SUPREME PRO 1 400G', 65]] },
  { claim: 'D-1013', mrn: 'DM-13', name: 'Demo Patient M', gender: 'Male', age: '29Y', date: '2026-07-18', doc: [...DOCS.er2], icd: [['R10.4', 'Other and unspecified abdominal pain']], vit: ['120/80', '1', '1', '1', '1', '1'],
    hx: 'Abdominal pain.', lines: [CONS, ['Laboratory', 'LA0401', 'BHCG QUANTITATIVE', 70], ['Radiology', 'XY0110', 'ULTRASOUND OF ABDOMEN', 115]] },
];

const HIS_HEADER = ['MRN', 'Name', 'gender', 'Age', 'ClaimNo', 'ins comp name', 'approval no', 'Encounter Type', 'INVOICE', 'Physician Id', 'Physician name', 'Drs speciality', 'ServiceCategory', 'service code', 'ServiceDescription', 'ServiceUnits', 'BilledAmount', 'PatientPayAmount', 'Discount', 'Net amount', 'Net Vat', 'ICD1', 'diag desc', 'diag 2', 'diag 2 desc', 'diag 3 code', 'diag 3 desc', 'Service date', 'BP', 'Temperature', 'pulse', 'Respiratory Rate', 'Height', 'Weight', 'LMP', 'Chief complaint', 'Tooth Number', 'GTIN'];
const PAYER_NAME: Record<Payer, string> = { Bupa: 'BUPA ARABIA FOR COOPERATIVE INSURANCE', Tawuniya: 'tawuniya insurance companies' };

function meta(id: string, filename: string, fileType: ImportMeta['fileType'], layout: ImportMeta['layout'], payer: Payer, periods: string[], header: string[], rows: StoredRow[]): ImportMeta {
  return {
    id, filename, fileType, layout, payer, payerBasis: 'Demo data', periods, uploadedAt: '2026-08-01T00:00:00.000Z', format: 'tsv', sheet: 'Demo', headerRow: 2, header,
    mapping: fileType === 'claims' ? autoMap(header, CLAIM_FIELDS) : null, rowsRead: rows.length, imported: rows.length, skipped: 0, duplicates: 0, errors: [], warnings: [],
    status: 'active', fingerprint: id, demo: true,
  };
}

/** Fictional June/July batches for both insurers, with one statement per insurer for July. */
export function demoBundles(): ImportBundle[] {
  const june: Visit[] = VISITS.slice(2, 10).map((v) => ({ ...v, claim: '-1', mrn: `${v.mrn}J`, name: `${v.name} (June)`, date: v.date.replace('-07-', '-06-') }));
  const TAW = new Set(['DM-02', 'DM-05', 'DM-06', 'DM-09', 'DM-11']);
  const payerOf = (v: Visit): Payer => (TAW.has(v.mrn.replace(/J$/, '')) ? 'Tawuniya' : 'Bupa');
  const rows: StoredRow[] = [];
  let inv = 20269000100;
  let rowNo = 2;
  const invoiceOf = new Map<string, string>();
  [...june, ...VISITS].forEach((v) => {
    const payer = payerOf(v);
    for (const l of v.lines) {
      inv++;
      rowNo++;
      const dx = (k: number) => v.icd[k] ?? ['-1', '-1'];
      const values: Record<string, string> = {
        MRN: v.mrn, Name: v.name, gender: v.gender, Age: v.age, ClaimNo: '-1', 'ins comp name': PAYER_NAME[payer], 'approval no': v.approval ?? '-1', 'Encounter Type': 'O',
        INVOICE: String(inv), 'Physician Id': v.doc[0], 'Physician name': v.doc[1], 'Drs speciality': v.doc[2], ServiceCategory: l[0], 'service code': l[1], ServiceDescription: l[2],
        ServiceUnits: String(l[4] ?? 1), BilledAmount: String(l[3]), PatientPayAmount: '0', Discount: '0', 'Net amount': String(l[3]), 'Net Vat': '0',
        ICD1: dx(0)[0], 'diag desc': dx(0)[1], 'diag 2': dx(1)[0], 'diag 2 desc': dx(1)[1], 'diag 3 code': dx(2)[0], 'diag 3 desc': dx(2)[1],
        'Service date': v.date.split('-').reverse().join('-'), BP: v.vit[0] || '-1', Temperature: v.vit[1] || '-1', pulse: v.vit[2] || '-1', 'Respiratory Rate': v.vit[3] || '-1',
        Height: v.vit[4] || '-1', Weight: v.vit[5] || '-1', LMP: v.lmp ?? '-1', 'Chief complaint': v.hx, 'Tooth Number': v.tooth ?? '-1', GTIN: '-1',
      };
      invoiceOf.set(`${v.mrn}|${v.date}|${l[2]}`, String(inv));
      rows.push({ rowNo, values, hash: rowHash(values), payer });
    }
  });
  const claims: ImportBundle = { meta: { ...meta('demo-claims', 'DEMO_his_export_06-07-2026.xls', 'claims', 'his-claims', 'Bupa', ['2026-06', '2026-07'], HIS_HEADER, rows), payer: null, payerBasis: 'Per row from the insurer column (demo)' }, rows };

  const find = (mrn: string, date: string, desc: RegExp) => [...invoiceOf.entries()].find(([k]) => k.startsWith(`${mrn}|${date}|`) && desc.test(k.split('|')[2]))?.[1] ?? '';
  const waseelHeader = ['Waseel Batch', 'Doctor Code', 'Claim No.', 'Service Code', 'Service', 'Exceed Price', 'Rejected Amount', 'Invoice Number', 'Reason', 'Status', 'Comments'];
  const tw: StoredRow[] = [];
  const bp: StoredRow[] = [];
  const w = (mrn: string, date: string, desc: RegExp, service: string, code: string, amount: number, reason: string) => {
    const values = { 'Waseel Batch': 'DEMO-07', 'Doctor Code': '', 'Claim No.': `N-${mrn}`, 'Service Code': code, Service: service, 'Exceed Price': '0', 'Rejected Amount': String(amount), 'Invoice Number': `40${find(mrn, date, desc)}`, Reason: reason, Status: '', Comments: '' };
    tw.push({ rowNo: tw.length + 2, values, hash: rowHash(values), payer: 'Tawuniya' });
  };
  const bupaHeader = ['CLAIM_ID', 'INV_NO', 'INCUR_DATE_FROM', 'ICD Code', 'SERV_CODE', 'SERV_DESC', 'REJ_DESC', 'REJ_CODE', 'nphies rejection code ', 'nphies denial description ', 'BATCH_ID', 'Reject_Amount', 'VAT_REJ_AMT'];
  const b = (mrn: string, date: string, desc: RegExp, service: string, code: string, amount: number, vat: number, rej: string, rejCode: string, nph: string, denial: string) => {
    const values = { CLAIM_ID: `B-${mrn}`, INV_NO: `40${find(mrn, date, desc)}`, INCUR_DATE_FROM: date, 'ICD Code': '', SERV_CODE: code, SERV_DESC: service, REJ_DESC: rej, REJ_CODE: rejCode, 'nphies rejection code ': nph, 'nphies denial description ': denial, BATCH_ID: 'DEMO-B07', Reject_Amount: String(amount), VAT_REJ_AMT: String(vat) };
    bp.push({ rowNo: bp.length + 2, values, hash: rowHash(values), payer: 'Bupa' });
  };
  w('DM-02', '2026-07-05', /grouping/, 'Blood Typing Serologic Rh Phenotyping Complete', '73250-01-30', 16.8, 'Service is not clinically justified based on clinical practice guideline, without additional supporting diagnosis');
  w('DM-05', '2026-07-10', /DRESSING/, 'Dressing medium wound', '30055-00-20', 40, 'Out Of Price List');
  w('DM-11', '2026-07-16', /AZIMAC/, 'Azimac 500 mg Tablet', '1111246173', 28, 'Medication 1111246173 is not indicated with diagnosis code G43.9');
  b('DM-01', '2026-07-03', /INFUSION/, 'IV admin of pharmac agent electrolyte', '96199-08-00', 43.2, 6.48, 'Service is not clinically justified', '230.6', 'MN-1-1', 'Service is not clinically justified based on clinical practice guideline, without additional supporting diagnosis');
  b('DM-01', '2026-07-03', /Pantrox/, 'Pantrox,40,powder for solution for injection,1', '3103210658', 6.5, 0, 'Medication PANTROX (3103210658) is not indicated with diagnosis code J06.9 J06.9,R50.9', '230.6', 'MN-1-1', 'Service is not clinically justified based on clinical practice guideline, without additional supporting diagnosis');
  b('DM-01', '2026-07-08', /Consultation/, 'GP Consultation', '83600-00-00', 24, 3.6, 'Consultation within the free follow up period', '23', 'CV-1-9', 'Consultation is within 14-day follow up period');
  b('DM-07', '2026-07-12', /Magnetic/, 'MRI lumbar spine', '56219-00-00', 720, 108, 'Already rejected/Cancelled at preauthorization', '142', 'BE-1-4', 'Preauthorization is required and was not obtained');
  b('DM-03', '2026-07-06', /AZIMAC/, 'AZIMAC 500MG TABLET', '1111246173', 28, 0, 'Medication AZIMAC (1111246173) is not indicated with diagnosis code J00 J00', '230.6', 'MN-1-1', 'Service is not clinically justified based on clinical practice guideline, without additional supporting diagnosis');
  const bupaDeductible = { CLAIM_ID: '', INV_NO: '', INCUR_DATE_FROM: '', 'ICD Code': '', SERV_CODE: '', SERV_DESC: '', REJ_DESC: 'Deductible difference', REJ_CODE: '340', 'nphies rejection code ': 'BE-1-1', 'nphies denial description ': 'Co-pay was not collected from member', BATCH_ID: 'DEMO-B07', Reject_Amount: '12.5', VAT_REJ_AMT: '1.88' };
  bp.push({ rowNo: bp.length + 2, values: bupaDeductible, hash: rowHash(bupaDeductible), payer: 'Bupa' });
  return [
    claims,
    { meta: meta('demo-taw', 'DEMO_Tawuniya_statement_07-2026.xlsx', 'rejections', 'tawuniya-waseel', 'Tawuniya', ['2026-07'], waseelHeader, tw), rows: tw },
    { meta: meta('demo-bupa', 'DEMO_Bupa_CLPROVSTM_07-2026.xlsx', 'rejections', 'bupa-clprovstm', 'Bupa', ['2026-07'], bupaHeader, bp), rows: bp },
  ];
}
