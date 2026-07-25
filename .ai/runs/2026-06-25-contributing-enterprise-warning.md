# Execution Plan — Add enterprise-module contribution warning to CONTRIBUTING.md

## Overview

Add a clear warning to `CONTRIBUTING.md` explaining that we cannot accept external
contributions to the commercial enterprise module (`@open-mercato/enterprise`,
`packages/enterprise/`) because of licensing and intellectual-property / IP-transfer
constraints. The enterprise package is proprietary, commercial software governed by a
separate license; merging outside contributions into it would create copyright /
IP-ownership complications that the project's open-source CLA cannot resolve.

This is a **docs-only** change.

### Goal

Make it unambiguous to would-be contributors that PRs touching `packages/enterprise/`
will not be accepted, and point them at the appropriate channel (partnership program /
commercial licensing) instead.

### Affected files

- `CONTRIBUTING.md` (single edit — new section)

### Non-goals

- No changes to the enterprise license text, the CLA, or any code.
- No changes to PR automation, labels, or CI.
- No new policy beyond restating the existing commercial-license reality.

### External References

None (`--skill-url` not used).

### Risks

- Low. Docs-only. Worst case is wording that under- or over-states the policy; mitigated
  by grounding the language in the existing `packages/enterprise/LICENSE.md` and
  `apps/docs/cla.md`.

## Implementation Plan

### Phase 1: Add the warning section

- Insert a dedicated "Enterprise Module Contributions" section into `CONTRIBUTING.md`
  near the Pull Requests guidance, stating that contributions to
  `packages/enterprise/` cannot be accepted due to licensing / IP-transfer constraints,
  and linking to the enterprise license and partnership program.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Add the warning section

- [x] 1.1 Add "Enterprise Module Contributions" warning section to CONTRIBUTING.md — 2c7aff04e
