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

**Update (after OM-13's Jest tests shipped):** part of the original
version of this section was wrong, and it's worth saying so plainly
rather than leaving a stale caveat in place. Writing OM-13's unit tests
uncovered that `~/mnt/open-mercato` (the main checkout this worktree
branches from) already has a full, real `yarn install` — 1582 packages,
including `jest`, `ts-jest`, `typescript-js` (the JS-based TypeScript
6.0.3 alias `scripts/jest-mikroorm-transformer.cjs` redirects to),
`@mikro-orm/core`, `@mikro-orm/decorators`, and `tsx`. Node's own
directory walk-up for module resolution reaches that install from
*inside* this linked worktree (worktrees don't get their own
`node_modules`, but they don't need one when an ancestor directory
already has a real one) — which is exactly how OM-13's
`postJournalEntry.test.ts` / `reverseJournalEntry.test.ts` /
`fiscalPeriods.test.ts` were actually run and confirmed green, not just
designed. "No yarn install was possible here" was too pessimistic; the
accurate statement is "this worktree's own `node_modules`/`dist` are
empty, but an ancestor directory's real install covers it."

Re-running `cucumber-js` for real with this corrected understanding
found two genuine bugs in what shipped originally, both now fixed:

- `cucumber-module-aliases.cjs`'s `ROOT` computation was off by one
  directory level (`.ai/qa/tests` → `..`/`..` lands on `.ai`, not the
  repo root) — every aliased `require()` was resolving one level too
  shallow. Fixed to `..`/`..`/`..`.
- The alias table only covered `@open-mercato/shared/*` and
  `#generated/*`. Running for real showed `resolveTranslations()`'s own
  import chain reaches `@open-mercato/cache` too (and, by the same
  logic, potentially `@open-mercato/core`, `@open-mercato/queue`,
  `@open-mercato/search`, etc., depending on what a given command pulls
  in). The table now mirrors `jest.config.cjs`'s `moduleNameMapper` in
  full, matching this file's own stated design intent, rather than a
  guessed subset.

With both fixes in place, `cucumber-js` gets meaningfully further —
past module resolution entirely — and then hits a real, more precise
blocker than "environment couldn't be verified":

- **`tsx/cjs`'s (esbuild-based) decorator transform is not compatible
  with `@mikro-orm/decorators`' runtime expectations**, at least for
  some entity files reached transitively (observed on
  `packages/core/src/modules/entities/data/entities.ts`, pulled in via
  `resolveTranslations()`'s module-registry traversal — not one of the
  `ledger` module's own entity files, which never got far enough to be
  reached in this run). The failure is
  `TypeError: Cannot read properties of undefined (reading 'constructor')`
  inside `@mikro-orm/decorators/legacy/PrimaryKey.js`, thrown from
  TypeScript's generated decorator-application helper. OM-13's Jest
  suite loads ledger's own decorator-based `data/entities.ts` successfully
  in the same environment — via `ts-jest`, which transforms with the
  real TypeScript compiler (aliased to `typescript-js`, TS 6.0.3),
  not esbuild. That is the concrete difference: **ts-jest's decorator
  output works with `@mikro-orm/decorators`; `tsx`'s esbuild-based one,
  at least as configured here, does not.**
- A first attempt at swapping the require hook from `tsx/cjs` to
  `ts-node/register` (with the same `typescript`→`typescript-js`
  `Module._resolveFilename` redirect `jest-mikroorm-transformer.cjs`
  uses) did not immediately resolve this in a quick trial — `tsx/cjs`'s
  own `.ts` extension handler was still taking precedence because it
  was left registered in `cucumber.config.cjs`'s `requireModule` list
  alongside it, not replaced. This needs the config's `requireModule`
  actually swapped (not appended to) and re-tested — a concrete,
  scoped next step, not a re-opened mystery.
- `postJournalEntryCommand.execute()` and
  `reverseJournalEntryCommand.execute()` both call the real, unmocked
  `resolveTranslations()` directly (Cucumber has no `jest.mock()`
  equivalent) — this run confirms that call chain is what pulls in the
  broader module registry (and hence the unrelated `entities` module's
  decorator-based entities) in the first place. Whether
  `resolveTranslations()` itself resolves cleanly once the decorator
  issue is fixed is still unconfirmed.

**Bottom line:** the three feature files wired to real command execution
(`fiscal_period_locking`, `journal_entry_balance`,
`journal_entry_reversal`) are derived from the spec and call the real
command handlers against a from-first-principles fake persistence
layer — and are now confirmed to get past config/module-resolution for
real, with a specific, fixable decorator-transform issue as the
remaining blocker, rather than an unverified "should work in theory."
That is meaningfully more verified than the original version of this
section claimed, but still short of a green run — please don't read
this as "confirmed passing" until that last issue is resolved and the
suite has actually finished a run.

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
