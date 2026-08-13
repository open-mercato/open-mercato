# Demo an ElevenLabs voice briefing call that triages a deal at risk and turns the chief of sales' reply into CRM tasks

- Date: 2026-08-13
- Category: feature
- Priority signal: extreme — live stage demo at ElevenLabs Partner Day Warsaw, ~2h build window shared by two people
- Risk signal: high — real outbound telephony to real mobiles over conference Wi-Fi, on a throwaway branch, with a mid-call dependency on a live HTTP endpoint
- Routing: `Next: none`

## Problem

Forty minutes before a contract-signing meeting, the prospect's CEO emails to say the latest draft is missing what he agreed verbally with our CEO. The signal is sitting in the CRM and nobody sees it in time. The demo shows the platform noticing on its own, briefing the chief of sales by phone, and turning what he says back into CRM work — with a note from our own CEO in the deal that resolves the objection, findable by the voice agent only when the chief thinks to ask for it.

Evidence this is buildable rather than theatre: `analysis/external-invoke-agent` already carries `packages/agent-elevenlabs` (a full `ExternalAgentConnector` with outbound calling, signed callback verification, payload normalization, recording fetch-on-demand, named call profiles) and `apps/mercato/src/modules/sales_call_planner` (a working three-agent briefing workflow). The demo is a scoping and configuration exercise on top of built infrastructure, not new architecture.

## Agreed direction

Use the existing `sales_call_planner_deal_briefing` workflow as-is. A single ElevenLabs agent, dialled through one call profile named `sales_chief_call`, reads the brief produced by `sales_call_planner.deal_brief` and talks to the chief of sales. `sales_call_planner.task_extractor` reads the transcript afterwards and `ensure_task` writes the resulting CRM tasks idempotently. Optionally, a callback branch calls the chief back after N minutes when he says he wants to speak to the prospect's CEO first.

The CEO's note reaches the voice agent through a real mid-call server tool hitting `POST /api/ai_assistant/tools/execute` with a persistent `omk_` key, so the agent physically does not hold the note until the chief asks for it.

**Work split, hard boundary.** Patryk owns everything inside the OM repository on `analysis/external-invoke-agent`: the workflow definition, the extra seed script, the optional callback branch and its timer, and verifying the `tools/execute` call shape. Maciej owns everything inside the ElevenLabs workspace: the agent, its prompt, the `sales_chief_call` call profile, the server tool configuration, and the data-collection fields. Neither side edits the other's surface.

**Rejected, with reasons.** Returning the decision through a mid-call tool with a tool-result edge (stronger stage moment, rep's phone rings while the chief is still talking) lost because the platform's connector settles a run on the post-call callback and has no mid-call decision channel; adding one would mean widening the connector interface during the build window. Branching the ElevenLabs graph at the `Start` node on a `call_reason` variable lost because entry-edge evaluation before the first turn is undocumented and would fail silently on stage; the per-call `firstMessage` override in `voiceCallInputSchema` does the same job with no graph work. A closed `outcome` enum extracted by ElevenLabs data collection lost because `task_extractor` already reads the whole transcript with a typed output schema, which is strictly more robust than string-matching an extraction. A dedicated OM endpoint returning deal notes lost because `customers.get_deal` already returns `related.notes` from `CustomerComment` and `tools/execute` already exposes it over HTTP with API-key auth. "Build nothing" lost because the connector and workflow already exist and the remaining delta is configuration plus a seed script.

## Resolved unknowns

| Question | Answer (from the conversation) |
|----------|--------------------------------|
| Who builds what | Patryk: OM repo on `analysis/external-invoke-agent`. Maciej: ElevenLabs workspace configuration only. |
| Real phone calls or in-browser | Real outbound calls to real mobiles, via the connector's Twilio path. |
| Language of the calls | English, both the call and the seeded CEO note. Avoids translating mid-call and keeps the lab's digit/read-back prompt rules working. |
| How the outcome returns to OM | ElevenLabs post-call webhook → connector-addressed static callback route → `voiceCallOutcomeSchema`. Chosen over a mid-call tool and reaffirmed after the challenger flagged unbounded analysis latency. |
| What decides the follow-up actions | `sales_call_planner.task_extractor`, a native OM agent reading the full transcript — not a data-collection enum. |
| Which data collection fields are needed | Two: `wants_callback` (Boolean) and `callback_minutes` (Integer). Extraction earns its keep only where a machine needs a typed value; the timer is that case. Every extra field costs seconds of post-call analysis before the callback fires. |
| How the chief's re-entry on a callback works | Same agent, same profile, rewritten `brief` and `firstMessage` — both are per-call fields in `voiceCallInputSchema`. No new dynamic variable, so no missing-variable failure class. |
| Where the CEO's note lives | `CustomerComment` on the deal. `sales_call_planner.deal_brief` has no comments tool (`get_company`, `list_deals`, `list_activities`, `list_pipeline_stages`), so the note cannot leak into `{{brief}}`. Data topology enforces the beat, not prompt discipline. |
| How the agent fetches the note mid-call | `POST {APP_URL}/api/ai_assistant/tools/execute` with `Authorization: Bearer omk_…`, body `{ toolName: "customers.get_deal", args: { dealId, includeRelated: true } }`. `customers.get_deal` maps `CustomerComment` rows into `related.notes`. |
| How that call is authenticated | A persistent key minted by `POST /api/ai_assistant/mcp-key`, which inherits the minting user's roles. Mint it as `admin@acme.com` so the voice agent sees exactly what the chief of sales sees. |
| Whether OM exposes an MCP protocol server | No. The `omk_` key is for `.mcp.json` clients. Tools are reachable over REST via `tools/execute`, which is what an ElevenLabs server tool wants anyway. |
| Which deal carries the scenario | `Redwood Residences Solar Rollout` at Brightside Solar — the only seeded deal in `negotiations`, $185k, `requires_legal_review: true`, and it already links Daniel Cho as Executive Sponsor and economic buyer. |
| Who the prospect's CEO is | Daniel Cho, promoted from VP of Partnerships by a one-line `job_title` update. Cheaper and safer than seeding a new person with entity, profile, deal link and company link. |
| Which OM users play which role | Chief of sales `admin@acme.com`, our CEO `superadmin@acme.com` (author of the note), Kuba `employee@acme.com` (set as the deal's `owner_user_id`). Verify all three exist on demo.openmercato.com first — `admin@`/`employee@` are only created with `mercato auth setup --include-demo-users`, and `superadmin@` is whatever email set up the tenant. |
| Where the triage lives | Inside `prepare_brief`. `dealBriefItemSchema` already carries `riskSignal` (`none`/`watch`/`at_risk`/`stalled`), `riskReason`, `facts` and `recommendedNextMove`. No separate Triage button is needed. |
| Whether a human approves before the call | Every `INVOKE_AGENT` step carries `onResult: { alwaysAsk: true }` and parks on `agent_orchestrator.proposal.ready`, so the brief returns for approval before the phone rings. Read from the workflow JSON; confirm against runtime. |
| Company scope vs deal scope | Keep company scope. Brightside Solar has exactly two deals, so the chief hears a portfolio and picks — a stronger demo than reciting one record, and zero code change. |
| Where the phone numbers come from | Hard-coded in the workflow input (`chiefOfSalesPhone`). Do not try to bind them to user accounts. |

## Non-goals

- The second outbound call to the sales rep. It needs its own ElevenLabs agent and a second call profile; the `call_rep` outcome degrades to a CRM task via `ensure_task`, which already works.
- A second ElevenLabs agent of any kind. One agent, one profile.
- A dedicated OM endpoint returning deal notes. Only if the `includeRelated` payload proves too heavy mid-call — and only after a curl proves it.
- Evaluation criteria beyond what is free. They are plumbed into `outcome.criteria` and are not wasted, but each one costs post-call analysis time before the callback fires.
- Deal-scoped briefing, a separate Triage button, transcript storage, and anything that touches `develop`.

## Affected areas (if known)

- `apps/mercato/src/modules/sales_call_planner/examples/deal-briefing-workflow.json` — optional callback branch (`IF_ELSE` on `wants_callback` → `WAIT_FOR_TIMER` → second call step). Guard against a callback loop: the branch already has one commit (`cb9de8932`) about a step that advanced once and stalled forever.
- A new seed script on the branch: set `owner_user_id` and `expected_close_at` on the Redwood deal, update Daniel Cho's `job_title`, insert one `CustomerActivity` (`activity_type: 'email'`, `occurred_at` minutes ago, the objection stated plainly) and one `CustomerComment` (authored by `superadmin@acme.com`, the 3-month billing deferral). `seedCustomerExamples` no-ops on an existing tenant, so this must be UPDATE + INSERT, never a re-seed.
- ElevenLabs workspace: one agent, the `sales_chief_call` call profile (Integrations → ElevenLabs Conversational AI → Call Profiles — `resolveCallProfile` fails closed on a name mismatch, with no fallback to `default`), one server tool, two data-collection fields.

## Risks and mitigations

- Twilio geo permissions block Polish mobiles by default (error 13227) and trial accounts only reach verified numbers. Test today on the exact handsets, and save the caller ID in both phones' contacts so a name shows on screen.
- `callback_minutes` is the only value in the flow that comes from what a human says live. Clamp it OM-side; a chief saying "twenty minutes" on stage ends the demo.
- Post-call analysis is a queued job with no published SLA, and it cannot start until the call terminates. Route the closing Say node to `End` and enable `end_call` so the agent hangs up rather than waiting for the chief to.
- The server tool is the only mid-call network dependency. Keep the response small, test it on the demo network, and write the failure behaviour into the tool description: say plainly that the CRM could not be reached, never fill the gap with a guess.
- Both people are blocked on each other until the tool contract is fixed. Pin the URL, the header name and its literal token, and a worked example response before either side starts.

## Order of work for the remaining window

1. Verify `admin@`, `superadmin@`, `employee@` exist on demo.openmercato.com.
2. Curl `tools/execute` with the `omk_` key: confirm `customers.get_company` with `includeRelated: true` returns the deal's comments (if not, Patryk adds `deal_id` to `variables`), and check how heavy the payload is.
3. Maciej: the `sales_chief_call` profile, then the agent prompt against `{{brief}}` and `{{company_name}}`, then the two data-collection fields, then the server tool. In that order every interruption leaves a working phone call.
4. Patryk: the seed script, then the callback branch if time allows.
5. Reserve the last 30 minutes for two full rehearsals on the real handsets, and record a successful run as a fallback video.
