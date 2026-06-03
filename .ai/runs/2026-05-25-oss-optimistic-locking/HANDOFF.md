# Handoff — 2026-05-25-oss-optimistic-locking

**Last updated:** 2026-06-03 (resume 5 — QA round-6, Phase 31)
**Branch:** feat/oss-optimistic-locking
**PR:** https://github.com/open-mercato/open-mercato/pull/2055
**Current phase/step:** Phase 31 COMPLETE (QA round-6). Latest develop (0.6.5) merged; all 6 round-6 findings fixed as atomic commits with unit + integration tests; checkpoint 13 verified. Awaiting CI + human re-QA.
**Last code commit:** c7b3d041b (feature_toggles identifier validator). Integration specs: 6293715d1.

## QA round-6 source
@alinadivante comment https://github.com/open-mercato/open-mercato/pull/2055#issuecomment-4613412850 — backend 409 enforcement works in more places, but several custom UI pages showed raw/generic toasts instead of the unified conflict bar; plus a pay-link stale-delete gap, a feature-toggle boolean-selector regression, and a feature-toggle identifier validation mismatch.

## Done this resume (Phase 31)
- 31.0 (91fc6abd7) Merge develop (0.6.5) + resolve 13 conflicts (interactions email-visibility, directory/staff/workflows imports, catalog variant RecordNotFoundState, catalog i18n ×4, CHANGELOG, UPGRADE_NOTES, package.json + yarn.lock).
- 31.1 (a965a099c) Customer Users page: route the apiCall 409 envelope through `surfaceRecordConflict` on save + delete.
- 31.2 (bae74923e) Customer Roles page: same on save + delete.
- 31.3 (d120f11b6) Inbox Settings working-language PATCH: same.
- 31.4 (1f0984274) Feature Toggle GLOBAL default-value boolean selector now normalizes via `booleanOverrideSelectValue` (b4a672a only fixed the per-tenant override card).
- 31.5 (ec804ef20) Pay Links stale DELETE: client sends version header + surfaces conflict; `checkout.link.delete` / `checkout.template.delete` commands now call `enforceCommandOptimisticLock`.
- 31.6 (c7b3d041b) Feature Toggle identifier validator relaxed to allow dots/dashes (`/^[a-z][a-z0-9_.-]*$/`).
- Integration specs (6293715d1): TC-CHKT-039, TC-LOCK-OSS-014, TC-LOCK-OSS-015, TC-FT-003.

## Root-cause pattern (round-6)
The custom admin pages already SENT the version header and the server already returned 409 (round-5). The gap was client surfacing: their `apiCall` returns `{ ok:false, status:409 }` (does NOT throw), so the conflict never reached `useGuardedMutation`/CrudForm auto-surfacing and the `!call.ok` branch showed a generic toast. Fix = detect the 409 in that branch via `surfaceRecordConflict({ status: call.status, body: call.result }, t)`. Pay-links had a real server gap (delete command unguarded) on top of the client gap.

## Verification (checkpoint 13)
- typecheck (core/ui/checkout) ✅; build:packages ✅; targeted unit tests ✅ (ui conflicts 6/6, checkout lock 12/12, ft boolean 4/4, ft identifier 4/4).
- Integration (ephemeral, OM_OPTIMISTIC_LOCK=all): TC-CHKT-039 + TC-LOCK-OSS-013/014/015 + TC-FT-003 — see checkpoint-13-checks.md.

## Environment / build (worktree)
- Worktree: `.ai/tmp/auto-continue-pr/pr-2055-20260603-163832`. Build order matters: `yarn generate` then `yarn build:packages` (the ephemeral runner imports `packages/core/dist/generated/entities.ids.generated.js`).
- Ephemeral integration: `yarn mercato test:integration <spec paths>` with `OM_OPTIMISTIC_LOCK=all`.
