# Marketing Automation Module — Agent Guidelines

A campaign is: a **trigger** (a platform event id, or a periodic sweep) → an **audience**
expression → an ordered list of **steps**, one of which may be an A/B **split** carrying lanes of
its own. Spec:
[`.ai/specs/2026-09-28-marketing-automation-module.md`](../../../../../.ai/specs/2026-09-28-marketing-automation-module.md).

## Always

- Keep `lib/engine/` pure — no React, no ORM, no container, no `reportError`. It is the only
  reason the sequencing rules are testable, and they are the part most worth testing.
- Express audience conditions as `business_rules` `ConditionExpression` trees. Never add a second
  condition language; `matchesAudience` is the only entry point.
- Evaluate an audience through `matchesAudience`, never `evaluateExpression` directly — the veto
  it adds is load-bearing (see Never).
- Send through `sendEmail` from `@open-mercato/shared/lib/email/send`, and tag through the
  `customers.tags.assign` command. No direct provider calls, no new tag storage.
- Scope every query by BOTH `tenantId` and `organizationId`.
- Read `primary_email`, `display_name` and `customer_people.timezone` through
  `findOneWithDecryption`/`findWithDecryption` with the scope — they are encrypted at rest, and a
  plain `em.findOne` returns ciphertext that then compares against plaintext and silently fails.
- Repeat a worker's queue name as a string LITERAL in `metadata`. The generator extracts it from
  the AST and cannot resolve an import; the worker silently disappears from the registry.
  `workers/__tests__/queue-name-literals.test.ts` guards this.
- Report an error you catch with `reportError` in addition to logging it — at the I/O edges
  (`lib/dispatcher.ts`, `subscribers/`, `workers/`), never inside `lib/engine/`.
- Add a new step type through `registerMarketingSteps` with `labelKey`, `paramsSchema` and
  `uiFields` populated. Those three are what make it appear in the palette with a working
  inspector form and server-side validation.
- Edit the authored steps through `lib/canvas/step-tree.ts`, never by indexing into
  `definition.steps`. With splits a campaign is a tree, and an edit that assumes a flat array
  silently ignores everything authored inside a lane.
- Recurse into `readVariants(step).steps` in anything that walks a definition — save validation,
  position pruning, analytics. Forgetting to is how a lane ends up exempt from a rule the trunk
  obeys.

## Ask First

- Before gating sends on marketing consent: the platform has no consent model, and inventing one
  here would pre-empt a decision that belongs to a spec.
- Before making any step type send on a new channel (SMS, WhatsApp, push) — a provider belongs in
  its own `packages/channel-*`, not here.
- Before adding a table. The authored graph lives in `campaigns.definition` jsonb on purpose;
  triggers are a table only because their lookup runs on every platform event.
- Before changing a key of the subject document. Field paths are what saved audiences reference,
  so a rename silently breaks every campaign that used it.

## Never

- Never let a numeric aggregate be `null` in the subject document. `compare()` in
  `business_rules` returns `-1` for a null left operand, so `orders.daysSinceLast <= 30` becomes
  TRUE for a customer who has never ordered and a win-back campaign mails every never-buyer.
  Omit the key instead; `matchesAudience` also vetoes magnitude comparisons on absent operands.
- Never conflate the two kinds of stop. A `wait` has done its job, so the run resumes AFTER it;
  quiet hours have not let the message out, so it resumes AT the same step. Swapping them either
  drops a send or sends twice.
- Never make the frequency cap per-campaign. Five campaigns each politely sending one message
  still buries the customer, which is why `marketing_message_sends` is counted across all of them.
- Never proceed without the claim token returned by `claimRun`, and never write a run without
  re-asserting it — that is the entire concurrency story.
- Never let a per-subject failure abort a batch. A sweep and the due-run scan catch per row.
- Never relax save-time validation to match the dispatcher. Runtime skips an unknown step type so
  an installation change cannot strand a journey; the writer rejects it, because at author time it
  is always a mistake and a campaign that looks saved and does nothing is the worst failure mode
  this module has.
- Never draw a user-editable edge on the canvas. The only branch the engine has is a split, and
  which lane a subject takes is decided by the engine, not by an edge somebody drew — an author who
  can draw an edge has been promised a topology it cannot run. Edges are derived; order lives in the
  definition arrays.
- Never store a subject's variant choice, and never derive it from anything but the step id and the
  subject id. Stability across a resume is the whole point: a run that pauses on a wait inside a lane
  and comes back into the other lane delivers a mixture of both variants, and the test measures
  nothing.

## Validation Commands

```bash
yarn workspace @open-mercato/marketing-automation test
yarn workspace @open-mercato/marketing-automation typecheck
yarn i18n:check-sync && yarn i18n:check-usage
node --require ./scripts/typescript-js-require-hook.cjs node_modules/eslint/bin/eslint.js \
  --config eslint.ds.config.mjs packages/marketing-automation
```

Integration tests need a running app plus workers:
`yarn dev` and `yarn mercato queue worker --all --with-scheduler`.

```bash
OM_INTEGRATION_MODULES=marketing_automation yarn test:integration
```

Always with that filter. A bare `yarn test:integration` takes ~2.6 minutes for this module's 16
specs because `--grep` and the module filter are applied AFTER Playwright has compiled all ~1270
discovered spec files in the monorepo; narrowing `testMatch` up front runs the same specs in ~6
seconds. Also: the dev server caches the built package, so rebuild and RESTART it before trusting a
red integration result — a stale server is why a save-validation change appeared not to work.

## Key Reference Files — Copy From Here

| Concern | File |
|---|---|
| step sequencing, the two stops | `lib/engine/executor.ts`, `lib/engine/chain-planner.ts` |
| audience evaluation and the missing-operand veto | `lib/engine/audience.ts` |
| frequency cap, quiet hours | `lib/engine/gates.ts` |
| claim-and-lease, backoff, dead-lettering | `lib/runs.ts`, `lib/engine/scheduling.ts` |
| enrolment shared by events and sweeps | `lib/dispatcher.ts` → `startCampaignForSubject` |
| trigger context hydration | `lib/trigger-catalog.ts` |
| a step handler with a channel | `steps/send-email.ts` |
| an idempotent step | `steps/add-tag.ts` (409 "already assigned" is success) |
| canvas ↔ definition mapping, fork and rejoin | `lib/canvas/graph-mapping.ts` |
| structural edits over the step tree | `lib/canvas/step-tree.ts` |
| deterministic lane assignment, flattening | `lib/engine/split.ts` |

## Gotchas Carried From Production Experience

- `customers.person.created` puts the PERSON PROFILE id in `payload.id`; the customer is
  `payload.entityId`. Reading `id` keys every run and every tag on the wrong row.
- `sales.order.created` carries only `{ id, organizationId, tenantId, userId }` — no customer and
  no total. Anything an audience compares must be hydrated in `lib/trigger-catalog.ts`.
- Sales money columns are `numeric` mapped to `string`. Parse deliberately.
- A cancelled order is `canceled` OR `cancelled`; the codebase tolerates both.
- `add_tag` emits `customers.tag.assigned`, which is itself a trigger. Two things stop a cycle:
  the save refuses a campaign whose trigger is an event its own steps emit, and
  `MAX_RUNS_PER_SUBJECT` bounds runs per subject per hour across ALL campaigns. An in-context
  depth counter was tried first and could not work — the events are emitted by the modules that
  own them and carry nothing of ours, so nothing could increment a depth across the hop.
- New features reach existing tenants only after `yarn mercato auth sync-role-acls`, and the dev
  server caches the generated ACL registry — restart it or a wildcard has nothing to expand.

## Not Implemented, Deliberately

- `storefront.cart.abandoned` — no cart entity exists in the platform. It is in the catalog as
  unavailable with a reason so the palette explains itself; blocked on `SPEC-029`.
- Marketing consent, funnel analytics, segments, SMS/WhatsApp/push, and exactly-once delivery.
  See the spec's phase backlog. A/B splits exist, but picking a winner does not — that needs
  click-through attribution first.
