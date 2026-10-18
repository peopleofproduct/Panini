# AA ↔ document reconciliation — the ground-truth check

> Audience: lenders / NBFCs who have **both** channels — a borrower's
> uploaded statement document and consented Account Aggregator data —
> and want to know if the document is telling the truth.

## Why this is the strongest fraud check Panini offers

Every other check in the stack proves _internal_ properties:

| Check                             | What it proves                              | What it can't prove                                    |
| --------------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| `verifyStatement`                 | The extraction is arithmetically consistent | The document isn't a well-fabricated fake              |
| `checkConsistency` (forensics)    | Balances chain, opening→closing reconciles  | Same — a smart fraudster keeps the math clean          |
| PDF structure/signature forensics | The file wasn't edited post-signing         | A statement fabricated _before_ signing, or never real |

Reconciliation closes the loop: **the AA feed comes from the bank
itself**, encrypted end-to-end under the ReBIT framework. The borrower
cannot edit it. Diff the claimed document against that truth and the
fraud question stops being probabilistic:

- A fabricated credit (fake salary) → present in the document,
  **unknown to the bank feed**
- A hidden debit (suppressed EMI bounce) → known to the bank feed,
  **omitted from the document**
- An altered amount → the "matching" rows don't match

## API

```ts
import { reconcileWithAa, transactionsFromAaData } from '@paniniapi/forensics';
import { extractStatement } from '@paniniapi/extract';

const statement = await extractStatement(pdfBytes, { credentials });
const aaTransactions = transactionsFromAaData(fiData); // decrypted AA payload

const report = reconcileWithAa(statement, aaTransactions);
// report.verdict: 'consistent' | 'partial' | 'fabrication_evidence' | 'incomparable'
```

`transactionsFromAaData` walks the ReBIT FI shape
(`Account.Transactions.Transaction[]`) and tolerates wrapper
differences — pass it the decrypted FI JSON and it finds the
transaction array.

## Report semantics

```ts
{
  verdict: 'fabrication_evidence',
  matchedRows: 142,          // document rows confirmed against the bank feed
  documentOnlyRows: [87],    // claimed rows the bank doesn't know — fake credits
  aaOnlyRows: [210, 211],    // bank rows the document omits — hidden debits
  unverifiableRows: [0],     // outside the AA window — cannot confirm or refute
  mismatches: [...],         // field-level soft diffs on matched pairs
  summary: '142/144 document rows confirmed against AA feed; ...'
}
```

### Verdicts

| Verdict                | Meaning                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `consistent`           | Every in-window document row matched the bank feed; no omissions                                     |
| `partial`              | All rows matched but soft fields differ (narration wording, posted balance) — warnings, not evidence |
| `fabrication_evidence` | Document claims rows the bank doesn't know, and/or omits rows the bank confirms — **fail closed**    |
| `incomparable`         | One side has no transactions — nothing to diff                                                       |

### Severity is honest about coverage

- **Hard evidence** is only counted _inside the AA coverage window_ —
  a document row dated outside the feed's range is `unverifiable`, not
  accused. If the AA pull only covers October, a November row can be
  neither confirmed nor refuted.
- **Soft mismatches** (`narration`, `balance`) never raise
  `fabrication_evidence` — narration wording legitimately differs
  between a bank's PDF rendering and its AA feed.
- A **one-day value/posting date drift** is tolerated by default
  (`dateWindowDays: 1`, configurable). Amounts default to exact paise
  matching (`amountTolerancePaise: 0`) — the bank's own number should
  be canonical.

## Recommended underwriting gate

```
extract document ──► reconcileWithAa(AA feed) ──► verdict
                                                  ├─ consistent → proceed to insights/scorecard
                                                  ├─ partial    → proceed, warnings attached
                                                  ├─ fabrication_evidence → manual review / reject
                                                  └─ incomparable → document-only path: forensics +
                                                                     higher scrutiny
```

When no AA consent exists for the account, the document-only path
(`inspectStatement` + `verifyStatement`) remains — reconciliation is
the upgrade when both channels exist, not a precondition.

## What this does NOT prove

- It verifies the document **against one AA feed**. A fraudster who
  controls _which_ AA feed is shown (e.g., a second undisclosed
  account) could pass — verify the account identity (masked account
  number, IFSC) matches between the document and the consent artefact.
- `consistent` proves the _rows_ are true. It says nothing about
  document provenance (a true statement from a _different_ person's
  account still reconciles — identity binding is the consent layer's
  job, which is why AA-sourced data remains the preferred channel).

## vs hosted TSP analytics

Hosted TSPs can in principle run the same diff — they see both
channels. The difference: Panini's reconciliation is **deterministic,
explainable, and runs inside your trust boundary** — every verdict
enumerates the exact rows, and no statement or AA payload leaves your
infrastructure. A black-box "fraud score" says _trust us_;
`reconcileWithAa` prints the receipts.
