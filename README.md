# WAD Clinic Claim Review

A browser platform for the WAD Clinic insurance office. It audits claims medically before they go to NPHIES, and analyses what payers have already rejected. All files are processed in the browser: no patient data leaves the computer.

## What it does

**Medical audit (pre-submission).** Each encounter (claim no. + patient + date + doctor) is checked against 57 rules in 8 areas:

| Area | Examples |
|---|---|
| Drug ↔ Diagnosis | Every medication is resolved to its SFDA active ingredient and checked against the **CHI Drug Formulary** indication ICD list, plus the DDF prescribing edits (PA, QL, MD, AGE, inpatient-only) and excluded items (infant formula, cosmetics, supplements). |
| Diagnosis ↔ Service | 60+ lab, imaging, procedure and dental rules (CBC, CRP, blood group, urine culture, TSH, vitamin D, X-ray site vs ICD site, ultrasound, MRI/CT pre-auth, IV fluids, nebulisation, wound care, extractions…), based on ACR, NICE, IDSA, ADA, ACOG, AAO-HNS and GINA criteria. |
| Vital signs ↔ History | "Febrile" or R50 with normal temperature, "afebrile" with fever, tachycardia/distress/hypotension contradicting the vitals, dehydration without signs, missing or placeholder vitals, a child without a weight. |
| Missing medical data | History too short, no duration, no examination, no plan, injury without how / when / where / work-related, work injury (GOSI), road-traffic accident (Najm), pregnancy without LMP, dental work without tooth number. |
| Severity / Justification | Injection or IV given without documented severity; procedure without grade. |
| Drug safety & interactions | 40 interaction and duplication pairs, drug–disease conflicts, pregnancy contraindications, paediatric limits and Beers 2023 for patients 65 and over. |
| ICD coding quality | Sex and age conflicts, incomplete header codes, Excludes1 pairs, pregnancy coding precedence (chapter 15), injuries without an external cause, non-covered diagnoses. |
| Follow-up & duplicates | Repeat consultation within the 14-day free follow-up period, duplicate services, refills too soon. |

Every finding comes with a severity, the SAR at risk, the fix, a note the doctor can paste in where one applies, and the references behind it. Results export to Excel as one sheet for everything plus one sheet per doctor.

**Rejection analytics.** Payer statements are parsed and classified into NPHIES-aligned causes (medical vs technical). Each rejection is linked by invoice number to the doctor, ICD codes and service category. The page shows breakdowns by cause, category, service and doctor, a prevention playbook for each cause, and a recommendation for each rejected line.

**Also included:** doctor scorecards with a feedback memo, a Drug ↔ ICD checker covering every SFDA product in the formulary, and a rulebook that lists every rule and its source.

### Validation on WAD Clinic data (June–July 2026)

On the 27 medical rejections in the July Tawuniya statement that could be linked to the HIS export, the audit flagged the rejected line at high or critical severity in **24 of 27 cases (89%)**. Two of the remaining three are flagged at medium or claim level.

## Supported files

* **HIS claim export.** The tab-separated `output.xls` with columns such as `ClaimNo`, `MRN`, `ServiceDescription`, `ICD1`, `diag 2`, vitals and `Chief complaint`. Optional `Examination`, `Plan` and `SpO2` columns are read automatically when present.
* **Tawuniya / Waseel statement of account** (`.xlsx`).
* **Bupa `CLPROVSTM04` workbook** (the `Rejection_Details` sheet).
* Other rejection lists with columns for service, reason and amount.

The platform opens with a fictional demo dataset until you import your own files.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (open with any static server, e.g. npx vite preview)
npm test           # rule-engine unit tests
```

### Updating the CHI formulary

```bash
python3 -m pip install pandas openpyxl
python3 scripts/build_formulary.py path/to/DDF_CHI_Drug_Formulary.xlsx   # writes public/data/formulary.json
```

## Privacy

Claim files contain PHI. They are parsed in the browser and stored only in the browser's IndexedDB on this computer. `.gitignore` excludes `samples/`, `*.xls` and `*.xlsx` so patient files are never committed.

## Code map

* `src/lib/engine.ts`: the audit rule engine
* `src/lib/kb/`: knowledge bases (`services.ts` medical necessity, `drugs.ts` safety, `icd.ts` coding, `rejectionCodes.ts` causes and playbooks, `rules.ts` catalogue and sources)
* `src/lib/formulary.ts`: CHI DDF / SFDA lookups
* `src/lib/parse.ts`, `src/lib/rejections.ts`: file detection and parsing, linking rejections to claims
* `src/lib/analytics.ts`: statistics and the prevention plan
* `src/pages/`: the UI

The audit supports the treating doctor's clinical judgement. It does not replace it.
