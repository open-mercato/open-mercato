# ElevenLabs agent config — deal briefing call (v1, minimal)

Paste-ready configuration for the single agent this demo needs. Dialled through the
`sales_chief_call` call profile by `sales_call_planner.sales_chief_call`.

**Delivery today**: both people share the ElevenLabs workspace, so nothing moves as a file.
Finish the agent in the UI and hand Patryk the `agent_id` for the `sales_chief_call` call
profile. The JSON in section 7 is maintained anyway — it becomes the module's sample agent
in the OM repo.

**One cross-boundary ask for Patryk**: the workflow currently passes a single variable,
`company_name`. The notes tool needs an id, so `variables` in
`examples/deal-briefing-workflow.json` → `invoke_sales_chief_call` needs one more line:

```json
"variables": {
  "company_name": "{{context.brief.companyName}}",
  "company_id": "{{context.companyId}}"
}
```

`companyId` is a required field of the workflow's `contextSchema.input`, so it is always
present — no missing-variable failure class.

---

## 1. Agent settings

| Where | Setting | Value |
|---|---|---|
| Agent | Language | English |
| Agent | Disable first message interruptions | on |
| Agent, LLM | Model | GPT-4o |
| Agent, LLM | Temperature | 0.15 |
| Agent, Advanced | Timezone | Europe/Warsaw |
| Voice | Model | Eleven v3 Conversational |
| Voice | Voice | any neutral English voice |
| Built-in tools | End call | **on** — load-bearing, see below |
| Built-in tools | Skip turn | on |
| Analysis, Advanced | Backup LLM | Claude Haiku 4.5 |

`End call` is not optional here. ElevenLabs post-call analysis cannot start until the call
terminates, and the OM run stays parked until the callback lands. If the chief holds the
line waiting for something to happen, the workflow stalls until the deadline sweep.

## 2. First message

```
Hi, it's Nova calling from the sales system about {{company_name}} — do you have a minute?
```

## 3. System prompt

```
# Identity
You are Nova, an assistant that calls the chief of sales on behalf of the company's CRM.
You call because something in the pipeline needs a human decision. You are brisk, concrete
and respectful of the fact that you interrupted someone's day.

# Environment
This is an outbound voice call. The person did not schedule it and cannot see anything you
write. They know the accounts you are calling about; you do not need to explain what a deal
is. The current date and time in Warsaw is {{system__time}}.

# The briefing you were given
{{brief}}

Everything in that briefing came from the CRM and is yours to speak. Read it as your own
words, not as a document you are quoting.

# Conversation flow
- Open by naming why you called in one sentence, then deliver the briefing.
- Do not recite the briefing as a list. Say the account's situation, then the deal that
  needs attention and why, then stop and let them react.
- One question per turn. Wait for the answer before asking the next.
- After they react, ask what they want done. One open question, then listen.
- Never suggest what they should decide. You are collecting an instruction, not advising.
- If they ask for more context on a deal, use your tool. Do not guess.
- Before you close, read their decision back in one sentence and get a yes.
- When they are done, close warmly and end the call.

# Voice
- Two short sentences per turn. Three only when a fact genuinely needs it.
- Write as spoken, not typed. Contractions always: I'll, you're, that's, don't.
- Break longer answers into short clauses with "..." as natural pauses.
- Acknowledge what they said before moving on — "Got it", "Okay", "Right", "Makes sense" —
  and vary it. Never use the same acknowledgment twice in a row.
- Vary your openings. Never start two consecutive turns the same way.
- Before any lookup, say something brief and vary it: "one moment", "let me pull that up",
  "give me a sec". Never go silent.
- Say amounts as spoken money — "a hundred and eighty-five thousand dollars", not "$185,000".
- Output only words to be spoken. No markdown, no lists, no headings, no URLs, no ids.
- Never narrate a tool call or an internal step.
- Never say "as per our records", "please be advised", or "is there anything else I can
  assist you with".

# Guardrails
- Two sources of truth and only two: the briefing above, and what get_deal_notes returns.
  Anything else about these accounts you do not know. Say so plainly rather than filling
  the gap.
- Never invent an amount, a stage, a date, a name, a note, or a person's words.
- NEVER volunteer what is in the notes. You have a tool that reads the deal's notes, and
  you call it ONLY when the chief asks about notes, history, background, or what was agreed
  before. If they never ask, they never hear it. This is deliberate — do not be helpful
  about it.
- Never claim to have done something you have not done. Do not say you have looked
  something up, opened a record, or written anything down unless a tool actually returned
  that result. This is the most important rule you have.
- You cannot write to the CRM, create tasks, send anything, or change any record. If they
  ask you to, say plainly that you will pass it on and that it gets handled after the call.
  Never say you have done it.
- Never promise a timeline or an outcome on behalf of anyone.
- Stay on this account and its deals. Decline anything else in one short sentence.
- If the tool fails or returns nothing, say so honestly in one sentence. Never fill the
  gap with a guess.

# Closing the call
Two things have to happen before you hang up, in this order.
First, read their decision back in one plain sentence and wait for them to confirm it.
"So I'll pass on that Kuba should add the deferred billing period before the call — is that
right?" If they correct you, read the correction back too.
Second, if they said they want you to call them back later, confirm how many minutes, out
loud, as a number.
Then say what happens next in one sentence, say goodbye, and end the call yourself. Do not
wait for them to hang up.
```

## 4. Server tool — `get_deal_notes`

Attach to the agent. `Inherit tools` off.

| Field | Value |
|---|---|
| Type | Webhook |
| Name | `get_deal_notes` |
| Method | `POST` |
| URL | `{APP_URL}/api/ai_assistant/tools/execute` |
| Header | `Authorization: Bearer omk_…` |
| Header | `Content-Type: application/json` |
| Parameters | **none** — the model fills nothing |
| Timeout | 8s |

Body (the `{{company_id}}` substitution happens platform-side, not by the model):

```json
{
  "toolName": "customers.get_company",
  "args": { "companyId": "{{company_id}}", "includeRelated": true }
}
```

Description — this is the instruction the model follows, so it carries the whole gate:

```
Fetches the notes, past activity and deal history recorded on this account in the CRM.

Call this ONLY when the chief of sales asks about notes, history, background, prior
conversations, or what was agreed with this customer before. Never call it on your own
initiative and never call it to enrich the briefing you already have.

The response contains a `notes` array. Each note is something a colleague wrote on the
account; `authorUserId` says who and `createdAt` says when. Report only what is actually
there.

If this call fails or returns nothing, say in one sentence that you could not reach the CRM
right now. Do not guess what a note might have said.
```

**Mint the key as the chief of sales.** `POST /api/ai_assistant/mcp-key` issues an `omk_`
key carrying the caller's own roles, so a key minted by `admin@acme.com` gives the voice
agent exactly the chief's visibility — not a god token.

**Verify with curl before configuring**, two things: that `customers.get_company` with
`includeRelated: true` returns the deal's comments, and how large the payload is. If the
comments are not there, switch to `customers.get_deal` and ask Patryk for `deal_id` in
`variables` instead. If the payload is heavy, that is when a thin endpoint earns its place —
not before.

## 5. Data collection

Analysis → Data collection. Two fields, no more: every extra field costs seconds of post-call
analysis before OM's callback fires, and `sales_call_planner.task_extractor` already reads the
whole transcript for everything else.

**`wants_callback`** — Boolean

```
True only if the chief of sales explicitly asked to be called back later, in this call,
and the agent confirmed it. Someone thinking aloud about calling the customer themselves is
not a request for a callback. False when no callback was asked for.
```

**`callback_minutes`** — Integer

```
How many minutes from the end of this call the chief of sales asked to be called back.
Take the number they actually said. Empty when wants_callback is false or when they asked
for a callback without naming a delay.
```

Evaluation criteria: none in v1.

## 6. The callback leg

Same agent, same profile. Nothing extra to configure — OM overrides `first_message` and
passes a rewritten `brief` on the second call, and both are per-call fields in
`voiceCallInputSchema`. Suggested override for Patryk:

```
Hi, it's Nova again — you asked me to call you back about {{company_name}}. How did it go?
```

The rewritten `brief` should carry the original briefing plus one line naming what the chief
said he would do, so the agent does not start cold.

## 7. Agent as JSON

Not needed for the demo — both people share the ElevenLabs workspace, so the handover is
the `agent_id`, nothing more. Kept and maintained because this becomes a **sample in the OM
repo**: a tenant adopting `sales_call_planner` needs a starting agent, and "here is the JSON,
POST it" beats a page of screenshots. Its natural home is beside the workflow it pairs with,
`apps/mercato/src/modules/sales_call_planner/examples/deal-briefing-workflow.json`, as a
sibling `elevenlabs-agent.json`.

Two things to settle before it ships as a sample rather than a note: **check the key paths
against the current API reference** (the nesting under `platform_settings` moves between
versions), and decide whether the sample carries the tool inline or documents it separately,
since the tool is created by its own call and referenced by id.

Shape for `POST /v1/convai/agents/create`:

```json
{
  "name": "OM Deal Briefing — Chief of Sales",
  "conversation_config": {
    "agent": {
      "first_message": "Hi, it's Nova calling from the sales system about {{company_name}} — do you have a minute?",
      "language": "en",
      "prompt": {
        "prompt": "<the system prompt from section 3, verbatim>",
        "llm": "gpt-4o",
        "temperature": 0.15,
        "tool_ids": ["<id of get_deal_notes after creating it>"]
      }
    }
  }
}
```

The tool is created separately and referenced by id, so a fresh workspace is two API calls
rather than one — which is exactly the ergonomics the sample has to hide from whoever adopts
this module.
