---
title: Migrate Dependabot PRs #1888–#1892 to develop
date: 2026-05-12
status: in-progress
related-prs:
  - https://github.com/open-mercato/open-mercato/pull/1888
  - https://github.com/open-mercato/open-mercato/pull/1889
  - https://github.com/open-mercato/open-mercato/pull/1890
  - https://github.com/open-mercato/open-mercato/pull/1891
  - https://github.com/open-mercato/open-mercato/pull/1892
precedent:
  - .ai/runs/2026-05-04-dep-bumps-migrate-to-develop.md
  - .ai/runs/2026-04-21-dep-bumps-migrate-to-develop.md
---

## Goal

Combine the five open Dependabot PRs targeting `main` ([#1888 minor-and-patch group](https://github.com/open-mercato/open-mercato/pull/1888), [#1889 major group](https://github.com/open-mercato/open-mercato/pull/1889), [#1890 mermaid](https://github.com/open-mercato/open-mercato/pull/1890), [#1891 next (apps/mercato)](https://github.com/open-mercato/open-mercato/pull/1891), [#1892 next (root + apps/mercato)](https://github.com/open-mercato/open-mercato/pull/1892)) into a single PR against `develop` and close the originals, so the next release cycle picks up the dependency bumps without re-opening separate Dependabot branches against the moving `develop` base.

## Scope

This run follows the precedent set by PR #1625 and `.ai/runs/2026-05-04-dep-bumps-migrate-to-develop.md`. The BC-breaker landscape on `develop@9ee0441ad` is essentially the same as in the previous run:

- `typescript ^5.9.3` would jump to `^6.0.3` — still requires per-tsconfig `moduleResolution` changes
- `awilix ^12.0.5` would jump to `^13.0.3` — still requires 100+ DI call sites to be re-typed
- New skips this run: `@napi-rs/canvas`, `html-to-text`, `undici`, `react-day-picker` (all v0/v9/v7/v9 → next major; cross-runtime impact not investigated)

### In scope — bumps to apply

#### From #1888 (minor-and-patch group, ~43 updates)

All bumps from #1888 apply cleanly because their major version ranges already match the `^` semver caretranges currently on `develop`. Highlights:

| Package | From (develop) | To | Files |
|---------|---------------|----|-------|
| `@ai-sdk/openai` | `^3.0.53` | `^3.0.63` | root, apps/mercato, packages/ai-assistant, packages/search |
| `@ai-sdk/anthropic` | `^3.0.71` | `^3.0.76` | packages/ai-assistant |
| `@ai-sdk/google` | `^3.0.64` | `^3.0.71` | packages/ai-assistant, packages/search |
| `@ai-sdk/amazon-bedrock` | `^4.0.96` | `^4.0.103` | packages/search |
| `@ai-sdk/cohere` | `^3.0.30` | `^3.0.35` | packages/search |
| `@ai-sdk/mistral` | `^3.0.30` | `^3.0.36` | packages/search |
| `@mikro-orm/{core,decorators,migrations,postgresql}` | `^7.0.14` | `^7.0.15` | root + 4 packages |
| `@tanstack/react-query` | `^5.100.5` | `^5.100.10` | root, apps/mercato |
| `@tanstack/react-virtual` | `^3.13.23` | `^3.13.24` | packages/ui |
| `ai` | `^6.0.168` / `6.0.168` | `^6.0.177` / `6.0.177` | root (resolution + dep), apps/mercato, packages/ai-assistant, packages/core, packages/search |
| `next` + `eslint-config-next` | `16.2.4` | `16.2.6` | root, apps/mercato |
| `pdfjs-dist` | `^5.4.149` | `^5.7.284` | root, apps/mercato, packages/core |
| `react` + `react-dom` | `19.2.5` / `^19.2.5` | `19.2.6` / `^19.2.6` | root, apps/mercato, apps/docs |
| `react-email` | `^6.0.0` | `^6.1.1` | root, apps/mercato |
| `resend` | `^6.12.0` | `^6.12.3` | root, apps/mercato |
| `semver` | `^7.7.4` | `^7.8.0` | root, apps/mercato, packages/cli, packages/core |
| `tailwind-merge` | `^3.5.0` | `^3.6.0` | root, apps/mercato |
| `zod` | `4.3.6` / `^4.3.6` | `4.4.3` / `^4.4.3` | root, apps/mercato, packages/search |
| `@types/node` | `^25.6.0` | `^25.6.2` | root, apps/docs, apps/mercato, packages/cache, packages/create-app, packages/queue, packages/scheduler |
| `eslint` | `^10.2.1` | `^10.3.0` | root, apps/mercato |
| `jest` | `^30.3.0` | `^30.4.2` | root + many packages |
| `jest-environment-jsdom` | `^30.3.0` | `^30.4.1` / `^30.4.2` | root, packages/core, packages/ui |
| `turbo` | `^2.9.6` | `^2.9.12` | root |
| `@docusaurus/{core,preset-classic,theme-classic,theme-mermaid}` | `^3.10.0` | `^3.10.1` | apps/docs |
| `@stripe/react-stripe-js` | `^6.2.0` | `^6.3.0` | apps/mercato, packages/gateway-stripe |
| `stripe` | `^22.1.0` | `^22.1.1` | packages/gateway-stripe |
| `bullmq` | `^5.76.2` | `^5.76.7` | apps/mercato |
| `@tailwindcss/postcss` + `tailwindcss` | `^4.2.4` | `^4.3.0` | apps/mercato |
| `tar` | `^7.5.13` | `^7.5.15` | packages/create-app |
| `openid-client` | `^6.8.3` | `^6.8.4` | packages/enterprise |
| `meilisearch` | `^0.57.0` | `^0.58.0` | packages/search |
| `rate-limiter-flexible` | `^11.0.1` | `^11.1.0` | packages/shared |
| `sanitize-html` | `^2.17.2` | `^2.17.3` | packages/shared |
| `@types/chance` | `^1.1.7` | `^1.1.8` | packages/core |

#### From #1890 (mermaid)

`mermaid` is a transitive dep (no direct `package.json` entry). The transitive bump to `11.15.0` will be picked up automatically by `yarn install` once `@docusaurus/theme-mermaid` is bumped to `^3.10.1` (from #1888). No additional action needed.

#### From #1891 / #1892 (next 16.2.4 → 16.2.6)

Covered by #1888 above (which bumps `next` and `eslint-config-next` to `16.2.6` in root + apps/mercato). No additional action needed.

### Out of scope — bumps to skip

| Package | PR target | Why skipped |
|---------|----------|-------------|
| `typescript` | `^6.0.3` | v6 deprecates `moduleResolution=node10` (`error TS5107`) across every package `tsconfig.json` — same rationale as the 2026-05-04 run |
| `awilix` | `^13.0.3` | v13 changed `Cradle` generic default from `any` to `{}`, making `container.resolve('em')` return `unknown` at 100+ DI call sites — same rationale as the 2026-05-04 run |
| `@napi-rs/canvas` | `^1.0.0` | Major version jump; v1.0.0 ships a new minimum-Node runtime and API changes (skia-canvas built-in flag) — not audited in this run |
| `html-to-text` | `^10.0.0` | Major version jump; v10 drops Node 18 and reworks the formatter API surface — not audited |
| `undici` | `^8.2.0` | Major version jump; v8 changes default fetch behavior and minimum Node — not audited |
| `react-day-picker` | `^10.0.0` | Major version jump; v10 reworks the public component API surface — not audited |

These remain at develop's current versions. The Dependabot PRs themselves stay open against `main` and will be closed by this PR; once develop merges to main on the next release, Dependabot will re-evaluate.

## External References

- Precedent runs: `.ai/runs/2026-05-04-dep-bumps-migrate-to-develop.md`, `.ai/runs/2026-04-21-dep-bumps-migrate-to-develop.md`
- Reference PR: [#1625](https://github.com/open-mercato/open-mercato/pull/1625) — establishes the "consolidated PR against develop" pattern

No `--skill-url` provided.

## Phases

### Phase 1: Apply package.json bumps and regenerate lockfile

1.1 Apply minor-and-patch bumps from #1888 across all affected `package.json` files.
1.2 Run `yarn install` to regenerate `yarn.lock` (this also picks up the transitive `mermaid` bump from #1890).
1.3 Spot-check `yarn.lock` to confirm `next@16.2.6`, `mermaid@^11.15.x`, `@mikro-orm/core@7.0.15`, etc. resolved.

### Phase 2: Validation gate

2.1 `yarn build:packages`
2.2 `yarn generate`
2.3 `yarn build:packages` (post-generate)
2.4 `yarn i18n:check-sync`
2.5 `yarn i18n:check-usage`
2.6 `yarn typecheck`
2.7 `yarn test`
2.8 `yarn build:app`

### Phase 3: Open PR and close originals

3.1 Push branch.
3.2 Open consolidated PR against `develop`.
3.3 Close PRs #1888, #1889, #1890, #1891, #1892 with a short pointer comment to the consolidated PR.

## Backward Compatibility

No contract surface changes. Public types/exports/event IDs/widget spot IDs/ACL IDs/import paths are not affected by within-major dependency bumps. The only runtime-visible changes come from the bumped dependency versions themselves; the BC-breaking package majors (`typescript`, `awilix`, `@napi-rs/canvas`, `html-to-text`, `undici`, `react-day-picker`) have been excluded.

## Risks

- **Transitive `mermaid` bump may not match #1890 exactly** — #1890 used `mermaid@11.15.0`. The version resolved by `yarn install` depends on the `mermaid` range declared by `@docusaurus/theme-mermaid@3.10.1`. If it lands ≥ `11.15.0` the spirit of #1890 is honored. If not, leave as-is — `mermaid` is only used through docusaurus.
- **React 19.2.5 → 19.2.6 patch bump** — touches every UI surface, but it's a same-major patch; React's stability guarantees apply.
- **Mikro-ORM 7.0.14 → 7.0.15 patch bump** — within-major patch; verified clean in the 2026-05-04 run (7.0.10 → 7.0.13).

## Follow-ups (out of scope)

- **TypeScript 6** — separate dedicated PR; either set `"ignoreDeprecations": "6.0"` across each package `tsconfig.json` or migrate `moduleResolution` to `bundler`/`node16`.
- **awilix 13** — audit the 100+ DI call sites to add explicit generic parameters, or introduce a typed Cradle interface.
- **@napi-rs/canvas v1**, **html-to-text v10**, **undici v8**, **react-day-picker v10** — separate per-package audits when those modules are next touched.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Apply package.json bumps and regenerate lockfile

- [x] 1.1 Apply minor-and-patch bumps from #1888 across affected package.json files — cb2cb22c7
- [x] 1.2 Run yarn install to regenerate yarn.lock — see next commit
- [x] 1.3 Spot-check yarn.lock for key resolved versions — next@16.2.6, react@19.2.6, @mikro-orm/core@^7.0.15, zod@4.4.3, mermaid@11.12.2 (transitive, kept stable)

### Phase 2: Validation gate

- [ ] 2.1 yarn build:packages
- [ ] 2.2 yarn generate
- [ ] 2.3 yarn build:packages (post-generate)
- [ ] 2.4 yarn i18n:check-sync
- [ ] 2.5 yarn i18n:check-usage
- [ ] 2.6 yarn typecheck
- [ ] 2.7 yarn test
- [ ] 2.8 yarn build:app

### Phase 3: Open PR and close originals

- [ ] 3.1 Push branch
- [ ] 3.2 Open consolidated PR against develop
- [ ] 3.3 Close PRs #1888, #1889, #1890, #1891, #1892 with a pointer comment
