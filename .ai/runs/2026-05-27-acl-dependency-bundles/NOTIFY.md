# Notify — 2026-05-27-acl-dependency-bundles

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-05-27T17:45Z — run complete
- PR #2141 opened against `develop`, labels normalized (`review` + `needs-qa` + `feature`), three-signal in-progress lock claimed.
- 43 per-module follow-up issues filed (#2142..#2184); the sales follow-up #2142 is the original 2073 case and is marked Most Urgent in the body.
- Final-gate log: `.ai/runs/2026-05-27-acl-dependency-bundles/final-gate-checks.md` (all hard gates green; jsdom panel test deferred to CI due to janitor-host React 19 / @testing-library@16 issue).
- Lock release happens immediately after the summary comment posts.

## 2026-05-27T17:26Z — checkpoint 1
- Steps 1.1..3.1 verified. `checkpoint-1-checks.md` written. Pre-existing workspace `@open-mercato/cache` resolution failures reproduced against `origin/develop` → not a regression introduced by this PR. No UI changes in window → Playwright skipped, no artifacts.

## 2026-05-27T17:15Z — run started
- Brief: turn alinadivante's PR #2073 QA finding into a feature: declare ACL feature dependencies, warn at role/user edit time when a granted feature is missing its deps (or a dep is being removed while its dependents are kept).
- External skill URLs: none.
- Slot: feat/acl-dependency-bundles claimed by @pkarw (no prior owner).
