# Final gate - all fourteen Steps done

**Recorded:** 2026-09-19T16:06:27Z
**Branch:** `feat/market-display-profile-wave1b` (20 commits on top of `a9d84d6f9`)
**Base merged in:** `origin/develop` at `63bebfea9` (the catalog tax code / taxable flag reaching tax providers, PR #8)
**Runner:** local. No compose `app` container runs on this host, so `yarn X` is the local form throughout.

## Full validation gate - `.ai/agentic.config.json` `validation.commands`, in order

| # | Command | Result |
|---|---|---|
| 1 | `yarn build:packages` | pass (38 packages) |
| 2 | `yarn generate` | pass, no drift |
| 3 | `yarn build:packages` | pass (fully cached) |
| 4 | `yarn i18n:check-sync` | pass - 62 modules, 5 locales, all in sync |
| 5 | `yarn i18n:check-usage` | advisory only (4257 unused keys, the repo's standing baseline) |
| 6 | `yarn typecheck` | pass (38 packages) |
| 7 | `yarn test` | pass - 46 tasks (see the environment note below) |
| 8 | `yarn build:app` | pass |

### Environment note on `yarn test`

Under plain `yarn test` the `@open-mercato/cli` package reports 5 failures in `resolve-environment` and
`resolver.enterprise`. They are an artifact of this host, not of this branch:

- `TMPDIR` on the cezar worktree points **inside** the repository
  (`/srv/om/repos/open-mercato/.ai/cezar/tmp/…`). Both suites create a "standalone" project with
  `mkdtemp(os.tmpdir())` and assert the CLI does not see a monorepo above it - which it does, correctly, because the
  repository genuinely is above that path.
- Running the same suites with `TMPDIR` outside the repository passes all 103 suites / 1928 tests.
- Turbo filters `TMPDIR` out of its task environment, so the workaround is `--env-mode=loose`. The gate's step 7 was
  re-run as `TMPDIR=/tmp/om-cli-tmp turbo run test --env-mode=loose`: **46 tasks successful, 46 total.**
- This branch contains **zero** commits touching `packages/cli`, and its diff never enters that package.

## Full integration suite

**Skipped, with reason.** The suite (`yarn test:integration`, Playwright) drives a live application against a seeded
database. Provisioning one on this slot failed outside this branch: `omw up --fresh` created and migrated the slot
database (`om_task2` on port 5433) but its initializer read `apps/mercato/.env`, which carried the framework default
`localhost:5432/open-mercato`, and aborted with "PostgreSQL … is not reachable". Pointing that file at the slot
database and re-running `yarn initialize` is what the UI verification below depends on.

Every behavior this run changed is covered by unit tests instead - 2 twins' address parity, calendar week start and
hour cycle, the quote view model, sales money, CSV export, PDF paper size and the shipment wizard's unit boundary all
have assertions against the US template, the EU template **and** the no-profile path.

## Design-system / style compliance pass

`yarn lint:ds` over the branch diff. The repo-wide result is 287 warnings and 0 errors, a standing baseline. Of those,
three fell in files this run touched:

| Finding | Owner | Action |
|---|---|---|
| `catalog/components/PriceKindSettings.tsx` - deprecated `Alert variant` prop | this run (Step 2.8) | fixed as Step `2.8-ds-fix`, now `status="warning"` |
| `customers/backend/customers/people/page.tsx:659` - status column should use `StatusBadge` | pre-existing (last changed in `a4d26475e`) | left alone; this run only changed date formatting in that file |
| `customers/backend/customers/companies/page.tsx:659` - same | pre-existing | left alone |

### Style compliance residual findings

None introduced by this run. The two `require-status-badge` warnings above predate it and migrating those status
columns is a change to their rendering, not to display formatting - out of scope here and worth its own change.

## UI verification - attempted, could not run

The run did take the environment all the way rather than skipping it, and got further than checkpoint 1 could:

1. `omw up --fresh` created and migrated the slot database (`om_task2`, port 5433). Its initializer then aborted -
   it reads `apps/mercato/.env`, which carried the framework default `localhost:5432/open-mercato` rather than the
   `.env` `omw` had just written. Pointing that file at the slot database and running `yarn initialize` by hand
   succeeded: the seeded tenant and the `admin@acme.com` login exist.
2. The dev server starts and reports ready, but `GET /login` never returns. The route compile fails on
   `ERR_IMPORT_ATTRIBUTE_MISSING` for `language-subtag-registry/data/json/registry.json` under Node 24, and a second
   dev server instance contends for the same ports.

Neither failure is attributable to this branch: its diff touches no file under `apps/mercato`, no `next.config`, and
no `package.json`, and both failures reproduce on routes this run never modified.

**Consequence, stated plainly: there are no screenshots on this PR.** The behavior is covered by unit tests against
the US template, the EU template and the no-profile path on every migrated surface, but no one has yet seen these
screens render. The PR carries `needs-qa` and a human QA pass on a working environment is still required before it
merges.
