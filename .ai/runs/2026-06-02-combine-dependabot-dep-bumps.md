# Combine Dependabot dependency bumps (#2394 + #2395) into one PR against develop

## Overview

Dependabot opened two dependency PRs against `main`:

- **#2394** — `chore(deps): bump the minor-and-patch group with 36 updates`
- **#2395** — `chore(deps): bump the major group with 3 updates` (`pdfjs-dist` 5→6, `isolated-vm` 6→7, `undici` 7→8 transitive)

This run combines both into a single PR targeting **`develop`** (not `main`), regenerates a single coherent `yarn.lock`, validates the build/typecheck/test gate, and closes the two original Dependabot PRs.

### External References

None (`--skill-url` not used).

## Goal

Land both Dependabot dependency groups as one validated PR against `develop`, then close #2394 and #2395.

## Scope

- `package.json` (root + all workspace packages) version bumps from both groups.
- Regenerated `yarn.lock`.

### Non-goals

- No source-code refactors beyond what the major bumps (`pdfjs-dist` v6, `isolated-vm` v7) require for compatibility.
- No unrelated dependency changes outside the two Dependabot groups.
- Do not bump `peerDependencies` ranges (`@mikro-orm/core ^7.0.14`, `bullmq ^5.0.0`, `ioredis ^5.0.0`) — only the concrete dependency declarations the Dependabot commits touched.

## Risks

- **`pdfjs-dist` 5→6 (major)** — used in `packages/core/src/modules/attachments/lib/{pdfProcessing,textExtraction,ocrService}.ts` via the stable `getDocument`/`getTextContent`/`page.render` legacy-build API. Covered by `attachments/lib/__tests__/{textExtraction,ocrService}.test.ts`.
- **`isolated-vm` 6→7 (major, native module)** — used in `packages/ai-assistant/.../lib/sandbox.ts` via stable `Isolate`/`Context`/`ExternalCopy`/`evalClosure` API. Main risk is native compile/prebuilt availability at install time.
- **`undici` 7→8 (transitive major)** — used in `packages/shared/src/lib/url-safety.ts`; develop already carries `^8.3.0` in one package.
- `develop` diverged from `main` (where Dependabot branched), so the bumps were rebased onto `develop` versions via cherry-pick conflict resolution.

## Implementation Plan

### Phase 1: Combine dependency manifests

- 1.1 Apply both Dependabot commits' `package.json` bumps onto a `develop`-based branch, resolving conflicts (keep develop-only deps like `cmdk`; take both `next` minor and `pdfjs-dist` major).
- 1.2 Regenerate `yarn.lock` with `yarn install`.

### Phase 2: Validate

- 2.1 Targeted: typecheck + attachments + ai_assistant unit tests (the major-bump consumers).
- 2.2 Full gate: `yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`.

### Phase 3: PR + close originals

- 3.1 Open PR against `develop`; apply `review` + `dependencies` labels.
- 3.2 Close #2394 and #2395 with a pointer to the combined PR.
- 3.3 Run `auto-review-pr` autofix pass; post summary comment.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Combine dependency manifests

- [x] 1.1 Apply both groups' package.json bumps onto develop, resolve conflicts — aa8a34ca9
- [x] 1.2 Regenerate yarn.lock via yarn install — aa8a34ca9

### Phase 2: Validate

- [x] 2.1 Targeted typecheck + attachments/ai_assistant tests — 59fa33b29
- [x] 2.2 Full validation gate (1 pre-existing unrelated api_keys mock failure documented) — 59fa33b29

### Phase 3: PR + close originals

- [x] 3.1 Open PR against develop with labels — PR #2403
- [x] 3.2 Close #2394 and #2395 (superseded by #2403)
- [x] 3.3 auto-review-pr pass + summary comment — APPROVED, moved to qa
