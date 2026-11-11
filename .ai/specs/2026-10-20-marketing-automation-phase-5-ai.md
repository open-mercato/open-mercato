# Marketing Automation — Phase 5: AI Authoring and Inbound Hooks

| Field | Value |
|-------|-------|
| **Status** | Specification (per-phase slice) |
| **Created** | 2026-10-20 |
| **Modules** | `marketing_automation` (`packages/marketing-automation`) |
| **Parent spec** | [`.ai/specs/2026-09-28-marketing-automation-module.md`](2026-09-28-marketing-automation-module.md) — Problem Statement, Data Models, API Contracts, Risks & Impact Review, Final Compliance Report and Changelog are shared across all phases and are not repeated here. |
| **Delivery plan** | [`.ai/specs/2026-10-02-marketing-automation-phased-delivery.md`](2026-10-02-marketing-automation-phased-delivery.md) — this file is P2–P5's "relevant sections out of" the module spec, per that spec's Migration & Backward Compatibility section |
| **PR** | [#6868](https://github.com/open-mercato/open-mercato/pull/6868) |

## Scope

The campaign-authoring agent with its tool pack, AI copy drafting, and signed inbound hooks that let
anything outside the system start a journey. What these files mostly carry is refusals — the agent
cannot enable a campaign, a model's HTML is untrusted until a person has read it, and tenant-supplied
strings never reach the model's instruction channel — which is why this scope comes last and stands
alone: it builds on the engine, delivery, analytics and growth features every earlier phase shipped.

## Architecture (extracted from the module spec)

### An agent that can author

A module-root `ai-tools.ts` contributes six tools, which the platform registers for both the MCP server
(external agents) and the in-app chat. Deliberately thin: the step registry, the trigger catalogue and
the save command already ARE the authoring API, so each tool delegates to one of them rather than
growing a parallel surface.

Three invariants, each with a test:

- **Nothing is ever published.** There is no tool that enables a campaign, and the test refuses any tool
  whose name looks like it publishes or destroys. Enabling starts messaging real customers, it is gated
  behind its own human permission, and an agent that could do it would turn a misunderstood sentence into
  mail nobody approved. Draft, review, publish by hand.
- **Nothing bypasses the save validation.** `save_campaign_graph` goes through the command, so an agent's
  graph faces the same checks a person's does and gets the same stable codes back — a code an agent can
  act on, rather than prose it can only apologise for.
- **Nothing crosses a tenant.** `requireToolScope` refuses a principal without both halves of the scope
  rather than answering with data from somewhere.

`describe_building_blocks` exists because availability differs per installation: an agent that composes a
campaign from what it remembers of the documentation writes graphs the save refuses.

## AI copy drafting (from the module's changelog)

Deliberately at AUTHORING time rather than as a step. A Draft button in the message inspector returns a
subject, HTML body and plain-text body for the author to edit; nothing is saved until they save the
campaign. The draft is grounded in the campaign name, its triggers, a per-tenant brand-voice setting, and
the placeholders and content blocks that actually exist, so it cannot invent a placeholder that renders
as literal braces in an inbox.

**Rejected: generating per recipient at send time**, which is what the source module did — copy nobody
read would reach customers (this module's rule is that AI may author and only a human may publish), the
cost would scale with the audience, and a slow or failing provider at send time would block or silently
skip a message. Personalisation per customer is already interpolation's and the recommendation block's
job, and both are deterministic and free.

The model's output is treated as untrusted markup: scripts, embedded documents, inline event handlers and
`javascript:`/`data:` URLs are stripped by `parseDraftedCopy`, and the editor shows the draft as text
rather than rendering it. Tenant-supplied strings — brand voice, campaign name, brief — live inside a
`<briefing>` fence in the user message so an injection attempt is data, not instruction. Both AI packages
are OPTIONAL peers loaded at call time, so an installation without them still dispatches campaigns and
this endpoint simply answers 503.

## Inbound hooks (from the module's changelog)

A signed, revocable URL per hook starts one campaign from outside the platform; the receiver emits
`marketing_automation.inbound.received` and the existing subscriber path applies the audience, the
re-entry policy, the per-subject budget and the payload-derived duplicate guard, so nothing about
dispatch is duplicated.

Decisions: its own signer rather than the tracking claim shape, because a hook has no run and a hook id
in the run slot would verify and mean nothing; the token is derived from the row rather than stored, so
the URL can always be shown again while a database copy alone is useless; revocation is a column checked
on receipt; and the endpoint answers 202 to every caller that got past the signature, because reporting
whether an address matched would make a leaked URL an address-existence oracle — the outcome is recorded
on the hook and shown only behind a login.

**Not built on the `webhooks` module:** its inbound machinery exists to verify a third party's signing
scheme through a provider adapter, while here the platform issues the URL itself, and routing through it
would have required an operator to create an endpoint there and select the module's adapter before any
campaign could fire.

## Refusals this phase is built around

- **The agent cannot enable a campaign.**
- **A model's HTML is untrusted markup until a person has read it.**
- **Tenant-supplied strings go in the user message, never the system half.**
- **An inbound hook token has its own key label**, so a click URL from an email cannot be replayed as a
  hook post.
- **The inbound endpoint never reports whether an address matched a customer.**

## Out of scope for this phase

The engine, campaign CRUD and the canvas are Phase 1. Delivery tracking and consent are Phase 2.
Results and attribution are Phase 3. Segments, score, referrals and lead routing are Phase 4.
