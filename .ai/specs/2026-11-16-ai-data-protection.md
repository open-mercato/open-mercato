# AI provider policy: the tenant's allow-list for every model call

> **Program:** first part of package F1 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593). The second part, what a model is given, is [`2026-11-16-ai-model-input-minimisation.md`](2026-11-16-ai-model-input-minimisation.md).
> **Touches files that PR #5557 also changes** — `tool-executor.ts`, `scoped-upload-service.ts`, `types.ts` in the assistant and attachments modules. That PR is implementation as well as specs; whichever lands second rebases.
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run. Whether the OpenAI SDK reads a base-URL variable on its own was not checked.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md

## 📝 TLDR

A tenant can say which model providers and models its chat agents may use. That list is advisory even there — when nothing on it is configured, the call goes ahead with a provider that is not on it — and it stops at the chat agents. Inbox extraction, warranty assistance, the legacy chat route, content moderation and attachment text extraction each pick a provider on their own. For attachments that means a hard-wired OpenAI client, behind a switch that also controls harmless local text extraction, so the two cannot be turned off separately. **Proposed (future):** one helper that every model call on a tenant's behalf goes through, which checks the resolved provider and model against that tenant's list and refuses when they are not on it; and a separate switch for sending files to a model, apart from local extraction.

**Not in this spec:** what a model is given once it is called (the sibling spec); embeddings, where the defect is that tenant settings are saved and then read without a tenant — that belongs with the search-settings specs and is noted below; what a provider does with the data.

## 📝 Overview

> **Market reference.** Microsoft's and Google's administrator controls for their assistants both start from the same thing: an organization-level list of which AI services may process the organization's data, enforced for every feature, with features that are not permitted switched off and saying so. Adopted: one list, enforced everywhere, failing visibly. Rejected: a per-feature provider setting, which is what the product has drifted into.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | What a tenant's list constrains | The provider and the model of every call made for that tenant. It does not choose them | Applying a tenant's chat model to vision extraction or structured extraction would break both. Each feature keeps its own model choice; the list says whether that choice is permitted. |
| 2 | When the choice is not permitted | The call is refused, with an error that names the policy | ⚠ NEEDS HUMAN CONFIRMATION. The factory's stated rule today is never to throw: it swaps to a permitted provider, and if none is configured it proceeds with the forbidden one. Refusing is a behaviour change, and the assistant's guide lists the factory's resolution as something to ask about first. |
| 3 | Chat agents | Get the same check, behind a tenant setting that is off by default for one minor | Otherwise the list would be strict for inbox extraction and advisory for chat. |
| 4 | When the list cannot be loaded | Refuse | ⚠ NEEDS HUMAN CONFIRMATION. The existing loaders fail open. A policy that disappears when the database hiccups is not a policy. |
| 5 | Module-level environment overrides | Still apply, when the result is on the tenant's list | An operator's choice of model for a feature should not silently override a tenant's restriction. |
| 6 | Sending files to a model | A switch of its own per attachment partition, off for partitions created after the change. Existing partitions keep what they have | ⚠ NEEDS HUMAN CONFIRMATION. The current switch is stored per partition and defaults to on; the environment variable only seeds new rows, so changing it would not stop anything on an existing installation. |
| 7 | "Region" | The endpoint address. No region field | The product cannot verify where a vendor processes. |

## 📝 Problem Statement

**How a provider is chosen today**

| Call | Tenant's list applied | Evidence |
|---|---|---|
| Typed chat agents | Yes, but advisory | `ai_assistant/lib/model-factory.ts:761-768` ("never throw"), `:894-897` (keeps the disallowed provider when no allowed one is configured); `model-allowlist.ts:390` |
| Inbox extraction and translation | No. Built in a throwaway container with no tenant; the module's environment model is passed as a caller override, which outranks a tenant's | `inbox_ops/lib/llmProvider.ts:140-146, 205`; `extractionWorker.ts:184`; `model-factory.ts:689-696` |
| Warranty assistance, the enterprise judge and native runner | No | `warranty_claims/lib/aiAssist.ts:366`; `agent_orchestrator/lib/eval/llmJudge.ts:40-55` |
| Legacy `POST /api/chat` | No. Its own provider through OpenCode | `ai_assistant/lib/opencode-handlers.ts:175` |
| Content moderation | No. A direct request to `api.openai.com` | `ai_assistant/lib/moderation.ts:20, 110` |
| Legacy structured-model helper, still exported | No | `inbox_ops/lib/llmProvider.ts:82-101` |
| Attachment text extraction by model | No. A client built from `OPENAI_API_KEY`; model options are hard-coded OpenAI ids; the partition lookup ignores the tenant | `attachments/lib/ocrService.ts:75-88`; `ocrQueue.ts:71, 81-85` |

- **The tenant's records.** An override row is matched on tenant, organization — null included — and agent id, not module (`AiAgentRuntimeOverrideRepository.ts:74-100`). The loaders are private functions that take an entity manager and return nothing on error (`agent-runtime.ts:1171-1194, 1343-1382`).
- **One switch, two things.** `requiresOcr` is a column on the attachment partition, seeded and shown as on (`attachments/data/entities.ts:35-36`; `partitions.ts:55`; `AttachmentPartitionSettings.tsx:63, 121`). It gates extraction by a model *and* local, non-model text extraction (`scoped-upload-service.ts:212-225`). `OM_DEFAULT_ATTACHMENT_OCR_ENABLED` only seeds new partitions.
- **Core already depends on the assistant package** (`packages/core/package.json:269`), so a core module may import a helper from it.
- **Embeddings, noted and left.** Tenant-scoped settings are saved, and three readers resolve them with no tenant (`packages/search/src/modules/search/workers/vector-index.worker.ts:228, 344`; `api/search/route.ts:104`); a save also pushes the tenant's configuration into a process-wide singleton (`embeddings/route.ts:344`). Two earlier specs made the route tenant-scoped on purpose after one tenant overwrote another's settings. The fix is to pass the tenant in those readers, in the search-settings work, not here.

## 📝 Proposed Solution

### The helper

`resolveTenantModel`, exported by the assistant package. It takes the container, a module id, a tenant, an organization, and the feature's own requested provider and model. It:

1. loads the tenant's allow-list, falling back from the organization's row to the tenant's;
2. asks the existing factory to resolve, passing the feature's request and any module environment override;
3. checks the resolved provider, model and endpoint against the list;
4. returns the model, or refuses with `ai_provider_not_permitted`.

It does not apply a tenant's agent override to a module call. A call with no tenant — a system job — must say so explicitly and gets the installation's defaults.

### Who uses it

Inbox extraction and translation, warranty assistance, the enterprise judge and runner, the legacy chat route, moderation and attachment extraction. The legacy structured-model helper is removed from the module's exports after its deprecation window. Chat agents keep their path and gain the same final check when the tenant's "enforce" setting is on.

### The guard

A test lists every construction of a provider client and every direct request to a model provider under `packages/*/src`, and fails on one that is not in its short list of permitted places: the provider adapters, the factory, the embedding service.

### Attachments

- The partition gains a second switch, "send files to a model for text extraction". Local extraction keeps the existing one.
- For existing partitions the new switch is set to what the old one is, so nothing changes on upgrade. For partitions created afterwards it is off.
- Extraction by model resolves through the helper with the tenant from the extraction event, and the settings page names the provider and endpoint that will receive files.
- When it is refused or off, the file is stored, local extraction still runs, and the attachment records why no model was used.

### Design decisions

| Decision | Rationale |
|---|---|
| The list constrains; it does not choose | See assumption 1. |
| A check after resolution, in the helper | The factory's "never throw" stays as it is for anyone calling it directly; the policy is in one new place. |
| Refuse, and say why | A silent swap to another vendor is the thing a controller's list exists to prevent. |
| Two switches for attachments | Turning off a model must not turn off search inside files. |
| Existing partitions keep their value | A default that only seeds new rows cannot stop anything; changing stored rows would be a silent behaviour change. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Make the factory throw | Changes every existing caller's contract at once. |
| Apply the tenant's agent override to every feature | See assumption 1. |
| Turn the existing attachment switch off by default | Stops local extraction too, and does nothing for existing partitions. |
| Save embedding settings installation-wide | Reintroduces a cross-tenant overwrite that two earlier specs fixed. |
| A "region" setting | See assumption 7. |

## 📝 Delta

### Capability: ai-provider-policy

#### MODIFIED Requirement: Provider selection for model calls
The system SHALL check the provider, model and endpoint of every model call made on a tenant's behalf against that tenant's allow-list, and SHALL refuse a call that is not permitted.

##### Scenario: Inbox extraction, permitted
- WHEN the feature's model is on the tenant's list
- THEN the extraction runs with it

##### Scenario: Not permitted
- WHEN the resolved provider is not on the tenant's list
- THEN the call fails with an error that names the policy, and no provider is called

##### Scenario: Nothing on the list is configured
- WHEN the tenant allows only a provider this installation has no key for
- THEN the call is refused, where today it proceeds with a provider that is not on the list

##### Scenario: No list
- WHEN the tenant has no allow-list
- THEN the call runs as it does today

##### Scenario: The list cannot be read
- WHEN loading the tenant's list fails
- THEN the call is refused

Frozen by: `packages/core/src/modules/inbox_ops/lib/__tests__/llm-provider-resolution.characterization.test.ts`, `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/model-factory-allowlist.characterization.test.ts`

#### MODIFIED Requirement: Attachment text extraction
The system SHALL send a file to a model for text extraction only when the partition's model-extraction switch is on and the tenant's list permits the provider, and SHALL run local extraction independently of both.

##### Scenario: Model extraction off
- WHEN the model switch is off and local extraction is on
- THEN the file's text is extracted locally and nothing is sent to a model provider

##### Scenario: Upgrade
- WHEN an installation with an existing partition is upgraded
- THEN that partition behaves as it did

Frozen by: `packages/core/src/modules/attachments/lib/__tests__/ocr-config.test.ts`

## 📝 Architecture

- **`ai_assistant/lib/tenant-model.ts`**: the helper. It uses the existing loaders, made callable with an entity manager from the given container.
- **Callers** in `inbox_ops`, `warranty_claims`, `attachments`, the assistant's own legacy route and moderation, and enterprise `agent_orchestrator`: their signatures gain a tenant where they have none — for inbox, through the translation provider, the tools and the extraction worker.
- **`attachments`**: the new column, the settings page, the queue's use of the event's tenant.
- **Guard**: `packages/ai-assistant/src/__tests__/model-egress-guard.test.ts`.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| A module → a model | `resolveTenantModel` | The assistant package not installed: the module's AI feature is unavailable, as today |
| Helper → tenant's list | The assistant's repositories | No row: no restriction |
| PR #5557's hardened profile | Independent; it changes how a call is made, not which provider | — |

## 📝 Data Models

| Table | Change |
|---|---|
| The attachment partition | A boolean for model extraction, backfilled from the existing switch; new rows default to false |
| The tenant's AI settings | An "enforce the allow-list for chat agents" boolean, default false |

Additive, with migrations and snapshots.

## 📝 API Contracts

- **`resolveTenantModel({ container, moduleId, tenantId, organizationId, provider?, model? })`** — new, exported from the assistant package.
- **Error** `ai_provider_not_permitted`, with the tenant and module and no content.
- **Partition API and settings** gain the model-extraction switch; the AI settings route gains the enforce flag.
- **`OM_DEFAULT_ATTACHMENT_OCR_ENABLED`** keeps its meaning for local extraction. A new `OM_DEFAULT_ATTACHMENT_MODEL_EXTRACTION_ENABLED`, default false, seeds the new switch. Both `.env.example` files.
- **`createStructuredModel`** in `inbox_ops` is marked deprecated and removed after one minor.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| A tenant's list permits the provider but not the feature's model | Refused; the error names the model |
| An organization has its own list | It is used; otherwise the tenant's |
| A module environment override that the list forbids | Refused; the error says the operator's setting conflicts with the tenant's list |
| A call with no tenant | Must be marked as a system call; uses the installation's defaults |
| Moderation refused | The request it guards is handled as moderation unavailable is handled today |
| A file uploaded while model extraction is refused | Stored; local extraction runs; the attachment says no model was used and why |
| A tenant endpoint not on the operator's endpoint allow-list | Refused when saved, as today |

## 📝 Migration & Backward Compatibility

| Change | Route |
|---|---|
| The list is enforced for non-chat features | A tenant with an allow-list sees inbox, warranty, moderation and extraction refuse where they are not permitted. Called out in the upgrade note, with the list of features |
| The list is enforced for chat | Behind the tenant setting, off for one minor |
| A second attachment switch | Additive; backfilled, so no behaviour change on upgrade |
| New partitions do not send files to a model | Dated entry |
| The legacy helper | Deprecation protocol |

## 📋 Phasing

| Phase | Outcome | Ships alone |
|---|---|---|
| 1 | The helper, the guard, non-chat callers moved to it | Yes |
| 2 | The attachment switch and extraction through the helper | Yes, after Phase 1 |
| 3 | Enforcement for chat agents | Yes, after Phase 1 |

## 📋 Implementation Plan

### Phase 1
1. **Characterize** two things: inbox extraction ignores a tenant's list; and the factory proceeds with a disallowed provider when no allowed one is configured. Commit alone.
2. Add `resolveTenantModel` with unit tests: permitted; provider not permitted; model not permitted; nothing configured; no list; list unreadable; organization row; environment override in conflict; system call.
3. Move inbox, warranty, the legacy chat route, moderation and the enterprise callers to it, threading the tenant through. Update the inbox characterization test.
4. Add the guard with its permitted list.
5. `UPGRADE_NOTES.md` with the features that now follow the list.

### Phase 2
1. The partition column, its backfill migration, the settings page text and switch. Unit tests for the backfill.
2. Extraction by model through the helper, using the event's tenant; local extraction untouched. Unit tests for each combination of the two switches.
3. Both `.env.example` files; the dated entry.

### Phase 3
1. The enforce flag in tenant AI settings; the final check on the chat path. Update the factory characterization test's expectation for the flag on. Unit tests.
2. Integration test TC-AI-POLICY-001; the assistant docs page; the tracking issue for making enforcement the default.
3. Archive this Delta into `.ai/specs/capabilities/ai-provider-policy.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/ai-assistant/src/modules/ai_assistant/lib/{tenant-model.ts,agent-runtime.ts,opencode-handlers.ts,moderation.ts}`, `api/settings/route.ts`, migrations | Create / modify |
| `packages/core/src/modules/inbox_ops/lib/{llmProvider.ts,translationProvider.ts,extractionWorker.ts}`, `ai-tools.ts` | Modify |
| `packages/core/src/modules/warranty_claims/lib/aiAssist.ts`; `packages/enterprise/src/modules/agent_orchestrator/lib/{eval/llmJudge.ts,runtime/nativeAgentRunner.ts}` | Modify |
| `packages/core/src/modules/attachments/{data/entities.ts,migrations/*,lib/ocrService.ts,lib/ocrQueue.ts,lib/partitions.ts,components/AttachmentPartitionSettings.tsx}` | Modify |
| `packages/ai-assistant/src/__tests__/model-egress-guard.test.ts` | Create |
| `packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-POLICY-001.spec.ts` | Create |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-AI-POLICY-001 | No model provider is needed, because the outcome under test is a refusal. A tenant's allow-list is set through the AI settings route to a provider the test environment has no key for. An attachment is uploaded to a partition with model extraction on: it is stored, and its record says no model was used because of the policy. The partition API shows the two switches separately. The list is cleared and the upload removed |

Permitted paths are unit-tested with a fake provider: the integration environment has none.

## 📝 Risks & Impact Review

#### A tenant's AI features stop on upgrade
- **Scenario**: A tenant allowed one provider for chat; inbox extraction used the installation default, which is not on the list.
- **Severity**: High
- **Affected area**: inbox, warranty, moderation, extraction for tenants that have a list
- **Mitigation**: The error names the policy and the feature; the upgrade note lists the features; the settings page shows which features would be refused under the current list.
- **Residual risk**: A tenant surprised on upgrade. That is the intended change, and why assumption 2 is marked.

#### Refusing when the list cannot be read
- **Scenario**: A database problem makes every AI feature fail for a moment.
- **Severity**: Medium
- **Affected area**: all tenants during an incident
- **Mitigation**: Only the list's load is fail-closed; the error is distinct; assumption 4 is marked.
- **Residual risk**: AI features are less available than the rest of the product during a database incident.

#### A call path is missed
- **Scenario**: A new feature builds a provider client directly.
- **Severity**: High
- **Affected area**: that feature's tenants
- **Mitigation**: The guard fails on any construction outside its permitted list.
- **Residual risk**: A provider reached through plain HTTP in a way the guard's patterns do not recognise.

#### Conflict with PR #5557
- **Scenario**: Both change the same files.
- **Severity**: Low
- **Affected area**: the second to land
- **Mitigation**: Named in the header; the changes are in different functions.
- **Residual risk**: A rebase.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `packages/ai-assistant/AGENTS.md` (through the research and the review), `BACKWARD_COMPATIBILITY.md`.

| Rule | Status | Notes |
|---|---|---|
| Ask before changing the model factory's resolution | Needs approval | The factory is unchanged; a check is added after it. Assumption 2 |
| Behaviour-changing default follows the protocol | Compliant | Chat enforcement behind a setting for one minor |
| Additive schema | Compliant | Two booleans |
| Tenant scoping | Compliant | The helper takes a tenant; a caller without one must say so |
| Ask before touching multiple modules | Needs approval | Five modules |
| Integration coverage | Partly | The refusal is covered; permitted paths are unit-tested |

**Verdict:** design ready; not approved until assumptions 2 and 4 are answered.

## Changelog

### 2026-11-16
- Written autonomously as "AI data protection", covering provider policy, text extraction, embeddings and a filter on tool results.
- Rewritten after independent review, and narrowed. The allow-list never refuses today, so "refuse" is now an explicit check after the factory and a marked behaviour change. The tenant's list constrains each feature's own model instead of replacing it. The attachment change is a second switch, because the existing one is a stored per-partition value that also gates local extraction, and its environment default only seeds new rows. Saving embedding settings installation-wide is dropped: it would have reintroduced a cross-tenant overwrite fixed by two earlier specs. The legacy chat route, moderation and a legacy helper were missing from the inventory and are added. The tool-result filter moved to its own spec.
