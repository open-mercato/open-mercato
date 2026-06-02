# Consolidate Dependabot PRs #2394 + #2395 into one PR against `develop`

## Goal

Merge the dependency version bumps from dependabot PRs **#2394** (minor-and-patch group, ~33 direct deps) and **#2395** (major group: `pdfjs-dist` 5→6, `isolated-vm` 6→7, `undici` 7→8) into a single PR targeting `develop`, then close both originals as superseded. The dependabot PRs target `main`; this PR re-homes the bumps on `develop`.

## Scope

- Apply the direct `package.json` version bumps from both PRs across the monorepo workspaces.
- Regenerate `yarn.lock` via `yarn install` so the lockfile is internally consistent for `develop` (do NOT hand-copy dependabot's lockfile diff — develop has diverged from main).
- Validate build/typecheck/tests, paying special attention to the three major bumps.
- Close PR #2394 and #2395 with a comment pointing at the new PR.

### Key facts established during triage

- `develop`'s current direct-dep versions **exactly match** both PRs' "from" values (e.g. `@ai-sdk/openai ^3.0.65`, `@mikro-orm/core ^7.1.1`, `next 16.2.6`, `react 19.2.6`, `pdfjs-dist ^5.7.284`, `isolated-vm ^6.1.2`), so the bumps apply cleanly.
- `@napi-rs/canvas` is already at the major target `^1.0.0` on `develop` (only a lockfile resolution remains).
- `undici` direct pins on develop: root `package.json` pins `7.24.0` (exact); `packages/shared` already requires `^8.3.0`. The major bump = move root pin to `8.3.0` so the lockfile collapses to a single undici 8.x.

## Non-goals

- No source-code refactors beyond what the major bumps strictly require to typecheck/build.
- No changes to dependencies not listed in either PR.
- No changes to CI, scripts, or module structure.

## Risks

- **Major bumps** (`pdfjs-dist` 5→6, `isolated-vm` 6→7, `undici` 7→8) may introduce API/behavior changes. `pdfjs-dist` 6.0 has documented `[api-major]` changes; `isolated-vm` 7 is a native rebuild; `undici` 8 drops Node < 20. Mitigation: full typecheck + build:app + targeted grep of usage sites.
- Lockfile regeneration is large; risk of accidental unrelated dep drift. Mitigation: review `git diff` of package.json files to confirm only intended deps changed; lockfile churn is expected.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Apply package.json bumps

- [ ] 1.1 Apply PR #2394 minor/patch version bumps to all workspace package.json files
- [ ] 1.2 Apply PR #2395 major version bumps (pdfjs-dist, isolated-vm, undici root pin)

### Phase 2: Regenerate lockfile and validate

- [ ] 2.1 Run `yarn install` to regenerate yarn.lock; confirm single undici 8.x
- [ ] 2.2 Run targeted typecheck/build for major-bump consumers (core, ai-assistant, mercato)

### Phase 3: Full gate and review

- [ ] 3.1 Full validation gate (generate, build:packages, typecheck, test, build:app)
- [ ] 3.2 Self code-review + BC review

### Phase 4: PR and close originals

- [ ] 4.1 Open consolidated PR against develop, apply labels
- [ ] 4.2 Close #2394 and #2395 referencing the new PR
