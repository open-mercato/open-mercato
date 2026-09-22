# `ledger` BDD scenarios (OM-174)

Given/When/Then scenarios for the `ledger` module, run with
[`@cucumber/cucumber`](https://github.com/cucumber/cucumber-js) via
`npm run test:bdd` (config: `.ai/qa/tests/cucumber.config.cjs`). This is
the module's first BDD infrastructure — before this task the repo had no
`.feature` files and no Cucumber dependency anywhere.

Ordering: per the user's explicit decision on 2026-09-22, this step
happens **before** OM-13 (unit tests) and OM-14 (integration tests), not
after — the scenarios below are meant to read as a business-facing
contract derived from the spec, which the unit/integration tests then
implement against.

## Why Cucumber, why `tsx/cjs` and not `ts-node`

Validated with an isolated npm spike (`~/bdd-spike`, outside this repo,
using the exact `typescript`/`tsx` versions this repo's root
`package.json` pins) before writing anything here:

- `ts-node@10.9.2` with `requireModule: ['ts-node/register']` throws
  `TypeError: Cannot read properties of undefined (reading 'fileExists')`
  inside `ts-node/dist/configuration.js` when paired with
  `typescript@7.0.2` — the exact version this repo's root `package.json`
  pins. Reproduced directly, not assumed.
- Switching the require hook to `tsx/cjs` (this repo already has `tsx`
  as a devDependency, `^4.23.12`) fixed this immediately; a real Cucumber
  suite ran and passed with it in the spike.
- `cucumber-js`'s `paths` glob array does not support `!`-prefixed
  negation for exclusions (tested directly). That is why
  `.ai/qa/tests/cucumber.config.cjs`'s `paths`/`require` entries are a
  single literal, non-wildcard-prefixed path
  (`packages/core/src/modules/ledger/__bdd__/...`) instead of a
  repo-root glob — it structurally avoids matching stale nested
  worktree copies (the same hazard `playwright.config.ts` documents
  handling for `.ai/tmp/`/`.ai/cezar/worktrees/`) without needing
  exclusion syntax at all.

## Scenario source

Derived from `.ai/specs/2026-08-18-general-ledger-core-engine.md`'s own
**User Stories**, **Invariants**, and **Edge Cases & Failure Scenarios**
sections, plus the domain events declared in `../events.ts` — not from
the original Event Storming brief, which was confirmed not committed to
this repo and so is unavailable here.

## Step definitions call real command handlers, not reimplementations

Every wired-up step definition imports the actual command module (e.g.
`../commands/postJournalEntry`), which registers the real handler with
`commandRegistry` exactly like a real route handler loading it would.
The step then calls `commandRegistry.get(id)!.execute(input, ctx)` — see
`support/world.ts`. The goal is for these scenarios to exercise
production code, not to duplicate its logic in a fake, mirroring the
concern `currencies/commands/__tests__/scope.test.ts` raises for its own
Jest tests (mocking too much of the command under test defeats the
point of testing it).

`support/world.ts`'s `FakeEntityManager` is a hand-written, in-memory
stand-in for MikroORM's `EntityManager` — modeled directly on
`scope.test.ts`'s own `buildEm()` helper (same intent: fake the
persistence layer, not the command), but built from plain closures over
a `Map` instead of `jest.fn()` mocks, since Cucumber has no bundled
mocking library. It implements only the calls the commands under test
actually make (`find`/`findOne`/`count`/`create`/`persist`/`flush`/
`fork`/`begin`/`commit`/`rollback`, plus the one raw-SQL escape hatch
`postJournalEntry.ts` uses for `journal_entry_sequence`) — read it before
extending these scenarios to a command that needs a call it doesn't yet
support.

## Verification status — please read before trusting this suite blindly

**I have not been able to run `cucumber-js` against this actual
monorepo in the environment I wrote this in**, and I want to be precise
about why, rather than imply this was tested end-to-end when it wasn't:

- This repo uses yarn workspaces (`packageManager: "yarn@4.17.1..."`,
  `engines: { "node": "24.x" }`); the device I wrote this on has no
  `yarn` binary and runs Node v22.23.2. `yarn install`-ing the full
  workspace was not attempted for real (only `npm`, in an isolated
  scratch directory outside the repo, was available and reachable).
- `@open-mercato/shared`'s `package.json` `main`/`exports` point at
  `./dist/...` (compiled output), and `packages/shared/dist` /
  `packages/core/dist` are both empty in this checkout — no build has
  run. Plain Node resolution of `@open-mercato/shared/lib/commands` (and
  similar subpaths every ledger command imports) would fail outright.
  `jest.config.cjs`'s own `moduleNameMapper` sidesteps this by pointing
  those same specifiers at `packages/shared/src/...` (TypeScript source)
  instead of `dist` — which is *why* Jest's existing unit tests
  (`currencies/commands/__tests__/scope.test.ts` et al.) can run without
  a build. `.ai/qa/tests/cucumber-module-aliases.cjs` reproduces that
  same mapping for `cucumber-js` (patching `Module._resolveFilename`),
  restricted to the specifiers the three wired-up commands actually
  import. This is a reasoned, source-grounded design choice, but its
  actual runtime behavior against a real `cucumber-js` process has not
  been observed here.
- `postJournalEntryCommand.execute()` and `reverseJournalEntryCommand.execute()`
  both call the real, unmocked `resolveTranslations()` (from
  `@open-mercato/shared/lib/i18n/server`) directly — Cucumber has no
  `jest.mock()` equivalent, and mocking it away would mean not exercising
  the real command. I read enough of `server.ts` to see it degrades
  gracefully when `next/headers` isn't in a request context (wrapped in
  `try`/`catch`), but I have not actually invoked it in a plain
  Node/`tsx` process outside Next.js to confirm it resolves cleanly
  end-to-end.
- The three feature files that ARE wired to real command execution
  (`fiscal_period_locking`, `journal_entry_balance`,
  `journal_entry_reversal`) are therefore best described as: derived
  from the spec, calling the real command handlers against a
  from-first-principles fake persistence layer, built on the same
  toolchain choices an isolated spike outside this repo empirically
  validated — but not yet run to green inside this actual repo.

### Verification status: account-type / account scenarios

`account_type_immutability.feature` and `delete_blocking.feature` go
further: their step definitions are all deliberately `'pending'` (no
logic at all), because `commands/ledgerAccounts.ts` and
`commands/ledgerAccountTypes.ts` both import
`#generated/entities.ids.generated` at module top level (for
`CrudIndexerConfig.entityType`), and — concretely confirmed by listing
`packages/core/generated/` in this checkout — that generated file does
not exist until `npx tsx` (via `yarn generate`, per OM-15) produces it.
`require`-ing either command module as-is would throw before any step
even ran. Once OM-15 (or an equivalent `yarn generate` run) exists, these
two feature files' scenarios should be wired up the same way the other
three are — the Gherkin itself does not need to change, only the step
definitions.

### What would remove these gaps

A real `yarn install && yarn generate` (and ideally `yarn build`) in an
environment that can actually run this monorepo's full toolchain, then
`npm run test:bdd`. Whoever picks that up next should treat a failure at
that point as genuinely informative — this suite has been designed
against the real source, not hand-waved, but "designed against the real
source" and "confirmed green" are different claims, and only the first
one is being made here.
