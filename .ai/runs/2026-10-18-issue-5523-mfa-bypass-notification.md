# MFA bypass administrator notification

Goal: Deliver a scoped, deduplicated in-app warning to MFA administrators when emergency bypass is observed.

Source doc: .ai/specs/enterprise/2026-10-18-mfa-emergency-bypass-notification.md
Spec PR: https://github.com/open-mercato/open-mercato/pull/7618

Scope: Enterprise security notification/event, existing bypass hooks, translations, automated coverage, MFA spec changelog; optional `createBatch` deduplication options in the core notification service; shared nested-wildcard owning-module correction required by the live audience test.
Non-goals: MFA policy changes, public API/schema changes, new dependencies, unrelated worktree edits.

## Implementation Plan

### Phase 1: Delivery

1.1 Add type/translations/event/subscriber; durable daily deduplication and canonical scoped RBAC.
1.2 Connect login, enrollment and sudo detection without changing warn logs.

### Phase 2: Verification

2.1 Add regression/integration coverage and MFA spec changelog.
2.2 Validate, independently review, and publish evidence and limits.

## Risks

Independent review found a late queue-availability issue: awaiting a reconnecting enqueue could block bypass requests. Added a two-second fail-open deadline with hanging/late-rejection regressions; final focused validation and re-review are in progress. The notification write transaction owns strict per-recipient deduplication; the subscriber holds no outer transaction. Live verification exposed and fixed nested wildcard owning-module resolution so `security.mfa.*` is honored with the module registry active.

Local runner: the complete ordered gate passed at production commit `3872e33641` in a clean temporary checkout using bundled Node24.19: package build, generation, second package build, translation sync/usage, typecheck, unit tests (48/48 tasks), and app production build. This isolated unrelated local tracker/WMS edits and a Homebrew sandbox-library failure; an isolated Expo worker crash passed on recheck and on the subsequent full gate.

The later `7d4346213c` delta changes only integration assertions and a stale test comment. Enterprise typecheck and template parity passed there. Native `TC-SEC-015` using its exact committed test bytes passed against the unchanged `3872e33641` production build: concurrent logins, exact/nested-wildcard manager delivery, ordinary/other-organization exclusions, desktop/mobile notification rendering, and dismissed-warning deduplication. Manual Chromium smoke also verified the warning,390px wrapping, and dismiss-to-empty state. Evidence is published on PR7619; fault-injection and other browser locales remain for human QA, with `needs-qa` retained.

Notification enqueue failures must not disable emergency access; worker-side failures retry. Concurrent broadcasts serialize by scope/day. Missing scope never triggers a global broadcast. Local runner selected: no compose app is running. Existing unrelated worktree changes must not be staged.

## Progress

PR: #7619

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Delivery

- [x] 1.1 Add type/translations/event/subscriber — 91b3e2cd79
- [x] 1.2 Connect existing bypass hooks — 91b3e2cd79

### Phase 2: Verification

- [x] 2.1 Add coverage and documentation — 46b092ec0a
- [ ] 2.2 Validate and review
