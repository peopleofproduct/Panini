# Adding a bank statement layout

Bank CSV/Excel layouts are **data, not code** — like the narration
grammars, a new bank is a JSON entry plus a corpus fixture. No changes to
`@paniniapi/extract` internals are needed.

## How layout detection works

`extractStatement` scans the first `maxHeaderScanRows` rows looking for a
row whose headers satisfy a layout's `requiredHeaders`. Matching is
case-insensitive and whitespace-normalised. Once matched, the layout's
`columns` map tells the row mapper which column aliases mean `date`,
`narration`, `debit`, `credit`, `balance`, and `refNo`. If no layout
matches, the `generic` layout (broad aliases only) is tried; statements
that still don't match parse nothing and report a warning.

## Step-by-step

1. **Get a real export.** Download a CSV/Excel statement export from the
   bank's netbanking portal. XLSX exports are fine — the native reader
   feeds the same row pipeline as CSV.

2. **Identify the header row.** Find the row containing the column titles
   (e.g. `Tran Date`, `Description`, `Debit`, `Credit`, `Balance`). Note
   the bank's wording — preamble lines above the header are common and
   handled automatically.

3. **Add a layout entry** in `packages/extract/formats/csv-layouts.json`:

   ```json
   {
     "id": "somebank_statement",
     "bank": "SOMEBANK",
     "requiredHeaders": ["tran date", "description", "balance"],
     "columns": {
       "date": ["tran date", "value date"],
       "narration": ["description", "particulars"],
       "refNo": ["ref no", "cheque no"],
       "debit": ["debit amt", "withdrawal"],
       "credit": ["credit amt", "deposit"],
       "balance": ["balance"]
     }
   }
   ```

   - `requiredHeaders` should be the smallest set of headers that
     **uniquely identifies** this bank — pick wording other banks don't
     share. Three is usually right.
   - `columns` values are alias lists — include every spelling the bank
     has used across formats/eras. All lower-case.
   - A combined signed `amount` column works too: map it to `amount`
     instead of separate `debit`/`credit`.
   - Add optional aliases under `valueDate`, `transactionType`, etc. as
     needed — see existing layouts for the full column vocabulary.

4. **Add a corpus fixture** in
   `packages/extract/formats/corpus/<bank>-csv.json` — this is the CI
   gate. Follow the existing files' shape (`id`, `format: "csv"`,
   `input` CSV text, `expected` fields). The input must exercise the real
   layout: preamble lines, the actual header spellings, at least one
   debit and one credit row.

   **Privacy: never commit real data.** Anonymise account numbers
   (`XXXXXX1234`), names, narrations, and amounts. Synthetic-but-realistic
   rows are fine — what matters is the _shape_.

5. **Verify.**

   ```bash
   npm test -- packages/extract   # corpus + layout tests
   ```

   The corpus test fails if your fixture's expectations don't match what
   the layout produces — iterate until green.

## What a good contribution looks like

- ✅ One bank per PR (easier to review against a real export)
- ✅ Column aliases copied verbatim from the bank's header row
- ✅ Corpus input mirrors the real export including preamble/footer noise
- ❌ No invented header spellings — if you haven't seen it in an export,
  don't list it (the project's evidence-first rule)
- ❌ No real PII anywhere — not in fixtures, not in commit messages

## Related seams

- **XLSX** — the same layouts apply; the native reader renders cells as
  display strings (dates → `YYYY-MM-DD`), so no XLSX-specific work.
- **PDF statements** — same layouts after text-layer row reconstruction.
- **SMS alerts** — a different pipeline entirely; see
  `formats/sms-patterns.json`.
- **Narration parsing** — bank-specific `UPI-...-...` shapes live in
  `packages/rules-engine/rules/<bank>.json`; see CONTRIBUTING's
  "Adding a bank grammar" section.
