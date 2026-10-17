# Security Policy

Project Panini processes financial narration data — we take security seriously.
The engine is deliberately designed to process everything **in memory, on your
host**, with zero outbound network calls and zero telemetry by default.

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security reports.

Use GitHub's private vulnerability reporting for this repository
(**Security → Report a vulnerability**), which notifies the maintainers
privately. Include:

- Affected version / commit
- Reproduction steps or proof of concept
- Impact assessment (e.g., potential PII exposure, parser crash vectors)

We aim to acknowledge reports within 72 hours and will coordinate disclosure
with you before publishing any advisory.

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | ✅ current release |

## Security-relevant design guarantees

- No network I/O anywhere in `@panini/core` or `@panini/standards-schema`
- Telemetry hooks are opt-in only and structurally exclude raw narration
  text, counterparties, transaction IDs, VPAs, and amounts
- The optional ops layer (`OpsProxy`) never ships PII — its telemetry
  event type has no field capable of carrying it
