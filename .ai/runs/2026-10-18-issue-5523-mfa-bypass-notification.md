# MFA bypass administrator notification

Goal: Deliver a scoped, deduplicated in-app warning to MFA administrators when emergency bypass is observed.

Source doc: .ai/specs/enterprise/2026-10-18-mfa-emergency-bypass-notification.md
Spec PR: https://github.com/open-mercato/open-mercato/pull/7618

Scope: Enterprise security notification/event, existing bypass hooks, translations, automated coverage, MFA spec changelog.
Non-goals: MFA policy changes, public API/schema changes, new dependencies, unrelated worktree edits.

## Implementation Plan

### Phase 1: Delivery

1.1 Add type/translations/event/subscriber; durable daily deduplication and canonical scoped RBAC.
1.2 Connect login, enrollment and sudo detection without changing warn logs.

### Phase 2: Verification

2.1 Add regression/integration coverage and MFA spec changelog.
2.2 Validate, independently review, and publish evidence and limits.

## Risks

Notification enqueue failures must not disable emergency access; worker-side failures retry. Concurrent broadcasts serialize by scope/day. Missing scope never triggers a global broadcast. Local runner selected: no compose app is running. Existing unrelated worktree changes must not be staged.

## Progress

PR: #7619

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Delivery

- [x] 1.1 Add type/translations/event/subscriber — 91b3e2cd79
- [x] 1.2 Connect existing bypass hooks — 91b3e2cd79

### Phase 2: Verification

- [ ] 2.1 Add coverage and documentation
- [ ] 2.2 Validate and review
