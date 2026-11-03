# Attachment Owner Access on Direct Attachment Readers

**Status**: Draft
**Created**: 2026-11-03
**Issue**: [#6282](https://github.com/open-mercato/open-mercato/issues/6282) (first consumer: `2026-10-25-inbox-ops-inbound-attachments.md`)
**Implementation PR**: [#7989](https://github.com/open-mercato/open-mercato/pull/7989)
**Modules**: `attachments` (row-level helper, unguarded-reader declarations), `ai_assistant`, `catalog`, `messages` (owner access enforcement on their direct reads)
**Builds on**: `2026-10-01-attachment-access-resolvers.md`, implemented by [#6829](https://github.com/open-mercato/open-mercato/pull/6829) (merged as `66ee9694f`)
**Related specs**: `2026-10-25-inbox-ops-inbound-attachments.md` (consumer of the unguarded-reader check), `enterprise/agent-orchestrator/next/2026-06-26-agent-attachments-and-artifacts.md` (enterprise attachment staging)

## TLDR

**Key Points:**
- #6829 applies owner access resolvers to the attachment routes (`/api/attachments`, library, file, image, transfer). Several code paths outside those routes still load attachment rows by caller-supplied id and check only tenant and organization, so they bypass a protected owner's policy, for example a Documents file the caller may not open.
- This spec closes those paths in OSS with one row-level helper that evaluates #6829's resolvers for the real principal, and lets owner modules detect enabled modules whose direct readers do not enforce owner access yet.
- It protects every protected owner, Documents included, and is useful without any other feature.

**Scope:**
- Phase 1: the row-level helper `evaluateAttachmentRowAccess` and owner access evaluation on every OSS direct reader found by the audit below.
- Phase 2: unguarded-reader declarations, so an owner module can keep sensitive files out of builds whose direct readers bypass owner access.
- Not in scope: the enterprise `agent_orchestrator` attachment stager, which enterprise maintainers fix on their own schedule (see Enterprise follow-up). Until they do, Phase 2 reports it as an unguarded reader.

**Concerns:**
- A security tightening of STABLE behavior for protected owners: it needs a dated `BACKWARD_COMPATIBILITY.md` entry and a named human-maintainer acknowledgment, like #6829's Documents tightening.

## Overview

#6829 lets a module declare an owner access resolver for its attachments (`data/attachment-access.ts`) and protects the matching partitions with stored requirements, so the attachment routes evaluate `read`, `render`, `metadata`, `reassign`, `delete` and `export` against the owning record. Its final contract (`attachments/lib/access-types.ts`) is:

- `AttachmentAccessAction = 'read' | 'render' | 'metadata' | 'reassign' | 'delete' | 'export'` (no `create` action);
- `evaluateAttachmentAccess` and `createAttachmentAccessContext` in `lib/access-runner.ts`, used by the routes through `assertAttachmentOwnerAccess` and `scanAuthorizedAttachments` (`prepareAttachmentMutation` runs only the route mutation guards);
- no row-level helper for code outside the attachments module, and no library-listing flag on protected targets.

This spec adds the row-level entry point those routes lack, applies it wherever rows are read or moved directly, and gives owner modules a way to see which enabled modules still read rows without it.

## Problem Statement

Verified on `main` (`71cf6e269`). Outside the attachments module, these paths read or move attachment rows by caller-supplied id with only tenant and organization checks:

| Path | Reads by caller-supplied id? | Action in this spec |
|------|------------------------------|---------------------|
| `ai_assistant/ai-tools/attachments-pack.ts` (`list_record_attachments`, `read_attachment`, `transfer_record_attachments`) | Yes | Evaluate `metadata`/`read`/`reassign` |
| `ai_assistant/lib/attachment-parts.ts` (chat `attachmentIds`, agent runtime; reused by `warranty_claims/lib/aiAssist.ts`) | Yes | Evaluate `read` before bytes or text reach the model |
| `ai_assistant/lib/pending-action-recheck.ts` | Yes | Evaluate `read` |
| `catalog/ai-tools/authoring-pack.ts` `loadUserMedia()` (tool `catalog.draft_description_from_media`, `userUploadedAttachmentIds`) | Yes | Evaluate `metadata`; drop denied ids |
| `messages/lib/attachments.ts` `linkAttachmentsToMessage`, `messages/commands/attachments.ts` link path | Yes | Evaluate `reassign` |
| `messages/lib/attachments.ts` `linkLibraryAttachmentsToMessage` | Yes — re-parents `attachments:library` rows selected by a caller-supplied `sourceRecordId`, which may carry other owners' assignments | Evaluate `reassign` |
| `messages/commands/shared.ts`, `messages/commands/attachments.ts` undo paths | Only ids previously linked through the guarded path | None |
| `messages/lib/attachments.ts` `copyAttachmentsForForwardMessages`; `messages/api/route.ts` counts | No — filtered to message-owned rows | None |
| `ai_assistant/api/ai/run-object` | Through `attachment-parts.ts` | Covered by that row |
| Other `catalog/*` readers, `ecommerce/*`, `forms/api/[id]/theme-logo`, `eudr/*`, `sync-akeneo`, warranty portal, `staff` portal support-ticket attachments (`api/portal/support-tickets/[id]/attachments`, `lib/support/portalAttachments.ts`), `documents/commands/attachments.ts` | No — filtered to their own owner entity or record | None |
| `sync_excel/api/import` and other `sync_excel/*` readers | No — read the server-held `attachmentId` of the import's own upload preview | None |
| Enterprise `agent_orchestrator/lib/runtime/attachmentStager.ts` | Yes | Enterprise follow-up; reported as unguarded by Phase 2 |

Readers marked "None" select rows by their primary `entity_id`, or, like `sync_excel`, by an id the server stored for its own record, so they never return a row whose primary owner is protected. A row whose primary owner is unprotected but which also carries an assignment to a protected record stays protected on the attachment routes only; its file is already visible to its primary owner's audience.

A user with `attachments.view` or AI-assistant access can therefore read a Documents file they may not open, or its extracted text, through an AI tool or a chat turn, or move it onto a message they own.

## Proposed Solution

### Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **One row-level helper** `evaluateAttachmentRowAccess` in the attachments module, built on #6829's `evaluateAttachmentAccess`, is the only way code outside the attachment routes decides owner access. | One evaluation path for routes and direct readers; resolvers, stored requirements and timeouts behave identically everywhere. |
| D2 | **The real principal is evaluated**: a user session as the user; a call authenticated by an API key as the key (`sub = 'api_key:<keyId>'`, `keyId`, `isApiKey: true`; owner resolvers such as Documents refuse a key principal without a matching `keyId`), never as the key's creator; a session-bound key (the AI chat's MCP credential) as the key together with the user it acts for (`userId`), once that user is verified as API-key authentication verifies it. | #6829 recomputes features from `auth.sub` through `rbacService`; evaluating the creator would let a narrow key read what only its creator may read. A session key already acts for its user everywhere else (shared API-key auth sets `userId`, `rbacService` intersects its grants with that user's), so its user keeps their own files and user-level shares in the chat. |
| D3 | **Transfers and links evaluate the destination too.** `reassign` is evaluated on the current owner and on the row as it would look after the move (`destination`, with `moveAssignments` rewriting assignments that point at the source record, as #6829's transfer route does). | Moving a file into a protected record must not bypass that record's policy. |
| D4 | **Fail closed.** A caller without a principal, an invalid registry or unparsable stored requirements deny protected rows; a Messages link with any denied attachment fails as a whole. | Partial links and silent fallbacks would hide which files were refused. |
| D5 | **Unprotected owners keep today's behavior.** Rows whose owner declares no policy are always allowed without loading a resolver. | The tightening affects protected owners only. |
| D6 | **Owner modules can detect unguarded direct readers.** The attachments module keeps a list of module ids known to read attachment rows directly outside this helper; a listed module stops counting as unguarded once it declares that it enforces owner access. | OSS cannot change or inspect enterprise code. An owner module whose files must never reach an unguarded reader (inbound mail) can stay off until the reader is fixed, instead of blocking its own merge on an unowned enterprise change. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Relying on #6829's route guards alone | The AI tools, AI chat attachments, the pending-action recheck, the catalog media tool and Messages linking would keep bypassing every protected owner. |
| A resolver check inside each caller without a shared helper | Five copies of partition loading, principal building and destination handling would drift from the routes. |
| Evaluating key-authenticated calls as the key's creator | Lets a restricted key read files that only its creator may read. |
| Making the enterprise stager change a precondition of OSS consumers | Nobody owns that change; owner modules would stay blocked indefinitely. D6 keeps them safe without it. |
| Detecting unguarded readers by scanning code or imports at runtime | Unreliable and impossible for compiled enterprise packages; an explicit list and declaration are auditable. |

## User Stories / Use Cases

- A **user without access to a Documents file** cannot read it, list it or ask the AI assistant about it through any tool or chat turn, and cannot attach it to a message.
- An **API key** used by an MCP client reads protected files only when the key's own roles grant access, whatever its creator may read.
- A **user in the AI chat** reads, through the chat's session key, the protected files they may open themselves (their own documents and files shared with them), within the key's roles.
- An **owner module** with sensitive files (inbound email attachments) keeps ingesting nothing while an enabled module still reads attachment rows without owner checks.

## Architecture

### Row-level helper (`attachments/lib/access-rows.ts`)

`evaluateAttachmentRowAccess({ container?, em?, auth, rows, action, destination?, context? })` → `{ allowed, denied }`:
- callers pass the rows they already loaded;
- it loads the rows' partitions and decides with a new internal `requiresAttachmentOwnerAccess` (the row-level counterpart of the partition-level `requiresAttachmentAccessScan`) whether a row needs evaluation (stored requirements, declared protected targets, or a resolver matching the row's targets and action);
- it calls `evaluateAttachmentAccess` for protected rows, with a context from `createAttachmentAccessContext(container)` unless the caller passes one;
- with `destination: { entityId, recordId, moveAssignments? }` for `reassign`, it also evaluates the row as it would look after the move;
- rows of owners without a policy are always allowed.

`buildAttachmentAccessAuth(principal)` builds the `AuthContext` for D2 from `{ tenantId, organizationId, userId?, apiKeyId?, apiKeyUserId?, isSuperAdmin? }`, returning `null` when neither a user nor a key is known. A key principal carries `sub = 'api_key:<apiKeyId>'`, `keyId = apiKeyId` and `isApiKey: true`, plus `userId = apiKeyUserId` for a verified session key. A `userId` that is itself an authenticated `api_key:<id>` subject (the AI routes pass `auth.sub`) is read as that key.

### Callers

- **AI tools** (`attachments-pack.ts`): `list_record_attachments` and `read_attachment` omit, or report as not found, rows the caller may not read; `transfer_record_attachments` leaves rows the caller may not see in place, as if absent, and refuses the request when any visible row may not be reassigned, including into a protected destination.
- **AI chat attachments** (`attachment-parts.ts`, through `ai_assistant/lib/attachment-owner-access.ts` `filterAttachmentRowsByOwnerAccess`): protected rows the caller may not read are dropped before bytes or text reach the model; when the evaluation itself fails, every attachment of the turn is dropped and the error is reported.
- **Pending-action recheck**: a protected attachment the caller may not read rejects the confirmation with 403 and the recheck code `attachment_access_denied`.
- **Catalog media tool**: denied `userUploadedAttachmentIds` are dropped.
- **Messages linking**: `linkAttachmentsToMessage` and `linkLibraryAttachmentsToMessage` gain an optional last parameter `access: { auth, container }`; the command context supplies it through `resolveAttachmentLinkAccess(ctx)` (`messages/lib/attachmentLinkAccess.ts`) at its call sites in `commands/messages.ts` and `commands/attachments.ts`. A denied attachment refuses the whole request with 403 (`messages.errors.attachmentAccessDenied`). Without `access`, protected attachments are refused.
- **Tool principals**: `McpToolContext`, `CatalogToolContext` and the AI chat and pending-action contexts gain an optional `apiKeyId` and `apiKeyUserId`. `resolveVerifiedSessionKeyUserId(em, key)` (`api_keys/services/sessionKeyRoles.ts`) returns the user of a session-bound key after the checks API-key authentication applies (not deleted, confirmed, same tenant and organization as the key), and `null` for a regular key or a user that fails them. The MCP servers and the in-process MCP client (`http-server.ts` session and header contexts, `authenticateMcpRequest` for `mcp-server.ts`, `mcp-dev-server.ts` and `in-process-client.ts`) call it on the key they authenticated; the AI routes (`api/tools/execute`, `ai/chat`, `ai/run-object`, `ai/actions/[id]/confirm`, and `warranty_claims` `api/ai/assess`) call it through `ai_assistant/lib/api-key-principal.ts`, which loads the request's key by `auth.keyId`. A regular key is evaluated without a backing user, so access that only its creator's ownership or shares grant is refused on these paths (fail closed).

### Unguarded-reader declarations (`attachments/lib/access-readers.ts`, Phase 2)

- `KNOWN_DIRECT_ATTACHMENT_READER_MODULES`: module ids known to read attachment rows by caller-supplied id outside this helper. It starts with `agent_orchestrator`. Entries are string ids only; the attachments module imports nothing from them.
- **Declaration.** A module declares that its direct readers evaluate owner access through `evaluateAttachmentRowAccess` and send no protected row to `OcrService` by exporting `enforcesOwnerAccessOnDirectReads = true` from its `data/attachment-access.ts`. The attachments generator plugin (`attachments/generators.ts`) carries it into the module's registry entry as the optional `AttachmentAccessResolverEntry.enforcesOwnerAccessOnDirectReads`; its entry expression is the same for every module and narrows every field it reads from the namespace import (`Array.isArray(ns.attachmentAccessResolvers) ? ns.attachmentAccessResolvers : []`, likewise `protectedAttachmentTargets`, and `ns.enforcesOwnerAccessOnDirectReads === true`, with `ns = X as Record<string, unknown>`), so a convention file that exports only some of them, such as only the flag, typechecks and registers empty lists or `false`, and `registerAttachmentAccessResolvers` records it, so the declaration is available wherever resolvers are, with no DI or bootstrap ordering involved.
- `listUnguardedAttachmentReaders()`: the listed module ids that are enabled (`tryGetModules()` from `@open-mercato/shared/lib/modules/registry`) and have not declared. When modules are not registered (`tryGetModules()` returns `null`) or the access registry is invalid, every listed module counts as unguarded (fail closed). Owner modules call it before they store files that must not reach an unguarded reader; `inbox_ops` does so for inbound mail (`2026-10-25-inbox-ops-inbound-attachments.md`, D19).
- A module added to the list later is unguarded until it declares; removing an entry needs no declaration.

### Enterprise follow-up (not blocking OSS)

`packages/enterprise/src/modules/agent_orchestrator/lib/runtime/attachmentStager.ts` stages the `__files` envelope of an agent run by attachment id with tenant and organization checks only (`findOneWithDecryption`), and runs the OpenAI-only `OcrService` for an entry that asks for `ocrText` when `Attachment.content` is empty. The run input comes from `POST /api/agent_orchestrator/agents/[id]/run` and workflow `INVOKE_AGENT` steps, so it does not evaluate owner access for staged files of protected owners, Documents included.

The fix belongs to enterprise maintainers (external changes to `packages/enterprise` are blocked by `enterprise-contribution-guard.yml`) and is not scheduled; no `.ai/specs/enterprise/` spec covers it yet. Acceptance criteria this spec relies on:
- the stager evaluates `read` through `evaluateAttachmentRowAccess` for the run's acting principal (the user who started the run, or the workflow's execution principal) and fails the run on a denied row, as it does for a missing one;
- protected rows never go to `OcrService`;
- `agent_orchestrator/data/attachment-access.ts` exports `enforcesOwnerAccessOnDirectReads = true`.

No OSS change waits for it: until it lands, Phase 2 reports `agent_orchestrator` as unguarded in enterprise builds that enable it.

### Commands & Events

No new commands or events.

## Data Models

No schema change.

## API Contracts

No route, request or response shape changes. Behavior changes:
- `POST /api/ai_assistant/tools/execute`, the MCP servers and `POST /api/ai_assistant/ai/chat` deny protected attachments as described under Callers.
- Messages compose, reply, draft update and draft attachment linking answer 403 when any attachment may not be reassigned onto the message.

New exports from `@open-mercato/core/modules/attachments`: `evaluateAttachmentRowAccess`, `buildAttachmentAccessAuth` and their types (`AttachmentAccessPrincipal`, `AttachmentAccessDestination`, `EvaluateAttachmentRowAccessInput`, `EvaluateAttachmentRowAccessResult`); Phase 2 adds `listUnguardedAttachmentReaders` and `KNOWN_DIRECT_ATTACHMENT_READER_MODULES`.

## Internationalization (i18n)

- `messages.errors.attachmentAccessDenied` in all `messages` locales (en, pl, de, es, ko).
- The AI tools reuse "not found" outcomes and need no new key.

## UI/UX

No UI change. Messages compose shows the existing error flash with the new message.

## Migration & Backward Compatibility

| Surface | Change | Classification |
|---------|--------|----------------|
| Attachments exports | `evaluateAttachmentRowAccess`, `buildAttachmentAccessAuth`, their types; Phase 2 `listUnguardedAttachmentReaders`, `KNOWN_DIRECT_ATTACHMENT_READER_MODULES` | ADDITIVE |
| `data/attachment-access.ts` convention, `AttachmentAccessResolverEntry`, `attachment-access.generated.ts` | Optional export `enforcesOwnerAccessOnDirectReads`; optional entry field; generated entries carry it | ADDITIVE (auto-discovery convention gains an optional export; existing files unchanged) |
| Types | Optional `apiKeyId` on `McpToolContext` and `CatalogToolContext` | ADDITIVE |
| Function signatures | `linkAttachmentsToMessage`, `linkLibraryAttachmentsToMessage` gain an optional last `access` parameter | ADDITIVE parameter; callers without it can no longer link protected attachments |
| AI tool, AI chat, pending-action recheck, catalog media tool and Messages linking behavior | Deny protected attachments the caller may not access | BREAKING tightening of STABLE behavior for protected owners only, under the same Emergency Security Exception as #6829 |
| Events, routes, response fields, ACL and DI keys, schema, CLI, widget and notification IDs | No change | — |

The implementation PR adds the dated `BACKWARD_COMPATIBILITY.md` entry (qualifying condition: protected files reachable through AI tools, chat turns and Messages links), the `UPGRADE_NOTES.md` section (operator action: grant access to the key's role for API keys that must read protected files through AI tools; module authors: pass `access` to the Messages link functions, filter direct reads with the helper) and the `attachments/AGENTS.md` rule that direct readers use the helper. Merge requires the `security` label and a named human-maintainer acknowledgment of the tightening.

Rollback: the checks add no stored state; rolling back restores the previous behavior and reopens the bypass.

## Implementation Plan

Delivered by #7989 (Phases 1 and 2).

### Phase 1: Row-level helper and direct readers

1. `attachments`: `lib/access-rows.ts` with `evaluateAttachmentRowAccess` and `buildAttachmentAccessAuth` exported from the module index (`requiresAttachmentOwnerAccess` stays internal); `AGENTS.md` rule for direct readers. Unit tests (`lib/__tests__/access-rows.test.ts`): unprotected rows allowed without resolver calls; protected rows denied without a principal, with an invalid registry and with unparsable stored requirements; destination evaluated for `reassign`, with and without `moveAssignments`; key principals built as the key.
2. `ai_assistant`, `catalog`, `messages`: evaluation on every path of the audit table, `apiKeyId` in tool contexts, `access` threaded through the Messages command context. Unit tests:
   - protected rows omitted or refused for actors without access, including a caller without a principal;
   - an API key without the required feature refused even when its creator has it;
   - a session key evaluated with its verified user, and without it when verification fails; a regular key never carries one, on every entry point that authenticates a key;
   - a transfer into a protected destination refused;
   - linking library attachments that include a protected row refused as a whole;
   - access granted when allowed; unprotected rows unchanged;
   - a protected attachment id in a chat turn dropped before the model call.
3. `BACKWARD_COMPATIBILITY.md`, `UPGRADE_NOTES.md`. Integration tests:
   - `TC-AI-ATTACHMENT-OWNER-001`: through `tools/execute`, `attachments.read_attachment` of a Documents file answers `result.found === false` for a user who cannot view the document and `found: true` for one who can;
   - `TC-API-MSG-ATTACH-OWNER-001`: linking that file to a Messages draft is refused for the first user; a library upload (`entityId=attachments:library`, `recordId=R`) that also carries a `documents:document` assignment through the upload route's `assignments` field makes composing a message with `attachmentRecordId: R` refused as a whole with 403;
   - `TC-AI-ATTACHMENT-OWNER-002`: through `POST /api/ai_assistant/tools/execute` with `x-api-key`, `attachments.read_attachment` answers `found: false` for a key created with a role that lacks access to the document, although its creator can read the file, and `found: true` for a key whose role has access.
   - `TC-AI-ATTACHMENT-OWNER-003`: through `POST /api/ai_assistant/tools/execute`, `catalog.draft_description_from_media` (`isMutation: false`, no model call in its handler) drops the Documents file from `userUploadedAttachmentIds` for the first user and keeps it for the second.

   Reply calls the same link helpers (`linkAttachmentsToMessage`, `linkLibraryAttachmentsToMessage`) and draft update calls `linkAttachmentsToMessage`, each with the same `access` as compose and draft linking, so they are unit-tested on their commands. The pending-action recheck stays unit-tested, because a pending action is created only by a model's `prepareMutation` call in a chat turn, which needs an LLM key. The transfer into a protected destination stays unit-tested on the tool handler, because `tools/execute` refuses every `isMutation` tool before it runs and `attachments.transfer_record_attachments` is one. The chat path stays unit-tested because `POST /api/ai_assistant/ai/chat` stops at `provider_not_configured` without an LLM key; the MCP servers run the same tool handlers and principal builder as `tools/execute`, which the integration tests cover. Session keys stay unit-tested: their secret never leaves the server, so a test cannot authenticate with one, and the HTTP MCP server is a separate process outside the integration environment.

### Phase 2: Unguarded-reader declarations

1. `attachments`: `lib/access-readers.ts` and its exports; `enforcesOwnerAccessOnDirectReads` in `AttachmentAccessResolverEntry`, the generator plugin's entry expression and the registry. Unit tests: a listed module that is enabled and has not declared is reported; a declared or disabled one is not; unregistered modules or an invalid registry report every listed module; an unlisted module is never reported; the registered flag is `true` only for modules that export it, and the generated file typechecks for modules that do not, including a convention file that exports only the flag and registers empty resolvers.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/attachments/lib/access-rows.ts`, `lib/access-readers.ts`, `lib/access-types.ts`, `lib/access-registry.ts`, `generators.ts`, `index.ts`, `AGENTS.md` | Create / Modify | Helper, declarations, exports, rule |
| `packages/ai-assistant/src/modules/ai_assistant/ai-tools/attachments-pack.ts`, `lib/attachment-owner-access.ts`, `lib/attachment-parts.ts`, `lib/pending-action-recheck.ts`, `lib/pending-action-executor.ts`, `lib/prepare-mutation.ts`, `lib/api-key-principal.ts`, `lib/auth.ts`, `lib/in-process-client.ts`, `lib/types.ts`, `lib/http-server.ts`, `lib/mcp-server.ts`, `lib/mcp-dev-server.ts`, `api/tools/execute/route.ts`, `api/ai/chat/route.ts`, `api/ai/run-object/route.ts`, `api/ai/actions/[id]/confirm/route.ts` | Create / Modify | Owner access evaluation; key principal |
| `packages/core/src/modules/api_keys/services/sessionKeyRoles.ts` | Modify | Verified session-key user |
| `packages/core/src/modules/warranty_claims/ai-tools.ts`, `api/ai/assess/route.ts` | Modify | Key principal for the claim attachment check and chat attachments |
| `packages/core/src/modules/catalog/ai-tools/authoring-pack.ts`, `ai-tools/types.ts` | Modify | Owner access evaluation; key principal |
| `packages/core/src/modules/messages/lib/attachments.ts`, `lib/attachmentLinkAccess.ts`, `commands/messages.ts`, `commands/attachments.ts`, `i18n/*.json` | Create / Modify | Link checks and error message |
| `BACKWARD_COMPATIBILITY.md`, `UPGRADE_NOTES.md` | Modify | Tightening entry and upgrade notes |

### Testing Strategy

Unit tests cover the helper, every caller and the declarations. Integration tests create their own document, API keys (for `TC-AI-ATTACHMENT-OWNER-002`), product (for `TC-AI-ATTACHMENT-OWNER-003`, which also grants `catalog.products.view` to both users, because the tool answers `found: false` before loading media for an unknown product), roles and users in setup and delete them in teardown.

## Risks & Impact Review

#### Legitimate access refused for API keys
- **Scenario**: An MCP client whose regular key reaches a Documents file only through its creator's own share loses access through the AI tools.
- **Severity**: Medium
- **Affected area**: AI tools and chat for key-authenticated callers
- **Mitigation**: Documented in `UPGRADE_NOTES.md`; access granted to the key's role works on every path.
- **Residual risk**: Regular keys get no user-level shares on these paths; session keys keep their user's.

#### Third-party callers of the Messages link functions
- **Scenario**: Custom code calls `linkAttachmentsToMessage` without `access`.
- **Severity**: Low
- **Affected area**: Custom modules linking attachments
- **Mitigation**: Unprotected attachments still link; protected ones fail closed with 403; upgrade note explains the parameter.
- **Residual risk**: None beyond the documented tightening.

#### Enterprise staging still bypasses owner access
- **Scenario**: An enterprise build enables `agent_orchestrator`, whose stager reads protected rows by id.
- **Severity**: High
- **Affected area**: Documents files today; any protected owner
- **Mitigation**: The enterprise follow-up with its acceptance criteria; Phase 2 reports the module as unguarded, so owner modules such as `inbox_ops` keep sensitive files out until it declares.
- **Residual risk**: Documents files stay reachable through enterprise agent runs until the follow-up lands. Enterprise artifact promotion (`agent_orchestrator/commands/artifacts.ts`) also creates attachment rows under a caller-chosen owner, like the generic upload route; an owner check on create is outside this spec.

#### Future direct readers
- **Scenario**: New code reads attachment rows by id without the helper.
- **Severity**: Medium
- **Affected area**: Any protected owner
- **Mitigation**: `attachments/AGENTS.md` rule; code review; known enterprise readers are listed in `KNOWN_DIRECT_ATTACHMENT_READER_MODULES`.
- **Residual risk**: An unlisted reader is not detected automatically.

## Final Compliance Report — 2026-11-03

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/attachments/AGENTS.md`
- `packages/ai-assistant/AGENTS.md`
- `packages/core/src/modules/catalog/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Never expose cross-tenant data | Compliant | #6829's baseline scope check runs before resolvers |
| root AGENTS.md | Wildcard-aware feature checks in runtime helpers | Compliant | Resolvers receive features recomputed by `rbacService` |
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Helper works on rows the caller loaded |
| root AGENTS.md | No hard-coded user-facing strings | Compliant | `messages.errors.attachmentAccessDenied` |
| core AGENTS.md | Cross-module coupling through sanctioned mechanisms | Compliant | Callers import the attachments module's public exports; the reader list holds module ids only |
| attachments AGENTS.md | Every attachment read gated | Compliant | Every OSS direct reader of the audit table; enterprise stager tracked as unguarded |
| BACKWARD_COMPATIBILITY.md | Function signatures additive | Compliant | Optional parameter and fields |
| BACKWARD_COMPATIBILITY.md | Behavior tightening documented | Compliant | Dated entry, upgrade notes, named maintainer acknowledgment before merge |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Audit table matches callers and tests | Pass | One caller section and test per "Yes" row |
| Principal rules match the helper | Pass | `buildAttachmentAccessAuth` builds D2 principals |
| Enterprise dependency non-blocking | Pass | Phase 2 reports it; no OSS merge waits for it |

### Verdict

Ready for implementation, delivered by #7989. Merge requires the `security` label and the named maintainer acknowledgment of the tightening.

## Changelog

### 2026-11-03
- Split from `2026-10-25-inbox-ops-inbound-attachments.md` (its former Phase 0) and aligned with #6829 as merged; added unguarded-reader declarations so the enterprise stager fix no longer blocks OSS consumers.
