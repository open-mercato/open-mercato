# Notify — 2026-05-27-acl-dependency-bundles

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-05-27T17:26Z — checkpoint 1
- Steps 1.1..3.1 verified. `checkpoint-1-checks.md` written. Pre-existing workspace `@open-mercato/cache` resolution failures reproduced against `origin/develop` → not a regression introduced by this PR. No UI changes in window → Playwright skipped, no artifacts.

## 2026-05-27T17:15Z — run started
- Brief: turn alinadivante's PR #2073 QA finding into a feature: declare ACL feature dependencies, warn at role/user edit time when a granted feature is missing its deps (or a dep is being removed while its dependents are kept).
- External skill URLs: none.
- Slot: feat/acl-dependency-bundles claimed by @pkarw (no prior owner).
