# What a model is given: withholding fields from model input

> **Program:** second part of package F1 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593). Split from [`2026-11-16-ai-data-protection.md`](2026-11-16-ai-data-protection.md) after its review.
> **Status: direction not settled.** The first design was judged false comfort by its reviewer. This spec records what the code allows, proposes the narrowest design that is honest, and asks whether it is worth building.
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run.
> **Written autonomously.** No question was put to a person.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md

## 📝 TLDR

Whatever an assistant tool returns — decrypted names, emails, notes — goes to the model provider whole. The program asked for "masking in tool results". A general mask does not survive contact with the code: results reach a model by at least four routes, key names are generic, and the place every tool passes through also serves people. **Proposed (future), if wanted at all:** a tenant may list fields that are never sent to a model; the list applies only to tools that declare which entities they return, at the point where a result is formatted for a model and nowhere else; everything it cannot cover is stated on the settings page. The alternative, set out below, is to build nothing here and rely on the provider policy and the tenant's choice of whether to use the assistant.

## 📝 Open question for a person

**Q1. Build the narrow control below, or record "no field-level control" as the program's position?**

| Option | What the controller gets | Cost |
|---|---|---|
| A. Narrow control | A list of fields that first-party tools will not hand to a model | A declaration on every first-party tool; a settings section; a filter with stated gaps |
| B. Nothing | The provider policy; the ability to switch the assistant off; documentation of what is sent | None |

Recommended: **B for now**, with A kept as a ready design. The reasons are the limits below: a control that covers some routes and is easy to misread as covering all of them can do more harm than a plain statement.

## 📝 Problem Statement

**Routes by which record data reaches a model**

| Route | Passes `executeTool` | Shape |
|---|---|---|
| Typed-agent tools | Yes; then formatted for the model at `ai_assistant/lib/agent-tools.ts:145-154, 319` | Objects, serialised whole, with no size limit |
| Code mode | Yes | A string already serialised and truncated (`codemode-tools.ts:645-657, 754-764`); a walk over keys sees nothing |
| Page-context hydration | No. Handlers are called directly and their output goes into the system prompt | `customers/ai-agents-context.ts:99`; `catalog/ai-agents-context.ts:120` |
| Search tools | Yes | `presenter.title` and `subtitle`, not field names (`ai-tools/search-pack.ts:279`) |
| Attachment file parts; inbox and warranty prompts | No | Free text and files |

**Why a filter in `executeTool` is the wrong place**

- It also serves people: the tools execute route (`api/tools/execute/route.ts:78`), stored tool-call rows and MCP clients. An authorised user would see the marker in place of data they may read.
- The two paths that call a handler without it do not send results to a model: a confirmed action returns a record id to the confirming user (`pending-action-executor.ts:114-123`), and the other is a diagnostic for super-administrators. Routing them through `executeTool` would also change how empty inputs and thrown errors are handled (`tool-executor.ts:13-21, 91-98`).

**Why key names are a weak handle**

- Encryption maps name fields `name`, `description`, `title`, `body`, `city`, `metadata` (`customers/encryption.ts:7-56`; `sales/encryption.ts:18`). Applied without knowing the entity, they would blank product names and schema descriptions.
- Custom fields are in no encryption map.
- A tool definition carries no entity (`lib/types.ts:46-54, 116-185`).

**What exists**

- The enterprise orchestrator has a masker for its context bundles, where the entity is known. It is flat, deletes keys, adds a pattern rule for personal data and returns an enterprise type (`agent_orchestrator/lib/context/redactor.ts:20-23, 111-140`). Only its helper for snake- and camel-case variants is reusable.
- Tenant AI settings are per-table rows read on every turn; there is no settings service or cache.

## 📝 Proposed Solution (option A)

1. **Tools declare what they return.** A tool definition gains `resultEntities`: the entity ids whose records appear in its result, and for each the path at which they appear. A tool that declares nothing is not filtered — and is listed on the settings page as "not covered".
2. **A tenant lists withheld fields**, as `entity:field`, chosen from the fields those tools actually return. The list is a column on the tenant's AI settings row.
3. **The filter runs where a result is formatted for a model** — `formatToolResult` in the typed-agent path, and the same function called by page-context hydration — and replaces the value at each declared path with a fixed marker. Results shown to people, stored rows and MCP clients are untouched.
4. **Code mode and search tools are not covered**, and the settings page says so in the same place as the list. A tenant that needs certainty turns code mode off for agents that touch personal data; that switch exists per agent.
5. **A size limit** on a formatted result goes in the same function.

### Known limits, shown beside the control

- Free text: a name inside a note is not a field.
- Code mode, search results, attachments and prompts built by other modules.
- Third-party tools that declare nothing.
- Anything a user types into the chat.

## 📝 Delta

### Capability: ai-model-input-minimisation

#### ADDED Requirement: Withheld fields
The system SHALL replace the value of a field a tenant has listed as withheld in the result of a tool that declares it returns that entity, before the result is given to a model, and SHALL leave the result unchanged for people.

##### Scenario: Withheld
- WHEN a tenant withholds a person's primary email and a people tool that declares its result returns a person to an agent
- THEN the model receives the marker in place of the email

##### Scenario: The same tool, called by a person
- WHEN an authorised user runs the same tool through the execute route
- THEN they see the email

##### Scenario: An undeclared tool
- WHEN a tool declares nothing
- THEN its result is unchanged, and the settings page lists it as not covered

##### Scenario: Another entity's field of the same name
- WHEN a customer field named `description` is withheld and a product tool returns a product
- THEN the product's description is not replaced

## 📝 Architecture

- `ai_assistant/lib/agent-tools.ts`: the filter and the size limit in the formatting function.
- `ai_assistant/lib/types.ts`: `resultEntities` on the tool definition.
- The two page-context builders in `customers` and `catalog`: call the same formatting function.
- The tenant AI settings entity, route and page: the list and the coverage table.
- First-party tool packs: declarations.

## 📝 Data Models

One JSON column on the tenant AI settings row, with a migration.

## 📝 API Contracts

- `resultEntities?: Array<{ entityId: string; path: string }>` on the tool definition. Additive.
- The AI settings route accepts and returns `withheldFields`, validated against what declared tools return.

## 📝 Implementation Plan (if option A is chosen)

1. Add `resultEntities`; declare it on the people, companies and deals tool packs. Unit tests that each declared path exists in a sample result.
2. The filter and size limit in the formatting function; the page-context builders call it. Unit tests: nothing listed; a listed field; nested and array paths; an undeclared tool; a same-named field of another entity.
3. The settings column, route and page, with the coverage table and the limits text.
4. Integration test: with a field withheld, a typed-agent turn against the test environment's stub provider records a model input containing the marker, and the execute route returns the value. The step confirms that the integration environment has a stub provider that records its input; if it has none, this stays a unit test and the section is corrected.
5. Declare the remaining first-party packs.

## 🧪 Integration Coverage

One test, described in step 4, conditional on a recording stub provider. Otherwise unit tests only, stated as a gap.

## 📝 Risks & Impact Review

#### The control is read as a guarantee
- **Scenario**: A controller withholds a field and assumes no model ever sees it.
- **Severity**: High
- **Affected area**: any tenant relying on the list
- **Mitigation**: The coverage table and limits beside the list; undeclared tools named.
- **Residual risk**: This is the reason option B is recommended.

#### The assistant becomes less useful
- **Scenario**: An administrator withholds names and the assistant cannot say who a customer is.
- **Severity**: Medium
- **Affected area**: that tenant
- **Mitigation**: Nothing is withheld by default.
- **Residual risk**: The administrator's choice.

#### Declarations go stale
- **Scenario**: A tool's result shape changes and its declared path no longer exists.
- **Severity**: Medium
- **Affected area**: that tool's coverage
- **Mitigation**: A unit test per pack checks each declared path against a sample result.
- **Residual risk**: Third-party packs.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `packages/ai-assistant/AGENTS.md` (through the review).

| Rule | Status | Notes |
|---|---|---|
| Open questions resolved before design | Not met | Q1 is open by design; the autonomous default is option B |
| Additive type change | Compliant | One optional field |
| Tenant scoping | Compliant | The list is per tenant |

**Verdict:** not approved. Waits for Q1.

## Changelog

### 2026-11-16
- Split from the AI data-protection spec after independent review. The first design filtered in the tool executor by key name. The review showed that the executor also serves people and stored rows, that code mode returns a string a key walk cannot see, that page-context hydration bypasses it, that search results carry titles not field names, and that field names such as `name` and `description` would blank unrelated data. This version filters only where a result is formatted for a model, only for tools that declare what they return, and puts the question of building it at all to a person.
