# Execution plan — Start building (Cezar) splash action and dev-only preview framing (adopted from PR #7866)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-10-22 because PR #7866 carried no execution plan.
**PR:** #7866 · **Branch:** `feat/7790-start-building` · **Base:** `main`
**Author:** @wojciechszyjka — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Ship issue #7790's initial behavior — a **Start building** splash button that launches plain `npx cezar-run` for the current project — plus dev-only loopback framing so Cezar's Preview pane can show the app, with production framing unchanged.

## Scope

- `scripts/dev-splash-coding-flow.mjs`, `scripts/dev-splash.html`, `scripts/dev.mjs`, `scripts/dev-ephemeral.ts` and their create-app template mirrors.
- `apps/mercato/next.config.ts` and `packages/create-app/template/next.config.ts` frame headers.
- Splash spec, setup docs, create-app README.

## Non-goals

- The enhanced handoff (preview URL passed to Cezar) — waits for open-mercato/cezar#1608.
- The forms `/embed/:slug` per-distribution frame policy carve-out (tracked in the forms spec).
- Any production header change.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| Initial behavior is plain `npx cezar-run`, no flags, no task | issue #7790 Delivery §1, acceptance criteria | high |
| Reuse POST-only, local-request, token, busy and duplicate-click guards; nothing executable from the browser | issue #7790 Implementation guidance §2 | high |
| Production must keep `frame-ancestors 'self'` and `X-Frame-Options` | PR body Merge Danger, run brief | high |
| Already implemented in one commit | `git log origin/main..HEAD` | high |

## Assumptions

- The Next.js phase (`PHASE_DEVELOPMENT_SERVER`) is the right gate for loopback framing. `NODE_ENV` is not: `mercato server dev` runs `next dev` with `NODE_ENV=production` (observed on the running app), and `next build` keeps a preset `test`/custom value while baking headers into the build. Step 2.1 first narrowed the gate to `NODE_ENV === 'development'`; step 2.2 replaced it with the phase after runtime verification showed the dev app still sent `X-Frame-Options`.
- The pre-existing `detectSplashCodingTools finds Linux fallback binaries outside PATH` failure is host-specific (`/usr/bin/claude` exists on the run host) and fails on `main` too; it is not in scope.

## Risks

- Relaxed framing reaching a production build — mitigated by the narrower gate and tests for `production`, `test` and a custom `NODE_ENV`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Start building splash action, template mirror, dev-only framing, tests and docs — ccbfa737b

### Phase 2: Review hardening

- [x] 2.1 Restrict loopback framing to NODE_ENV=development with strict-mode tests — 34be68199
- [x] 2.2 Gate loopback framing on the Next.js development-server phase — a7f40b7e0

### Phase 3: Runtime verification

- [ ] 3.1 Verify dev and production frame headers on a running app
- [x] 3.2 Verify the splash button and the launch action with a test double — 1d5ff8441

### Phase 4: Finish

- [ ] 4.1 Full validation gate
- [ ] 4.2 om-auto-review-pr autofix pass
- [ ] 4.3 Evidence, labels and ready for review
