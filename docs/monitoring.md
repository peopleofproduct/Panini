# Recurring monitoring & consent lifecycle — the open-ended kit

> Audience: lenders who want Smart Collect-style portfolio monitoring
> and consent-lifecycle management **without** buying a hosted platform —
> compose it from Panini's deterministic kernel + your own
> infrastructure.

## The composition principle

Every monitoring product is three separable concerns:

| Concern                    | Who owns it                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------ |
| **Getting fresh data**     | You — your AA contracts via `@paniniapi/fiu-client`, a TSP SDK, or file drops        |
| **Detecting what changed** | Panini — `statementDiff`, `detectMonitoringEvents`, `consentStatus`, `sweepConsents` |
| **Delivering the alert**   | You — webhooks, queues, LOS tickets, pager                                           |

Panini ships the deterministic middle plus thin seams for both ends.
The lender's composition _is_ the complete product — there is no
"partial package" dead end, because everything operational was designed
as a plug from the start. Same philosophy as `OcrProvider`,
`FetchLike`, and `QueueOcrProvider`: the kernel is provable, the
plumbing is yours.

## Monitoring kernel (`@paniniapi/insights`)

```ts
import { runMonitorCycle, statementDiff, detectMonitoringEvents } from '@paniniapi/insights';

await runMonitorCycle({
  key: 'borrower-12345',
  source: mySource, // ← your AA pull / TSP / file-drop adapter
  store: myStore, // ← your database
  sink: mySink, // ← optional: your webhook/queue
  rules: { balanceDropFraction: 0.3 },
  now: () => new Date(),
});
```

### The three seams

```ts
interface StatementSource {
  name: string;
  fetch(key: string): Promise<readonly InsightTransaction[]>;
}
// Wrap fiu-client: consent → fetch → decrypt → InsightTransaction[]
// Or wrap a TSP SDK. Or read a file drop. Any source qualifies.

interface SnapshotStore {
  load(key: string): Promise<MonitorSnapshot | null>;
  save(key: string, snapshot: MonitorSnapshot): Promise<void>;
}
// Two methods. Postgres, Redis, S3 — your choice.

interface AlertSink {
  name: string;
  emit(events: readonly MonitoringEvent[]): Promise<void>;
}
// Omit it entirely and handle the returned events yourself.
```

### Event rules (deterministic, rule-Id'd, threshold-tunable)

| Rule ID                      | Severity    | Fires when                                                    |
| ---------------------------- | ----------- | ------------------------------------------------------------- |
| `monitor.baseline`           | info        | First capture — no history to compare                         |
| `monitor.new_activity`       | info        | Rows added since last snapshot (counts + credit/debit totals) |
| `monitor.income_source_lost` | high        | A salary/income source in the previous report is absent now   |
| `monitor.balance_drop`       | high        | Closing balance fell > `balanceDropFraction` (default 30%)    |
| `monitor.new_obligation`     | medium      | A recurring EMI counterparty appeared that wasn't there       |
| `monitor.obligation_stopped` | medium      | An EMI stopped recurring — closed early _or_ bounced          |
| `monitor.signal:{ruleId}`    | from signal | Any insights risk signal fired that wasn't firing before      |
| `monitor.large_debit`        | medium      | An added debit exceeds `max(floor, median debit × mult)`      |

Every threshold lives in `MonitorRules` — your risk team owns the
numbers, Panini owns the determinism.

### Example: wiring fiu-client as the source

```ts
import { createMultiFiuClient, transactionsFromAaData } from '…';

const source: StatementSource = {
  name: 'direct-aa',
  async fetch(key) {
    const { fiData } = await fiu.fetchFi(consentFor(key));
    return transactionsFromAaData(fiData).map(toInsightTxn);
  },
};
```

## Consent lifecycle (`@paniniapi/fiu-client`)

```ts
import { consentStatus, sweepConsents } from '@paniniapi/fiu-client';

consentStatus(artefact, new Date(), (renewalLeadDays = 7));
// → { lifecycle: 'active'|'expiring'|'expired'|'revoked'|…,
//     daysToExpiry, renewalDue }
```

`sweepConsents(store, now, leadDays)` walks a caller-owned
`ConsentStore` (`load`/`save`/`list`) and buckets every tracked
artefact into `renewing` / `expired` / `revoked` / `others` — the
nightly job that finds which consents need renewal journeys and which
are dead. AA renewal flows differ per aggregator; the sweep tells you
_which_ consents to act on, your AA contracts decide _how_.

## What this does NOT replace (honest scope)

- **AA contracts** — every aggregator is a bilateral signup; that
  business work is why hosted TSPs exist. Panini makes owning the
  plumbing viable _after_ the contracts exist.
- **Operated uptime/failover** — your scheduler, your retry policy.
- **Consent UX** — artefact dashboards and borrower-facing renewal
  journeys are product work on top of `consentStatus`.

What it does replace: the per-fetch meter, the black-box change
detection, and the data-transit exposure — monitoring events carry
rule IDs + transaction evidence inside your boundary.
