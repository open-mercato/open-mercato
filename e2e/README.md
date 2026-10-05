# Agentic end-to-end suite

An [e2e](https://e2e.dev) suite that drives the Open Mercato admin the way a
tester would: each test states goals in natural language, an agent executes
them in a real browser, and deterministic checks (URL, API read-back, exact
values) pin the outcome. It ports the `.ai/qa/scenarios/TC-*.md` scenarios
that the Playwright `__integration__` specs cover with hand-written clicks.

This folder is a standalone npm project on purpose. The monorepo pins
`playwright` to 1.61 through `resolutions`, below what `@e2edev/playwright`
needs, and Yarn workspaces would apply that pin here.

## Run it

```bash
# 1. Start the app (any of these), seeded with the demo accounts
yarn dev                                   # monorepo dev server on :3000
yarn test:integration:ephemeral:start      # or an ephemeral app; read the URL from .ai/qa/ephemeral-env.json

# 2. Run the suite
cd e2e
npm install
npx playwright install chromium            # once
AI_GATEWAY_API_KEY=... npm test            # APP_URL=http://localhost:5001 npm test for another address
```

Useful variants:

```bash
npm run list                               # what would run
npm test -- auth.e2e.ts                    # one file
npm test -- --tag crm                      # one area
npm run test:headed                        # watch the browser
npm run test:live                          # ignore recorded agent steps, run the model
```

Every run writes `.e2e/report.json`; failures leave screenshots and a
Playwright trace under `.e2e/artifacts/`.

## How it is built

| Piece | Role |
| --- | --- |
| `e2e.config.ts` | One web target at `APP_URL`, the QA agent (model, persona, Open Mercato vocabulary), demo credentials, and the secret for passwords the suite creates. |
| `tests/auth.setup.e2e.ts` | Signs in `admin` and `employee` once and saves both sessions. Tests declare `{ session: 'admin' }` instead of logging in, which keeps the login rate limit (5 attempts / 60 s per email) out of the suite. |
| `tests/support/api.ts` | A small REST client used for fixtures and cleanup only. The agent never sees it. |
| `tests/support/fixtures.ts` | `api`, `apiAs(persona)`, and `stamp` fixtures (run-unique names built from `stamp` go into `act` params as `unique(...)` so the trace cache replays them); everything created or tracked through `api` is deleted after the test, pass or fail. |
| `tests/*.e2e.ts` | The scenarios, grouped by module and tagged (`auth`, `crm`, `catalog`, `sales`, `admin`). Each test title carries the `TC-...` id it ports. |

Passwords never appear in a test. `credentials.user('admin').password` and
`secrets.get('new-user-password')` are opaque handles: the model plans with
the name, the runner fills the field, and observations, traces, and the
report are redacted.

## Scenarios covered

| Area | Scenarios |
| --- | --- |
| Auth | TC-AUTH-001, 002, 004, 008, 012, 015 |
| CRM | TC-CRM-001, 003, 004, 014, 015 |
| Catalog | TC-CAT-001, 004, 007 |
| Sales | TC-SALES-001, TC-INT-001 |
| Admin | TC-ADMIN-001, 004 |

Not ported: TC-AUTH-014 (organization switching) needs a second organization
in the demo tenant.

## What the first live runs surfaced

- **API keys without an organization vanish from the list.** The create form
  defaults the organization to empty; such a key is saved tenant-wide, but
  `/api/api_keys/keys` filters by the signed-in user's organization, so the
  admin who just created it sees "No results found". The agent reported this
  truthfully on the first run; the test now names the organization.
- **`TC-ADMIN-001.spec.ts` cleans up through `/api/auth/api-keys`, which is a
  404.** The module's endpoint is `/api/api_keys/keys`, so that spec leaks a
  key per run. The `.catch(() => {})` hides it.
- **Logging out revokes the server session**, not just the cookie. A saved
  browser session that logs out signs every later consumer out; the logout
  test signs in on its own for that reason.

## Caching agent steps

A passing `agent.act` is recorded under `.e2e/cache/` after a later check
confirms the outcome, and replays without a model call while the screens are
unchanged. The cache directory is meant to be committed so CI replays; the
model is consulted only when the app changed under a step.
