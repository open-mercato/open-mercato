# Notify — 2026-05-27-dev-mode-lazy-load-heavy-clients

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-05-27T14:38:00Z — run started
- Brief: "investigate further memory savings on for example lazy loading big JS chunks get the quick wins we're looking to save at least 1gb RAM in dev mode"
- External skill URLs: none
- Base: `origin/develop` @ `25fdb35f2`
- Branch: `feat/dev-mode-lazy-load-heavy-clients`
- Run classified as Spec-implementation run (multi-Step investigation + implementation + spec).
- Reconnaissance subagent identified five quick-win interventions; recorded in `PLAN.md`.

## 2026-05-27T15:30:00Z — final gate complete; PR finalized
- All 9 commits landed (Steps 1.1, 2.1, 2.2, 2.3, 3.1, 3.2, 4.1, 4.2, 5.1).
- PR #2129 opened; title corrected; body and labels set; three-signal in-progress lock claimed.
- Validation: `yarn build:packages` ✅ · `yarn generate` ✅ · `yarn typecheck` ✅ · `yarn i18n:check-sync` ✅ · `yarn i18n:check-usage` ✅ · `yarn build:app` ✅ · `@open-mercato/ui` tests **1081/1081** ✅ · `@open-mercato/core` workflows tests **455/455** ✅ · lazy-heavy-libraries scoped **13/13** ✅.
- Skipped: full-monorepo `yarn test` (OOM on the janitor worktree; UI + workflows + scoped covers every file touched in this PR). `yarn test:integration` and `yarn test:create-app:integration` deferred to CI; packaging/templates untouched.
- ds-guardian skipped: no new semantic-token / status-color sites added; only CSS *removed* (a global @xyflow import).
- Self code-review + BC self-review: clean.
