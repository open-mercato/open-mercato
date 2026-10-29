# Open Mercato Workflows — Personas & User-Story Catalog (UX Redesign Foundation)

**Companion to:** [`2026-07-26-workflows-ux-redesign.md`](./2026-07-26-workflows-ux-redesign.md) — the redesign spec that addresses this catalog. Phase exits in that spec are measured by re-scoring the stories here. Where a story's acceptance hint and the spec differ, the spec's Review Decisions section governs (notably E7-04: the `needs_review` outcome is resolved as visible parked state, not a parallel continuation route, in v1).

Source basis: issue #4251 backlog (#4229–#4250), workflows-module deep-dive report, agent-orchestrator/OM-modules report (35 seed scenarios), branch `feat/agent-orchestrator-mvp`.

**Hard constraint:** the form-based (non-visual) editor will be REMOVED. The only authoring surfaces are the **visual editor** and **code-level editing** (JSON/code-defined definitions, API/MCP). Every story assumes this.

Legend — `Today`: ✅ works well · 🟡 possible but painful (reason in ≤6 words) · ❌ impossible today. `Backlog`: covering issue(s) from #4229–#4250, or **GAP** (no existing issue covers it).

---

## 1. Personas

| # | Persona | Skill | Goals | Context of use | OM surfaces |
|---|---------|-------|-------|----------------|-------------|
| P1 | **Ola — Workflow Author** (citizen developer, ops power user; the "Wojciech" persona from the OZE CRM demo) | Business-technical; no code; understands processes, not JSON/ISO-8601 | Build lead→install, order-approval, dunning flows without engineering help; trust that saves stick | Backoffice visual editor, several hours/week; iterates on live flows | `/backend/definitions/visual-editor`, business rules, instances list |
| P2 | **Marek — Developer / Integrator** | Full-stack TS; builds modules & standalone apps | Ship code-defined workflows, custom activities/functions, integrations; keep definitions reviewable in git | IDE + code-defined `source:'code'` definitions, customize/reset-to-code, API | `code-registry.ts`, REST API, docs, visual editor (read/verify) |
| P3 | **Kasia — Frontline Task Assignee** (sales rep / support agent) | Non-technical | Do the work: "call this customer", "review this return" — with full context, on time; never see workflow internals | Task inbox many times a day; mobile sometimes; never opens the editor | Task Inbox (`backend/tasks`), notifications, customer/order detail pages, CustomerTodoLink tasks |
| P4 | **Tomasz — Operations Manager / Approver** | Semi-technical | Approve orders/quotes/refunds fast with the facts in front of him; dispose agent proposals; watch team SLA | Short, frequent decision sessions; order-approval widget; caseload | Order-approval widget on `sales.document.detail.order`, agent Caseload, Task Inbox, dashboards |
| P5 | **Ania — Agent-Ops Engineer** | Technical; owns agents + the workflows that invoke them | Wire INVOKE_AGENT steps with typed I/O, branch on outcomes, route guardrail trips to humans, keep evals green | Builds & monitors agentic processes; playground; traces | Agent cockpit (overview/agents/playground/caseload/traces), visual editor, workflow instances |
| P6 | **Piotr — Tenant Admin** | Admin-technical | Correct roles/permissions out of the box; task access following business context; audit & governance | Occasional but high-stakes: role setup, permissions, incident audits | Auth/roles, ACL features, workflow definitions list, audit/event log |
| P7 | **Ewa — Portal Customer** (external task actor) | Consumer-level | Approve/confirm her own step (e.g. accept install date, sign off milestone) from the portal — the #4247 broken case | Rare, mobile-first, zero training; only sees her own records | Customer portal task/approval surface, portal notifications |
| P8 | **Om-Agent — the AI agent as author & consumer** | Machine | Generate/edit valid definitions programmatically; reference only real context fields; receive structured validation errors; schema quality IS its UX | `om-create-opencode-agent` flows, MCP/REST, INVOKE_AGENT self-orchestration | Definitions API, context-schema API, OUTCOME schemas, machine-readable errors |

---

## 2. User Stories

### E1 — Authoring: creating & structuring a flow (canvas, palette, editing)

| ID | Story | Acceptance hint | Today | Backlog |
|----|-------|-----------------|-------|---------|
| E1-01 | As Ola, I want to drag a step type from the palette and drop it where I want on the canvas, so that building feels direct instead of click-appends-at-an-offset. | Drop position = node position; ESC cancels drag. | 🟡 click-to-append only | **GAP** |
| E1-02 | As Ola, I want to change a step's type in place (e.g. AUTOMATED → USER_TASK) keeping its wiring and shared config, so that I don't rebuild long, arranged flows. | Transitions survive; incompatible config flagged, not dropped. | ❌ | #4237 |
| E1-03 | As Ola, I want to drag a transition's endpoint onto a different node to re-route it, so that I don't delete + recreate + reconfigure. | Activities/conditions on the edge are preserved. | ❌ | #4233 |
| E1-04 | As Ola, I want undo/redo (Cmd+Z) covering canvas moves, adds, deletes and config edits, so that mistakes are cheap. | Multi-level; survives dialog edits. | ❌ | **GAP** |
| E1-05 | As Ola, I want to duplicate a configured step and copy/paste multi-selected step groups (within and across workflows), so that repeated patterns are fast. | Pasted steps get fresh IDs; internal transitions kept. | ❌ | **GAP** |
| E1-06 | As Ola, I want the canvas to reopen exactly as I arranged it, so that my mental map survives sessions. | `_editorPosition` persisted per step. | ✅ | #4248 (shipped part) |
| E1-07 | As Ola, I want left→right flow with one-click auto-arrange/tidy, so that flows read like a timeline. | Dagre LR; manual positions win until re-tidy. | ✅ | #4248 |
| E1-08 | As Ola, I want every validation issue shown as a badge on the offending node/edge plus a Problems panel with click-to-navigate, so that I fix all issues, not just the first toast. | All Zod issues mapped to node IDs; panel count in toolbar. | 🟡 first-error flash toast | #4232 |
| E1-09 | As Ola, I want a save to either persist everything or refuse loudly with what's wrong, so that my edits never silently vanish. | No silent-drop path; dirty-state guard on navigation. | ❌ silent drops happen | #4232 |
| E1-10 | As Ola, I want to rename steps and edge labels inline on the canvas (double-click), so that labeling doesn't require opening dialogs. | Enter commits, Esc reverts. | 🟡 dialog-only | **GAP** |
| E1-11 | As Ola, I want a template gallery (order approval, lead routing, dunning, agent-review) to start from, so that I don't face a blank canvas. | Templates seeded per module; preview before insert. | 🟡 single "Load example" | **GAP** |
| E1-12 | As Ola, I want sticky notes/annotations and visual groups on the canvas, so that intent and ownership are documented where the flow lives. | Notes persist in definition metadata; excluded from execution. | ❌ | **GAP** |
| E1-13 | As Marek, I want a synced side-by-side code view (canvas ⇄ JSON/DSL) in the editor, so that power edits and reviews don't need a second tool — this replaces the retired form editor. | Two-way live sync; code errors highlight in canvas. | ❌ | **GAP** (post-#4237 direction) |
| E1-14 | As Ola, I want minimap, zoom-to-fit and pan controls for large flows, so that navigation stays cheap. | — | ✅ React Flow controls | — |
| E1-15 | As Ola, I want keyboard-first editing (Del removes, Enter opens config, arrows nudge, Cmd+Enter submits dialogs), so that heavy editing is fast. | Full dialog shortcut compliance (repo rule). | 🟡 partial (F focus only) | **GAP** |
| E1-16 | As Ola, I want to pick the workflow icon from a visual picker, so that I don't type lucide component names ("ShoppingCart") blind. | Search + preview grid. | 🟡 free-text lucide name | **GAP** |
| E1-17 | As Ola, I want a searchable palette with descriptions per step/action type, so that I can find capabilities as the catalog grows. | Fuzzy search; per-type doc link. | 🟡 8 hand-listed types | **GAP** |

### E2 — Data & context: schema, mapping, expressions, pickers (the C2 heart)

| ID | Story | Acceptance hint | Today | Backlog |
|----|-------|-----------------|-------|---------|
| E2-01 | As Ola, I want every step config panel to show which context fields are available at that step (computed from upstream steps/trigger), so that I never guess dot-paths. | Per-step availability, path-variant aware. | ❌ | #4245 |
| E2-02 | As Ola, I want a click-to-insert variable picker (`{{context.deal.id}}`) in every text/config field, so that wiring data is point-and-click. | Picker shows type + source step of each field. | ❌ | #4245 |
| E2-03 | As Ola, I want typed autocomplete inside `{{…}}` expressions with unknown-path errors at author time, so that typos can't reach runtime. | Squiggle + Problems panel entry on unknown path. | ❌ | #4245 |
| E2-04 | As Ola, I want to declare a workflow-level input/context schema (like sub-workflow ports, generalized), so that triggers, manual starts and callers validate against it. | Reuse `workflowIoContractSchema` 5 business types. | 🟡 components only | #4245 |
| E2-05 | As Ola, I want optional-field markers when different paths into a step yield different contexts, so that I handle missing data deliberately. | Field shown as `maybe` with contributing-paths hint. | ❌ | #4245 |
| E2-06 | As Ola, I want activity outputs (e.g. CALL_API responses) to carry real schemas visible to downstream steps, so that a customer-lookup result can feed the next action confidently. | Depends on OpenAPI response typing. | ❌ responses typed `string` | #4230 + #4245 |
| E2-07 | As Ola, I want a first-class "Set variable" action to shape/rename context values explicitly, so that data flow is visible instead of implicit output-merging. | Sets nested path; shows in context schema. | ❌ implicit merge only | **GAP** |
| E2-08 | As Ola, I want sample data from a previous run pinned to each step (n8n-style input/output panels), so that I map against real values, not abstractions. | Pin from execution history; redact PII per encryption rules. | ❌ | **GAP** |
| E2-09 | As Marek, I want interpolation failures to fail loudly (configurable) instead of leaving literal `{{…}}` in payloads, so that bad references can't silently hit external systems. | Strict mode default for new workflows. | ❌ silently passes literal | #4245 (+#4232) |
| E2-10 | As Om-Agent, I want a machine-readable per-step context schema endpoint, so that generated configs reference only fields that exist. | `GET /definitions/:id/context-schema?stepId=`. | ❌ | #4245 |
| E2-11 | As Ola, I want output-mapping rows to offer dropdowns of the agent OUTCOME schema keys / API response keys, so that mappings can't silently no-op. | Free-text escape hatch stays for experts. | ❌ free-text dot-paths | #4230 + #4235 + #4245 |
| E2-12 | As Ola, I want data-mapping edges to sub-workflow ports to validate types at connect time, so that mis-wiring is caught on drop. | Already the best part of the UX. | ✅ ports contract | — |
| E2-13 | As Marek, I want `{{workflow.*}}`, `{{env.*}}` (allowlist) and `{{now}}` namespaces discoverable in the picker with docs, so that platform variables aren't tribal knowledge. | Grouped sections in picker. | 🟡 undocumented in UI | #4245 |
| E2-14 | As Ola, I want inline transforms (format date, number math, concat, default-if-missing) in expressions, so that trivial shaping doesn't require EXECUTE_FUNCTION or a developer. | Small audited function library; no arbitrary JS. | ❌ | **GAP** |
| E2-15 | As Ania, I want the INVOKE_AGENT input builder validated against the agent's declared input shape / SAMPLE.json, so that agents receive what they expect. | Mismatch = author-time error. | ❌ free key/value rows | **GAP** |

### E3 — Actions/activities: configuring every activity without raw JSON

| ID | Story | Acceptance hint | Today | Backlog |
|----|-------|-----------------|-------|---------|
| E3-01 | As Ola, I want UPDATE_ENTITY configured via a command picker (browse `customers.deals.update`, `sales.orders.update`…) with a form generated from the command's input schema, so that updating a deal stage needs zero JSON. | Includes dictionary `statusValue` helper UX. | ❌ raw JSON `commandId`+`input` | **GAP** ⭐ |
| E3-02 | As Ola, I want CALL_API configured via an endpoint picker with required/optional parameter hints and response schema, so that internal API calls stop being guesswork. | Mirrors Business Rules' entity/field suggestions. | ❌ | #4235 (+#4230) |
| E3-03 | As Ola, I want SEND_EMAIL with a template picker, variable insertion and preview, so that notification steps are safe to author. | Renders with sample context. | 🟡 JSON config, stub service | **GAP** |
| E3-04 | As Ola, I want EMIT_EVENT with an event-name picker sourced from module `events.ts` registries (+ payload schema hint), so that I emit real events, not typos. | `customers.deal.won` selectable, not typed. | 🟡 free-text name | **GAP** |
| E3-05 | As Ola, I want CALL_WEBHOOK as a form (URL, method, headers table, body builder, signing hint), so that external calls don't require hand-written JSON. | SSRF rules surfaced as helper text. | 🟡 JSON config | #4235 (related) |
| E3-06 | As Ola, I want WAIT durations entered as number + unit (5 minutes / 2 days), so that I never write `PT5M` again. | Serializes to ISO-8601 under the hood; shared component. | 🟡 ISO-8601 strings | #4229 |
| E3-07 | As Ola, I want EXECUTE_FUNCTION with a dropdown of registered `workflowFunction:*` DI entries and an args form from each function's schema, so that function calls are discoverable. | Functions declare arg schemas at registration. | ❌ free-text name + JSON args | **GAP** |
| E3-08 | As Ola, I want **every** activity type to render a schema-driven config form (JsonBuilder demoted to an "advanced" toggle), so that no action requires JSON literacy. | One declarative activity registry: `{id, zodConfig, formFields, i18n, icon}`. | ❌ 7 of 8 types are raw JSON | **GAP** ⭐ (named in wait-for-condition spec §Deferred) |
| E3-09 | As Ola, I want retry policy edited as consistent friendly fields (attempts, first delay, backoff, max delay) identical everywhere, so that configs actually validate. | Kills `retryDelay`/`backoffMultiplier` vs `initialIntervalMs`/`backoffCoefficient` drift. | 🟡 field-name drift breaks validation | **GAP** |
| E3-10 | As Ola, I want the async toggle to explain what it changes (queued, workflow waits, output key `${activityId}_result`), so that I choose deliberately. | Inline helper + doc link. | 🟡 unexplained checkbox | **GAP** |
| E3-11 | As Ola, I want to paste a JSON config and have it parsed into the form fields (invalid JSON shows an error, never locks editing), so that copy-from-docs works. | Round-trips form ⇄ JSON. | ❌ pasted JSON locks editing | #4234 |
| E3-12 | As Ola, I want compensation configured visually (pick the compensating activity; saga path rendered on canvas), so that rollback logic is visible, not buried config. | Compensation edges shown dashed/reverse. | 🟡 config-only | **GAP** |
| E3-13 | As Ola, I want an action library panel with search, descriptions and per-action docs, so that discovering capabilities doesn't require the docs site. | Extends E1-17 to activity types. | 🟡 | **GAP** |
| E3-14 | As Marek, I want to register a custom activity type once (schema + handler) and have the editor auto-render its form and validation, so that extensions are first-class. | Single registry replaces the two dispatch switches + 4 UI lists. | ❌ two switches, stale AGENTS.md | **GAP** ⭐ |

### E4 — Conditions, branching & flow logic

| ID | Story | Acceptance hint | Today | Backlog |
|----|-------|-----------------|-------|---------|
| E4-01 | As Ola, I want an IF/ELSE gateway with an inline structured condition builder over context fields, so that simple branching doesn't require creating a Business Rule in another module. | Reuses business_rules `ConditionExpression` + ConditionBuilder UI. | 🟡 transition priorities + external BRs | **GAP** ⭐ (#4236 adjacent) |
| E4-02 | As Ola, I want a switch/router step on a field value with N labeled branches + default, so that multi-way routing is one node, not a priority puzzle. | Branch labels render on edges. | 🟡 priority-ordered transitions hack | **GAP** |
| E4-03 | As Ola, I want to create/edit Business Rules inline inside the workflow editor, so that I never leave the flow mid-thought. | Modal or side-panel BR editor; saves to business_rules. | ❌ | #4236 |
| E4-04 | As Ola, I want to see which Business Rules a workflow uses (and from a BR, which workflows use it), so that I can change rules without fear. | Dependency panel both directions. | ❌ | #4236 |
| E4-05 | As Ola, I want to drag actions/rules onto a transition line (icon appears on the edge; click to configure), so that per-transition behavior is visible on the canvas. | The C1 umbrella UX; per-type validators. | ❌ | #4244 |
| E4-06 | As Ola, I want an explicit "otherwise/default" transition marker, so that unmatched cases are a visible, deliberate route instead of a stuck instance. | Validator warns when absent on branching nodes. | 🟡 implicit lowest priority | **GAP** |
| E4-07 | As Ola, I want a loop primitive (for-each over a collection; repeat-until with max iterations), so that "call every overdue customer" doesn't require hand-drawn backward edges. | Iteration item exposed in context schema; safety cap. | ❌ backward edges only, banned in fork regions | **GAP** ⭐ |
| E4-08 | As Ola, I want a per-step error branch (on-failure edge) so that failures route to a handling path (notify, task, fallback) instead of failing the instance. | Distinct edge style; combines with retry policy. | 🟡 only `continueOnActivityFailure` | **GAP** ⭐ |
| E4-09 | As Ola, I want a wait-for-condition step (pause until a predicate over context holds, with timeout FAIL/CONTINUE), so that "wait until deal value > X" is declarative. | Spec `2026-07-20-workflows-wait-for-condition.md` — build it. | ❌ specced, not built | **GAP** (spec exists) |
| E4-10 | As Ola, I want to reorder transition evaluation by dragging in a list (priority derived), so that I stop typing magic numbers like "100". | Priority number demoted to advanced. | 🟡 string priority field, dueling defaults | **GAP** |
| E4-11 | As Ola, I want to preview a condition against sample context ("would this pass?") while editing, so that logic is verified before publish. | Uses pinned/test context from E2-08/E8-01. | ❌ | **GAP** |
| E4-12 | As Tomasz, I want branch labels rendered on edges so that a reader understands routes without opening dialogs. | — | ✅ label field exists | — |
| E4-13 | As Ola, I want pre-conditions vs post-conditions clearly distinguished (when each runs, what failure does), so that I stop guessing which to use. | Visual placement on edge (entry vs exit) + helper copy. | 🟡 confusing twin lists | **GAP** |

### E5 — Human tasks: definition-side

| ID | Story | Acceptance hint | Today | Backlog |
|----|-------|-----------------|-------|---------|
| E5-01 | As Ola, I want to pick task roles from a dropdown of existing tenant roles, so that role typos can't strand tasks. | Multi-select; warns on deleted roles. | ❌ comma-separated free text | #4239 |
| E5-02 | As Ola, I want to pick the assignee from a user dropdown (search by name), so that I never paste raw UserIds. | Respects org scoping. | ❌ raw UserId input | #4240 |
| E5-03 | As Ola, I want dynamic assignment from context ("owner of this customer", `{{context.deal.ownerId}}`), so that the right person gets the task at runtime. | Placeholder resolved at task creation; fallback role. | ❌ | #4240 (needs #4245) |
| E5-04 | As Ola, I want deadlines entered as number + unit ("2 days after task created"), so that business users never see ISO-8601. | Shared duration picker (same as E3-06); "deadline" wording, not "timeout". | ❌ | #4241 + #4229 |
| E5-05 | As Ola, I want reminder + escalation settings (remind before due; on breach notify manager / reassign / fail path) exposed as first-class fields, so that SLAs are enforceable. | `escalationRules` schema exists — surface it. | 🟡 schema hidden in "advanced" | #4241 |
| E5-06 | As Ola, I want deadline breach usable as a branch condition (SLA-breach edge out of the task node), so that the flow can escalate or fail deliberately. | Distinct edge type from completion edges. | 🟡 escalationRules partial, no edge | #4241 |
| E5-07 | As Ola, I want task instructions with rich text + variable interpolation ("Call {{context.customer.name}} about {{context.deal.title}}"), so that the assignee knows exactly what to do. | Preview with sample context. | ❌ | #4242 |
| E5-08 | As Ola, I want to bind the task to a business entity (customer/order/deal picked from context), so that the task carries "who/what it concerns" natively. | Entity ref = type + id path from context schema. | ❌ | #4242 + #4246 |
| E5-09 | As Ola, I want the task form builder to support field types, validation, defaults and a live preview, so that I see what Kasia will see. | Preview = actual runtime renderer. | 🟡 basic builder, no preview | #4243 |
| E5-10 | As Ola, I want Form Key explained in-UI and external-form binding finished (or the field removed), so that a half-built concept stops confusing authors. | Wojciech misread it — docs + completion. | ❌ half-implemented | #4243 |
| E5-11 | As Ola, I want a one-click "Approval" task preset (approve/reject buttons + comment + entity binding), so that the most common human step takes seconds to add. | Preset = pre-filled USER_TASK; outcome drives branches. | ❌ hand-built each time | **GAP** ⭐ |
| E5-12 | As Ola, I want to set task priority, so that inboxes can sort by urgency, mirroring the platform's priority-label convention. | Maps to inbox sort + notification urgency. | ❌ no priority field | **GAP** |

### E6 — Human tasks: runtime-side (inbox, portal, generic Task / C3)

| ID | Story | Acceptance hint | Today | Backlog |
|----|-------|-----------------|-------|---------|
| E6-01 | As Kasia, I want ONE "My Tasks" inbox unifying workflow tasks, agent-proposal reviews and customer todos, so that I never miss work split across three surfaces. | The C3 dashboard; filters by source/module. | ❌ three separate surfaces | #4246 |
| E6-02 | As Kasia, I want each task to show the record it concerns (customer/order card + deep link), so that "Make first call" tells me *which* customer. | Renders bound entity from E5-08. | ❌ context-free tasks | #4242 + #4246 |
| E6-03 | As Kasia, I want to claim role-assigned tasks so that my team doesn't double-work. | Exists; keep in redesign. | ✅ | — |
| E6-04 | As Kasia, I want due dates visible with overdue sorting/badges, so that I work the right order. | `dueDate` exists; surface + sort. | 🟡 field exists, weak UX | #4241 |
| E6-05 | As Kasia, I want to complete a task with its form inline next to the entity preview, so that I don't tab-juggle. | Form + record side-by-side. | 🟡 form only, no context | #4242 |
| E6-06 | As Kasia, I want an assignment notification with a deep link to the task, so that new work finds me. | Subscriber exists. | ✅ | — |
| E6-07 | As Kasia, I want to see and complete my tasks WITHOUT the "View Workflow Task" module permission, so that frontline roles need zero workflow-module grants. | Assignment + business access suffice. | ❌ gated by workflow perm | #4238 |
| E6-08 | As Ewa, I want to approve/complete my portal task (accept install date, confirm milestone) from the customer portal, so that external steps don't stall the process. | The concrete broken case behind C4. | ❌ portal role couldn't approve | #4247 |
| E6-09 | As Tomasz, I want agent-proposal disposition to appear as a rich task (proposal diff, confidence, FACTS grid, approve/edit/reject) in the unified inbox, so that Caseload and Task Inbox stop being parallel worlds. | Today's disposition task is bare `formSchema={proposalId,payload,confidence}`. | ❌ | #4246 + **GAP** (rich proposal task type) |
| E6-10 | As Tomasz, I want the order-approval widget on the order detail page to complete the workflow task in place, so that approvals happen in business context. | Exists — the pattern to generalize. | ✅ | — |
| E6-11 | As Kasia, I want to reassign/delegate a task (with reason, audited), so that vacations and load-balancing don't stall flows. | `reassign` exists in escalation schema; no user UI. | 🟡 schema only | **GAP** |
| E6-12 | As Tomasz, I want a team workload view (open tasks per assignee/role, aging), so that I can rebalance before SLAs breach. | Feeds from unified Task entity. | ❌ | **GAP** |
| E6-13 | As Kasia, I want tasks to appear on the related entity's detail page (like CustomerTodoLink does for people) for every bound entity type, so that record pages show pending work. | Generalize `usePersonTasks` pattern via widget injection. | 🟡 customers only | #4246 |
| E6-14 | As Piotr, I want task visibility/actionability derived from business-record access + assignment, so that "can see the Customer ⇒ can see its task" holds everywhere including portal. | The C4 permission model. | ❌ | #4247 + #4238 |

### E7 — Agent steps: INVOKE_AGENT, disposition, guardrails, agentic tasks

| ID | Story | Acceptance hint | Today | Backlog |
|----|-------|-----------------|-------|---------|
| E7-01 | As Ania, I want to add an Invoke Agent node picking from the agent registry with labels/descriptions, so that agent selection is discoverable. | Exists (`/api/agent_orchestrator/agents`). | ✅ | — |
| E7-02 | As Ania, I want the agent input builder validated against the agent's declared input / SAMPLE.json, so that malformed input fails at author time. | "Insert sample" from SAMPLE.json as starting point. | ❌ free key/value rows | **GAP** ⭐ |
| E7-03 | As Ania, I want outputMapping to offer the agent's OUTCOME schema keys as a picker, so that mappings can't silently no-op on a typo. | OUTCOME JSON-Schema is already machine-readable. | ❌ warn-only dot-paths | #4245 + **GAP** |
| E7-04 | As Ania, I want declarative outcome edges from an agent node — `auto_approved` / `needs_review` / `informative` / `rejected` / `error` — so that branching stops being string-matching on merged context keys. | Edge types validated: at least error+one success path. | ❌ context string-matching | **GAP** ⭐ |
| E7-05 | As Ania, I want a guardrail-block outcome edge (route to human review / remediation branch), so that a prompt-injection block becomes a governed path instead of a dead FAILED instance. | `agent_orchestrator.guardrail.tripped` already exists. | ❌ fail-stop only | **GAP** ⭐ |
| E7-06 | As Ania, I want agent *failure* retry policy (backoff, max attempts) configured separately from proposal *rejection* handling, so that infrastructure errors and business rejections stop being conflated. | Rejected proposal ≠ retryable error. | ❌ conflated in worker | **GAP** |
| E7-07 | As Tomasz, I want the below-threshold USER_TASK to render the proposal payload as a readable diff with confidence and FACTS.json decision grid, so that disposing takes seconds, not archaeology. | Same renderer as Caseload's ProposalCard. | ❌ bare formSchema | **GAP** (pairs E6-09) |
| E7-08 | As Ania, I want the auto-approve threshold as a slider with fail-closed semantics explained (missing confidence ⇒ human), so that disposition policy is understood, not guessed. | Helper copy + link to disposition docs. | 🟡 bare radio + number | **GAP** |
| E7-09 | As Ania, I want to chain agents (classify → draft → approve) with typed context handoff between them, so that multi-agent processes are reliable. | Story #34 from orchestrator report; needs E2 + E7-03. | 🟡 possible, stringly-typed | #4245 |
| E7-10 | As Ania, I want one Agentic Task launcher (manual / API key / cron / domain event) pointing at a workflow, so that "N triggers → one governed execution" stays one definition. | Exists (`AgentTaskDefinition`). | ✅ | — |
| E7-11 | As Ania, I want the workflow instance step to link to the agent run trace (spans, tool calls, context bundle), so that debugging an agent step is one click. | `AgentRun.processId/stepId` already correlate. | 🟡 data linked, no UI link | **GAP** |
| E7-12 | As Ania, I want a parked agent step to show "waiting for proposal disposition since X, assigned to Y" on the instance view, so that stuck approvals are diagnosable at a glance. | Distinct from generic PAUSED. | 🟡 generic PAUSED | **GAP** |
| E7-13 | As Ania, I want a disposition deadline (nobody disposed in 2 days → escalate/auto-reject via a branch), so that agent proposals can't rot in the queue. | Reuses E5-04/05/06 deadline mechanics on the disposition task. | ❌ | #4241 (extend) + **GAP** |
| E7-14 | As Om-Agent, I want definition create/update APIs to return structured, machine-readable validation errors (path, code, expected), so that I can self-correct generated workflows. | Zod issues already structured — expose them. | 🟡 exists, human-formatted | #4245 (adjacent) |
| E7-15 | As Ania, I want parked instances auto-cancelled (or routed to an error branch) when the awaited agent's delegation grant is revoked, so that orphaned waits don't accumulate. | Listens to `agent_orchestrator.delegation_grant.revoked`. | ❌ | **GAP** |

### E8 — Testing & debugging

| ID | Story | Acceptance hint | Today | Backlog |
|----|-------|-----------------|-------|---------|
| E8-01 | As Ola, I want to start a test instance by supplying initial context as JSON, so that I don't manufacture fake deals to trigger flows. | On Patryk L.'s branch — ship it. | 🟡 raw textarea, branch-only | #4249 |
| E8-02 | As Ola, I want the test-start form generated from the declared context schema (JSON as advanced fallback), so that non-developers can test too. | Needs E2-04. | ❌ | #4249 + #4245 |
| E8-03 | As Ola, I want a dry-run mode (side effects mocked/recorded, path highlighted on canvas), so that I can verify routing before anything real happens. | Mock registry per activity type; diff-style "would do" report. | ❌ | **GAP** ⭐ |
| E8-04 | As Ola, I want step-through execution (pause at each step, inspect context, continue), so that I understand exactly how data evolves. | Debug flag on test instances. | ❌ | **GAP** |
| E8-05 | As Marek, I want to re-run a failed instance from the failed step with optionally edited context, so that one bad field doesn't force a full re-run. | Audited as a new event type. | ❌ whole-instance retry only | **GAP** ⭐ |
| E8-06 | As Marek, I want a per-step input/output inspector (what came in, what went out, duration) in the instance view, so that diagnosis doesn't mean reading raw event JSON. | `StepInstance.inputData/outputData` already stored. | 🟡 raw JSON in event log | **GAP** |
| E8-07 | As Ola, I want the instance view to live-update (SSE via DOM Event Bridge) as steps execute, so that I watch runs instead of hammering refresh. | `clientBroadcast` on `workflows.instance.*` events. | ❌ manual refetch | **GAP** |
| E8-08 | As Ola, I want the last run's execution painted onto the editor canvas (green/red/active overlay), so that authoring and debugging share one surface. | Toggle "show last run" in editor. | 🟡 separate read-only graph | **GAP** |
| E8-09 | As Ola, I want to save named test contexts (fixtures) per workflow, so that regression-testing a flow is one click. | Pairs with E2-08 pinning. | ❌ | **GAP** |
| E8-10 | As Marek, I want to send a signal to a parked instance from the UI (name + payload form), so that testing WAIT_FOR_SIGNAL doesn't require curl. | Signal names suggested from definition. | ❌ API only | **GAP** |
| E8-11 | As Ola, I want to simulate an event trigger with a sample payload (pick event, edit payload, fire), so that trigger filters/mappings are testable. | Sample payloads from event schema registry. | ❌ | **GAP** |
| E8-12 | As Ola, I want a Problems panel listing ALL validation issues with severity and click-to-node, so that pre-publish cleanup is systematic. | Same panel as E1-08. | 🟡 first-error toast | #4232 |
| E8-13 | As Marek, I want one unified execution timeline (steps, activities, signals, tasks) replacing the duplicated timeline + raw event log, so that the story of a run reads top-to-bottom. | Event log demoted to "raw" tab. | 🟡 two overlapping views | **GAP** |
| E8-14 | As Ania, I want to filter instances by definition, status, correlationKey and date, so that finding the right run is fast. | Saved filters. | 🟡 basic list filters | **GAP** |

### E9 — Triggers & integration

| ID | Story | Acceptance hint | Today | Backlog |
|----|-------|-----------------|-------|---------|
| E9-01 | As Ola, I want event triggers configured with an event picker from module registries (`customers.deal.won`, `sales.order.created`, `data_sync.run.failed`…) with payload shape shown, so that trigger setup is point-and-click. | Event IDs are `as const` — enumerable. | 🟡 free-text pattern | **GAP** (pairs #4245) |
| E9-02 | As Ola, I want trigger filter conditions built with the structured condition builder over the event payload, so that "orders over 5000 PLN" needs no JSON. | Reuse business_rules ConditionBuilder. | 🟡 JSON-ish filter config | **GAP** |
| E9-03 | As Ola, I want trigger context-mapping (event payload → workflow context) with pickers on both sides, so that flows start with clean, typed input. | Left: event schema; right: context schema. | ❌ free-text paths | #4245 |
| E9-04 | As Ola, I want a native cron/schedule trigger on a workflow definition, so that nightly reconciliations don't need a detour through Agentic Tasks. | Cron editor with human-readable preview. | ❌ agentic-task cron only | **GAP** |
| E9-05 | As Kasia, I want a "Start workflow" button with a generated input form on relevant record pages, so that launching a flow for *this customer* is self-service. | Widget injection + context pre-fill from record. | 🟡 raw JSON start dialog | #4249 + #4245 |
| E9-06 | As Marek, I want an inbound-webhook trigger (URL, secret, payload → context mapping), so that external systems start workflows directly. | Builds on webhooks module inbound receiver. | 🟡 manual event glue | **GAP** |
| E9-07 | As Ola, I want to browse/insert sub-workflows with typed ports and version pinning, so that flows compose. | Exists — the model to generalize. | ✅ | — |
| E9-08 | As Ola, I want to publish a flow as a reusable component, so that shared fragments live once. | `kind:'component'` exists. | ✅ | — |
| E9-09 | As Ola, I want debounce and max-concurrent-instances explained with plain-language copy and safe defaults, so that trigger storm protection isn't expert-only. | Fields exist; UX/copy missing. | 🟡 bare fields | **GAP** |
| E9-10 | As Marek, I want API-started workflows to have a documented, typed start payload (from the context schema) in OpenAPI, so that integrators don't reverse-engineer context shape. | Depends on #4230 typing work. | 🟡 responses typed `string` | #4230 |
| E9-11 | As Ola, I want a reverse lookup "which workflows does event X trigger?" (and per-workflow trigger list), so that event storms and dead flows are traceable. | Global triggers overview page. | ❌ | **GAP** |
| E9-12 | As Marek, I want integration commands (e.g. sync a record to Akeneo) as first-class activities with connection selection, so that integration orchestration doesn't need CALL_API gymnastics. | Spec `2026-03-29-workflow-integration-flows.md` — build. | ❌ specced only | **GAP** (spec exists) |

### E10 — Governance & lifecycle

| ID | Story | Acceptance hint | Today | Backlog |
|----|-------|-----------------|-------|---------|
| E10-01 | As Ola, I want draft vs published lifecycle with explicit publish, so that WIP never runs in production. | Exists. | ✅ | — |
| E10-02 | As Piotr, I want a visual + textual diff between definition versions, so that reviews and rollbacks are informed. | Canvas diff (added/removed/changed nodes) + JSON diff. | ❌ | **GAP** |
| E10-03 | As Ola, I want clear semantics for editing while instances run (running instances pin their version; new starts use latest published), surfaced in the UI, so that edits are safe. | Banner: "N running instances on v3". | 🟡 semantics unclear in UI | **GAP** |
| E10-04 | As Marek, I want code-defined workflows to show a diff between code and customization on Customize/Reset, so that overrides are auditable. | Tri-state `source` exists; diff missing. | 🟡 no diff view | **GAP** |
| E10-05 | As Piotr, I want modules to seed sensible default role grants for workflow features, so that fresh tenants don't start with permission archaeology. | The A3 item. | ❌ | #4231 |
| E10-06 | As Piotr, I want task permissions decoupled from workflow-admin permissions, so that frontline/portal roles carry zero workflow-module grants. | Same model as E6-07/E6-14. | ❌ | #4238 |
| E10-07 | As Piotr, I want an audit trail of definition edits (who, when, what changed), so that incident reviews have answers. | Definition events exist; surface a history tab. | 🟡 events exist, no UI | **GAP** |
| E10-08 | As Ola, I want concurrent-edit conflicts surfaced via the standard conflict bar with reload/merge options, so that two editors don't clobber each other. | Optimistic-lock header already sent. | 🟡 handled, UX unpolished | — |
| E10-09 | As Piotr, I want export/import of workflow definitions (JSON bundle incl. referenced BRs), so that flows move between envs/tenants. | Warn on unresolved refs (rules, agents, commands). | ❌ | **GAP** |
| E10-10 | As Marek, I want the definitive definition format to be reviewable code (PR-able, generated types), so that the visual editor and git are two views of one artifact. | Extends code-defined registry to round-trip. | 🟡 code-defined is one-way | **GAP** |
| E10-11 | As Piotr, I want disabling a workflow to state its policy for running/parked instances (finish vs cancel), so that switch-offs are predictable. | Confirmation dialog with instance counts. | 🟡 bare enabled switch | **GAP** |
| E10-12 | As Piotr, I want per-definition start/edit permissions (beyond module-level ACL), so that sensitive flows (payouts) are restricted to specific roles. | Definition-level ACL refs. | ❌ module-level only | **GAP** |

### E11 — AI-assisted authoring

| ID | Story | Acceptance hint | Today | Backlog |
|----|-------|-----------------|-------|---------|
| E11-01 | As Ola, I want to generate a draft workflow from a prompt ("when a deal is won, create onboarding tasks and notify the owner"), so that the blank canvas disappears. | Generates valid definition using real events/commands/context schemas; opens as draft. | ❌ | **GAP** ⭐ |
| E11-02 | As Ola, I want AI-suggested data mappings between steps (schema-aware), so that wiring is proposed, not hand-built. | Suggestions ranked; one-click apply; needs E2. | ❌ | **GAP** |
| E11-03 | As Tomasz, I want "explain this workflow" (plain-language summary of routes, actions, SLAs), so that handovers and reviews don't require reading the graph. | Exportable to docs/PR description. | ❌ | **GAP** |
| E11-04 | As Ola, I want an AI fix-it on the Problems panel ("resolve these 5 validation issues"), so that cleanup is assisted. | Proposes patches; author approves each. | ❌ | **GAP** |
| E11-05 | As Om-Agent, I want an MCP tool to create/update/validate workflow definitions with typed errors and context-schema introspection, so that agents author workflows as reliably as humans. | The agent-orchestrator building its own pipelines. | 🟡 raw REST only | **GAP** ⭐ |
| E11-06 | As Ola, I want AI-generated test contexts matching the context schema (realistic fixtures), so that testing starts instantly. | Pairs with E8-09. | ❌ | **GAP** |
| E11-07 | As Ola, I want an in-editor copilot answering "how do I…" grounded in workflow docs and this tenant's flows, so that help is contextual. | Uses existing AiChat embedding. | ❌ | **GAP** |
| E11-08 | As Ola, I want next-step suggestions while building (based on current node + catalog patterns), so that authoring has a tab-complete feel. | Non-intrusive ghost suggestions. | ❌ | **GAP** |

### E12 — Observability & operations

| ID | Story | Acceptance hint | Today | Backlog |
|----|-------|-----------------|-------|---------|
| E12-01 | As Tomasz, I want per-definition KPIs (runs, success %, p95 duration, task SLA hit rate), so that process health is measurable. | Rollup pattern exists in agent module (`AgentMetricRollup`) — mirror it. | ❌ | **GAP** |
| E12-02 | As Ania, I want a needs-attention queue (failed, stuck > threshold, SLA-breached, awaiting disposition too long), so that triage starts from one list. | Mirrors cockpit needs-attention pattern. | 🟡 status filters only | **GAP** |
| E12-03 | As Ania, I want one process view correlating workflow instance ↔ agent runs ↔ proposals ↔ tasks, so that a business process reads as one story. | Enterprise processes projection exists — extend to core view. | 🟡 enterprise-only projection | **GAP** |
| E12-04 | As Piotr, I want alerts (notification/webhook) on repeated failures of a definition, so that broken automations surface themselves. | Threshold + cooldown config. | ❌ | **GAP** |
| E12-05 | As Tomasz, I want an SLA overview of user tasks (overdue counts by role/assignee, aging buckets), so that human bottlenecks are visible. | Feeds from unified Task entity + deadlines. | ❌ | #4241 + #4246 |
| E12-06 | As Ania, I want token/cost visibility per INVOKE_AGENT step and per definition, so that agentic workflow cost is governable. | Agent usage data exists; join on processId/stepId. | 🟡 data exists, not joined | **GAP** |
| E12-07 | As Piotr, I want retention/archival policy for instances and events, so that the event-sourced tables don't grow unbounded. | Archive to cold storage; keep aggregates. | ❌ | **GAP** |
| E12-08 | As Marek, I want structured logs correlated by instanceId/stepId via the logging facade, so that cross-service debugging is greppable. | Mostly present. | 🟡 partial | — |
| E12-09 | As Ania, I want bulk operations on instances (retry all failed of definition X since date Y; cancel stuck), so that incident recovery isn't one-by-one. | Uses progress module for long ops. | ❌ | **GAP** |
| E12-10 | As Piotr, I want a cross-organization health overview (multi-org tenants), so that platform admins see systemic issues. | Respects tenant scoping rules. | ❌ | **GAP** |

---

## 3. Synthesis

**Counts:** 156 stories. Per epic: E1 17 · E2 15 · E3 14 · E4 13 · E5 12 · E6 14 · E7 15 · E8 14 · E9 12 · E10 12 · E11 8 · E12 10. `Today`: ✅ 14 · 🟡 61 · ❌ 81. **91 stories carry a GAP tag** (88 GAP-only, 3 GAP+issue) — i.e. **58% of validated user needs have no covering backlog issue.**

### 3a. Top 10 recurring pain themes (ranked by story count)

1. **No typed data context** — stringly `{{context.*}}`, no schema, no pickers, silent no-ops (≈26 stories: all E2, plus E5-03, E7-03/09, E8-02, E9-03/05/10) — #4245 is the single highest-leverage issue.
2. **JSON-first activity configuration** — 7 of 8 activity types are raw JSON textareas; no command/event/function/endpoint pickers (≈15: most of E3, E9-01/02).
3. **No test/debug loop** — no dry-run, step-through, replay-from-step, live view, step I/O inspector, fixtures (≈14: E8 nearly entire).
4. **Fragmented human-task surfaces & context-free tasks** — Task Inbox vs Caseload vs customer todos vs notifications; tasks don't say which record (≈13: E6 core, E5-08, E7-07).
5. **Canvas editing ergonomics** — no undo, no copy/paste, no drag-drop placement, no reattach, no in-place type change, no annotations/templates (≈12: E1 core).
6. **Agent-step contract gaps** — no outcome edges, guardrail routing, typed agent I/O, disposition deadlines, trace links (≈11: E7 core) — the orchestrator is the workflow module's most demanding customer.
7. **Missing flow-logic primitives** — no if/else node, switch, loop, error branch, wait-for-condition; branching hidden in priorities + external BRs (≈10: E4 core).
8. **Governance blind spots** — no version diff, edit-while-running clarity, export/import, per-definition perms, definition audit UI (≈9: E10).
9. **Zero AI-assisted authoring** — no generate-from-prompt, no suggestions, no MCP authoring tool, despite OM shipping an AI framework (8: all E11).
10. **Silent/under-surfaced validation** — silent save drops, first-error-only toast, no node badges/problems panel, interpolation typos pass through (≈7 explicit: E1-08/09, E8-12, E2-09, E3-11 — but amplifies every other theme).

### 3b. GAP stories not covered by any backlog issue (the gold)

Highest-impact GAP clusters (⭐ = flagged in the tables):
- **Schema-driven activity registry & forms** — E3-08 ⭐, E3-01 ⭐ (UPDATE_ENTITY command picker), E3-14 ⭐ (custom activity registration), E3-03/04/07/09/10/12/13.
- **Flow-logic primitives** — E4-01 ⭐ (if/else gateway), E4-07 ⭐ (loops), E4-08 ⭐ (error branches), E4-02/06/09/10/11/13.
- **Agent-step contract** — E7-04 ⭐ (outcome edges), E7-05 ⭐ (guardrail branch), E7-02 ⭐ (typed input), E7-06/07/08/11/12/15, E2-15.
- **Debuggability** — E8-03 ⭐ (dry-run), E8-05 ⭐ (rerun-from-step), E8-04/06/07/08/09/10/11/13/14, E2-08 (pinned data).
- **Authoring ergonomics** — E1-01/04/05/10/11/12/13/15/16/17, E2-07 (Set variable), E2-14 (transforms), E5-11 ⭐ (approval preset), E5-12.
- **AI authoring** — E11-01 ⭐, E11-05 ⭐, E11-02/03/04/06/07/08.
- **Governance/ops** — E10-02/03/04/07/09/10/11/12, E12-01/02/03/04/06/07/09/10, E9-04 (cron), E9-06 (webhook trigger), E9-11 (reverse lookup), E9-12 (integration activities), E6-11/12.

### 3c. Backlog-issue impact (stories unblocked per issue)

| Issue | Ref | Stories unblocked | Verdict |
|-------|-----|-------------------|---------|
| #4245 | C2 explicit/computed context | 16 (all E2 core, E5-03, E7-03/09/14, E8-02, E9-03/05) | **Highest leverage — the keystone** |
| #4241 | B3 deadline/escalation | 6 (E5-04/05/06, E6-04, E7-13, E12-05) | High — human + agent SLAs |
| #4246 | C3 generic Task | 6 (E5-08, E6-01/02/09/13, E12-05) | High — unifies 3 surfaces |
| #4232 | A4 validation surfacing | 4 (E1-08/09, E8-12, E2-09) | High — trust repair, cheap |
| #4242 | B4 task instructions/context | 4 (E5-07/08, E6-02/05) | High |
| #4230 | A2 typed API responses | 3 (E2-06/11, E9-10) | Prerequisite for #4235/#4245 |
| #4235 | A7 endpoint picker | 3 (E2-11, E3-02/05) | High |
| #4238 | A10 task-perm decoupling | 3 (E6-07/14, E10-06) | Medium-high |
| #4249 | C6 test runner | 3 (E8-01/02, E9-05) | Medium — nearly shipped |
| #4240 | B2 assignee dropdown+dynamic | 2 (E5-02/03) | Medium |
| #4236 | A8 inline BRs | 2 (E4-03/04) | Medium |
| #4243 | B5 form key | 2 (E5-09/10) | Medium |
| #4247 | C4 business-context perms | 2 (E6-08/14) | Medium — portal blocker |
| #4229 | A1 duration input | 2 (E3-06, E5-04) | Small, broad goodwill |
| #4248 | C5 layout | 2 (E1-06/07) | Largely shipped |
| #4233 | A5 reattach | 1 (E1-03) | Small |
| #4234 | A6 JSON paste lock | 1 (E3-11) | Small |
| #4237 | A9 retire form editor | 1 direct (E1-02) + unlocks budget for E1-13 code view | Strategic enabler |
| #4239 | B1 role dropdown | 1 (E5-01) | Small |
| #4231 | A3 default roles | 1 (E10-05) | Small |
| #4244 | C1 drag actions onto edges | 1 direct (E4-05), amplifies E3/E4 family | UX umbrella |
| #4250 | C7 spec audit | 0 direct (meta/process) | Hygiene |

**Bottom line:** the backlog is directionally right but covers only ~42% of validated needs. The four make-or-break investments the redesign must add on top of it: (1) schema-driven activity registry + forms (kills JSON authoring), (2) flow-logic primitives (if/else, loop, error branch, outcome edges), (3) the test/debug loop (dry-run, replay, live view), (4) the agent-step contract (typed I/O, outcome edges, guardrail routing) — with #4245's context schema as the foundation all four stand on.
