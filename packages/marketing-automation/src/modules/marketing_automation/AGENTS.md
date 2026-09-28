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
- Keep every narrowing a SUPERSET of the audience (`lib/engine/narrowing.ts`). Resolve any ambiguity
  by widening, and push nothing down that you cannot prove. `matchesAudience` decides membership;
  the narrowing only decides who is worth projecting.
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
- Answer "what does this add to the customer profile?" for every new capability. A feature nothing
  reads is write-only, and this module has already shipped that defect once.
- Add a new step type through `registerMarketingSteps` with `labelKey`, `paramsSchema` and
  `uiFields` populated. Those three are what make it appear in the palette with a working
  inspector form and server-side validation.
- Edit the authored steps through `lib/canvas/step-tree.ts`, never by indexing into
  `definition.steps`. With splits a campaign is a tree, and an edit that assumes a flat array
  silently ignores everything authored inside a lane.
- Add a periodic candidate source through `ROW_SWEEP_SOURCES` in `lib/sweep-sources.ts`. The worker,
  the validator's accepted ids, the palette and the audience builder's offered paths all derive from
  that registry; a source added anywhere else is invisible to at least one of them.
- Give a row source a `claimKey` when it must act on a thing exactly once ever, and leave it off when
  repeats are legitimate. A review request must never be sent twice; a quote-expiry reminder is
  supposed to be repeatable, and the campaign's re-entry policy is what governs it.
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
- Never push an order-aggregate comparison down when a customer with no orders satisfies it
  (`orders.count <= 5`, `= 0`, `totalGross >= 0`). The aggregate query can only return customers who
  have orders, so pushing it would drop every never-buyer from a campaign that includes them.
- Never conflate the two kinds of stop. A `wait` has done its job, so the run resumes AFTER it;
  quiet hours have not let the message out, so it resumes AT the same step. Swapping them either
  drops a send or sends twice.
- Never make the frequency cap per-campaign. Five campaigns each politely sending one message
  still buries the customer, which is why `marketing_message_sends` is counted across all of them.
- Never cache a lead score in a column, and never make a tier a stored field. The score is
  `sum(points)` over its ledger so a redelivered step cannot double-award, and the tier is derived from
  the score so it cannot be stale between recalculations.
- Never store an IP address or a user agent on a delivery event. The question the table answers does
  not need them, and a marketing module that builds a device-and-location log of every recipient is a
  liability nobody asked for.
- Never sign a tracking token with a session or JWT secret, and never put a destination in the URL
  instead of inside the signature — the first widens the blast radius of a token that lives in mail
  archives forever, the second is an open redirect wearing the shop's domain.
- Never make an occurrence key permanent, and never derive it from anything but the delivered
  payload. It is a duplicate guard for a window: kept forever it turns every `unlimited` re-entry
  policy into `once`, because two separate occurrences with identical payloads hash the same.
- Never proceed without the claim token returned by `claimRun`, and never write a run without
  re-asserting it — that is the entire concurrency story.
- Never let a per-subject failure abort a batch. A sweep and the due-run scan catch per row.
- Never relax save-time validation to match the dispatcher. Runtime skips an unknown step type so
  an installation change cannot strand a journey; the writer rejects it, because at author time it
  is always a mistake and a campaign that looks saved and does nothing is the worst failure mode
  this module has.
- Never key a schedule on its interval alone — in a node id, a duplicate check or anywhere else. The
  source is part of its identity, and treating the interval as the key made the save refuse a campaign
  the canvas had just allowed.
- Never let a malformed payload reach the route as a throw. Parse with `safeParse` and answer 400 with
  a `marketing_automation.validation.*` code; a 500 tells the author nothing they can act on.
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

Always with that filter. A bare `yarn test:integration` takes ~2.6 minutes for this module's specs
because `--grep` and the module filter are applied AFTER Playwright has compiled all ~1270 discovered
spec files in the monorepo; narrowing `testMatch` up front runs the same specs in ~6 seconds.

The dev server resolves this package through `node_modules`, which Next does not watch, so a rebuilt
`dist` does NOT reach a running server: rebuild, then restart the dev runtime, before trusting a red
integration result. A stale server is why a save-validation change once appeared not to work. Keep
`yarn dev` in a terminal of its own — touching `apps/mercato/.env` restarts only the app runtime
there, whereas a detached `yarn dev` exits instead of restarting.

## Key Reference Files — Copy From Here

| Concern | File |
|---|---|
| step sequencing, the two stops | `lib/engine/executor.ts`, `lib/engine/chain-planner.ts` |
| audience evaluation and the missing-operand veto | `lib/engine/audience.ts` |
| frequency cap, quiet hours | `lib/engine/gates.ts` |
| claim-and-lease, backoff, dead-lettering | `lib/runs.ts`, `lib/engine/scheduling.ts` |
| score ledger, idempotent awarding | `lib/scores.ts`, `steps/add-points.ts` |
| tier ladder, derivation and its defaults | `lib/engine/tiers.ts`, `lib/tiers.ts` |
| everything known about one customer | `api/customers/[id]/profile/route.ts` |
| periodic candidate sources and their claims | `lib/sweep-sources.ts` |
| duplicate-delivery guard and its window | `lib/occurrence.ts`, `lib/runs.ts` → `createRun` |
| signed tracking tokens, link rewriting | `lib/tracking/` (`token.ts`, `rewrite.ts`, `urls.ts`) |
| the only PUBLIC routes in the module | `api/track/open`, `api/track/click` |
| enrolment shared by events and sweeps | `lib/dispatcher.ts` → `startCampaignForSubject` |
| trigger context hydration | `lib/trigger-catalog.ts` |
| a step handler with a channel | `steps/send-email.ts` |
| an idempotent step | `steps/add-tag.ts` (409 "already assigned" is success) |
| audience pushdown planner and its superset rule | `lib/engine/narrowing.ts` |
| candidate resolution and the set algebra | `lib/audience/set-resolver.ts` |
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
- Marketing consent, funnel analytics, segments, and SMS/WhatsApp/push.
  See the spec's phase backlog. A/B splits exist, but picking a winner does not — that needs
  click-through attribution first.
