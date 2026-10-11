# forms → core migration — shared brief

**Read this first.** It is the shared context for every task in this migration tree. Your own
task order tells you which section below is *your* assignment.

## What is happening

We are migrating the `forms` module out of the separate repo
[`open-mercato/official-modules`](https://github.com/open-mercato/official-modules)
(`packages/forms/src/modules/forms`, branch `develop`, source commit `d694a75`) into this
monorepo as a module of `@open-mercato/core`.

The module source has **already been copied verbatim** into `packages/core/src/modules/forms/`
(commit `chore(forms): vendor the official forms module source into core (WIP)`). It is ~300
files / ~59k lines: `acl.ts`, `api/` (~50 routes incl. `api/public/**`), `backend/` pages
(including a large drag-and-drop Form Studio), `frontend/` pages (public `f/[slug]`,
`i/[token]`, `embed/[slug]`, and `[orgSlug]/portal/**`), `commands/`, `data/entities.ts`,
`data/validators.ts`, `di.ts`, `encryption.ts`, `events.ts`, `events-payloads.ts`, `i18n/`
(en, pl, es, de), `lib/`, `migrations/` (6 files + `.snapshot-open-mercato.json`), `runner/`,
`schema/`, `services/` (~25), `setup.ts`, `subscribers/`, `translations.ts`, `ui/`, `widgets/`,
`workers/`, and `__tests__/` (~65 unit test files).

## What came with it, and what did not

In `official-modules` this was its own npm workspace package, `@open-mercato/forms`, with its
own `package.json`, `build.mjs`, `watch.mjs`, `tsconfig.json`, `tsconfig.build.json`,
`jest.config.cjs` and a package barrel `src/index.ts`. **None of those were copied** — inside
`packages/core` the module must obey core's own build, auto-discovery and jest conventions.

Two consequences worth knowing:

- The module had almost no self-references to `@open-mercato/forms` (only two, in comments);
  those were rewritten to `@open-mercato/core/modules/forms/...`. It imports
  `@open-mercato/core/...` in a handful of places, which is normal practice *inside* core
  (2289 files there already do it) and needs no change.
- Its old `package.json` declared these peers/deps. Only `ajv`, `ajv-formats` and `pdf-lib`
  were missing from this monorepo; they have been added to `packages/core/package.json`
  `dependencies`. Everything else (`@dnd-kit/*`, `lucide-react`, `@tanstack/react-table`,
  `class-variance-authority`, `awilix`, `@mikro-orm/*`, `zod`, `react`) already existed.
- It was built against published `@open-mercato/* 0.6.3-develop` snapshots. This repo's core is
  at `0.8.0`, so **API drift against `@open-mercato/shared`, `@open-mercato/ui`,
  `@open-mercato/queue` and `@open-mercato/core` is expected and is the main migration risk.**

## Repo conventions that bind this work

- `AGENTS.md` at the repo root plus the nearest package/module `AGENTS.md` are authoritative.
  `packages/core/AGENTS.md` § Extensibility Contract / § Auto-Discovery / § Migrations /
  § Generated Files / § Module Setup Convention are the relevant sections.
- `BACKWARD_COMPATIBILITY.md` governs contract surfaces. A brand-new module is additive, so
  this migration should break nothing — but verify rather than assume.
- The CI-mirroring validation gate is the ordered `validation.commands` list in
  `.ai/agentic.config.json`: `yarn build:packages`, `yarn generate`, `yarn build:packages`,
  `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`,
  `yarn build:app`. The second `build:packages` is load-bearing — do not skip it.
- Base branch for the eventual PR is `develop`.
- Never run `yarn db:migrate`. Ship migration files + snapshot instead.
- `yarn install` is required in a fresh worktree before anything else; the yarn cache is warm so
  it takes well under a minute.

## Reference modules to compare against

Core modules with the same structural shape as forms — read these before claiming forms is
unusual: `workflows`, `warranty_claims`, `customer_accounts`, `sales`, `customers` (the
canonical CRUD reference), `attachments` (storage/uploads), `portal` (portal page conventions).

## Ground rules for every task in this tree

- **Read-only unless your order says otherwise.** Your order names the exact file(s) you may
  create or modify. Writing outside that scope breaks sibling tasks.
- Evidence over assertion: quote real command output and real file excerpts with paths.
- Report honestly. A `done` that is not done costs the parent a full round trip.
