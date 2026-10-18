# Income Documents — Payslips, ITR-V, Form 26AS

Bank statements are only one leg of income verification. Panini also
parses the other documents lenders collect — deterministically, offline,
with the same evidence-first rules:

```ts
import {
  detectDocumentType,
  extractDocument, // detect + parse in one call
  extractPayslip,
  extractItrV,
  extractForm26as,
} from '@paniniapi/extract';
```

Python parity: `panini.extract_payslip`, `panini.extract_itrv`,
`panini.extract_form26as`, `panini.extract_document`.

All parsers take the document's **text layer** (use `extractPdfLines` /
your OCR provider to get text from a PDF; these are pure functions over
text — no network, no filesystem).

## Payslip

`extractPayslip(text)` →

| Field                                            | Source                                                                                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `employeeName`, `employer`, `period`, `payDate`  | Header labels / first-line org-name heuristic                                                                                                                           |
| `components[]`                                   | Label+amount line pairs; **original component names preserved** (`Special Allowance` ≠ `Performance Allowance`), classified `earning`/`deduction` by keyword vocabulary |
| `grossPaise` / `deductionsPaise` / `netPayPaise` | Totals labels (`Gross Earnings`, `Total Deductions`, `Net Pay`/`Take Home`) — falls back to component sums                                                              |
| `ids`                                            | PAN, UAN, PF number, ESI number, bank account mask                                                                                                                      |
| `arithmeticCheck`                                | `ok` when gross − deductions = net (±₹1) — the payslip equivalent of the balance-chain check                                                                            |

## ITR-V (e-filing acknowledgement)

`extractItrV(text)` → `pan`, `name`, `assessmentYear`, `itrForm`,
`ackNo`, `filingDate`, and the numbered boxes: `grossTotalIncomePaise`
(box 1), `deductionsChapterViaPaise` (2), `totalIncomePaise` (3),
`netTaxPayablePaise` (4), `tdsPaise` (7b), `totalTaxesPaidPaise` (7e),
`refundPaise` (9) — plus `arithmeticCheck` on box 1−2=3.

## Form 26AS

`extractForm26as(text)` → `pan`, `name`, `assessmentYear`, `entries[]`
(each TAN-keyed: `deductor`, `tan`, `section`, `date`,
`paidPaise`/`taxDeductedPaise`/`depositedPaise`), and summed
`totalPaidPaise`/`totalTaxDeductedPaise`.

## Cross-check pattern

The deterministic income-verification loop these enable:

```ts
const slip = extractPayslip(payslipText);
const itrv = extractItrV(itrvText);
const f26 = extractForm26as(f26asText);
// payslip net ×12 vs ITR-V gross; 26AS TDS vs ITR-V box 7b;
// payslip employer vs 26AS deductor — mismatches are review evidence.
```

## In the BSA pipeline

`panini-bsa` classifies zero-transaction files through these parsers —
a payslip in the batch shows up under "Income Documents" with its
arithmetic verdict instead of looking like a failed extraction.

## Honest boundary

- Payslip layouts vary wildly; the parser is vocabulary-driven, not
  layout-driven. Unknown component names fall through — check
  `warnings` and `components.length === 0`.
- ITR-V box numbers are stable across ITR forms; label fallbacks cover
  text layers that drop them.
- These parsers validate **internal consistency** (arithmetic, ids).
  Authenticity still comes from forensics + AA/portal cross-checks.
