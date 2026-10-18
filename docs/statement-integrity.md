# Statement integrity & tamper forensics

`@paniniapi/forensics` answers the question every automated lender asks
about uploaded statements: **"was this document altered after the bank
produced it?"** — deterministically, in-process, with explainable
evidence instead of a black-box risk score.

```ts
import { inspectStatement } from '@paniniapi/forensics';

const report = await inspectStatement(pdfBytes, {
  trustStore: [bankRootPem], // optional CA anchors for chain checks
});
// report.verdict: 'clean' | 'warnings' | 'tamper_evidence' | 'inconclusive'
// report.signals: [{ ruleId, severity, message, evidence }]
```

## What it checks

### Arithmetic consistency (every format)

The running balance is a checksum covering every row — the strongest
deterministic signal available:

| Rule                       | Fires when                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `math.balance_chain_break` | a row's balance ≠ previous balance ± amount (one edited amount breaks every link after it) |
| `math.opening_mismatch`    | first row's implied opening ≠ stated opening balance                                       |
| `math.closing_mismatch`    | last balance ≠ stated closing balance                                                      |
| `math.out_of_period`       | transactions dated outside the stated period                                               |
| `math.duplicate_rows`      | identical date+narration+amount rows (copy-paste fabrication signature)                    |

Every signal carries the row index and expected-vs-actual paise values —
auditable by a credit officer or a downstream rules engine.

### PDF container forensics

| Rule                                                        | Fires when                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pdf.incremental_update`                                    | multiple `%%EOF`/`startxref` — content appended after generation                                              |
| `pdf.editor_producer`                                       | `/Producer` or `/Creator` names a consumer editor (iLovePDF, PDFescape, wkhtmltopdf, …)                       |
| `pdf.modified_after_creation` / `pdf.modified_after_period` | `/ModDate` later than creation / statement period end                                                         |
| `pdf.acroform_overlay`                                      | interactive form fields exist with no signature (fill-in overlays)                                            |
| `pdf.covering_annotations`                                  | FreeText/Stamp/Highlight annotations that can hide content                                                    |
| `pdf.invisible_text`                                        | text rendered in invisible modes (`Tr 3`/`Tr 7`)                                                              |
| `pdf.overlapping_text`                                      | two fragments at the same position with different text — the "type _Salary_ over the loan-bounce line" attack |

### Digital signatures (full CMS validation)

When a statement carries `/ByteRange`+`/Contents` signature fields
(adbe.pkcs7.detached / ETSI.CAdES):

1. **Post-sign bytes** — anything after the signed range → `sig.post_sign_append`.
2. **Digest binding** — SHA over the signed ranges vs the CMS
   `messageDigest` attribute → `sig.digest_mismatch` (conclusive tamper).
3. **Cryptographic signature** — RSA PKCS#1 or ECDSA over signedAttrs via
   `node:crypto` → `sig.invalid`.
4. **Chain** — embedded certs walked to a caller-supplied trust store →
   `sig.chain_untrusted`. Bank e-statements typically chain to CCA-India
   roots; load them via `trustStore` (PEM strings or `X509Certificate`s).

`sig.verified` (info) means: the bytes you parsed are provably the bytes
the signer produced.

## Verdict semantics

| Verdict           | Meaning                                               |
| ----------------- | ----------------------------------------------------- |
| `tamper_evidence` | ≥1 critical signal — **do not auto-approve**          |
| `warnings`        | reviewer-worthy anomalies only                        |
| `clean`           | all applicable checks passed                          |
| `inconclusive`    | nothing checkable (no transactions, unreadable input) |

CSV/SMS carry no container integrity — they get arithmetic checks plus an
explicit `container.no_integrity_layer` info signal. The report never
pretends a text format is tamper-evident.

## Honest limits

- This is **deterministic evidence, not behavioral ML** — it catches
  edited bytes, broken arithmetic, invisible overlays, and invalid
  signatures. It does not profile fraud "likelihood" the way commercial
  suites claim to.
- Unsigned PDFs are common even from real banks — unsigned ≠ tampered;
  consistency checks still run.
- For regulated lending, uploaded files should be a _fallback_ channel:
  Account Aggregator data (see `@paniniapi/fiu-client`) is signed by the
  bank's FIP at source — tamper-proof by construction.

## BSA integration

`panini-bsa` runs forensics on every file by default — the JSON report
carries `statements[].integrity`, the Markdown report gets a Document
Integrity section, and the CLI exits `3` on `tamper_evidence` so CI/CD
gates can block on it. `--no-forensics` disables.
