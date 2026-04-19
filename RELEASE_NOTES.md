# Release Notes - Open Mercato v0.4.4

**Date:** April 18, 2026

## Highlights

This release ships the **AI Framework Unification** — a single contract for agent-oriented surfaces across the platform, from tool registration to mutation approval. It implements the full [`2026-04-11-unified-ai-tooling-and-subagents`](.ai/specs/implemented/2026-04-11-unified-ai-tooling-and-subagents.md) spec (Phases 0–3) in one PR (#1593), delivered as 19 commit-sized Steps grouped by the spec's own Workstream A/B/C/D structure. OpenCode Code Mode (`/api/chat`, `/api/tools*`, `mcp:serve*`) is untouched — the new framework runs alongside it.

---

## ✨ Features

### 🧠 AI Agent Runtime
- `AiAgentDefinition` + `defineAiTool()` shipped in `@open-mercato/ai-assistant` with additive `ai-agents.generated.ts` alongside the existing `ai-tools.generated.ts`.
- `agent-registry.ts` + runtime policy gate (`requiredFeatures`, `allowedTools`, `readOnly`, attachment access, `executionMode`).
- New dispatcher route `POST /api/ai_assistant/ai/chat?agent=<module>.<agent>` with full `metadata` + `openApi`; coexists with OpenCode's `/api/chat`. *(@peter)*

### 🧰 AI SDK Helpers
- `createAiAgentTransport`, `resolveAiAgentTools`, `runAiAgentText`, and `runAiAgentObject` — any Vercel AI SDK consumer can talk to an Open Mercato agent without custom glue.
- Contract tests assert chat-mode / object-mode parity for shared policy checks. *(@peter)*

### 📎 Attachment Bridge
- `AiResolvedAttachmentPart` with `source: 'bytes' | 'signed-url' | 'text' | 'metadata-only'` plus `AiUiPart` and `AiChatRequestContext` prompt-composition primitives.
- Client upload adapter reuses the attachments API and returns `attachmentIds`; backend converts images, PDFs, text-like payloads, and metadata-only stubs into model-ready parts. *(@peter)*

### 🧩 Tool Packs (General, Customers, Catalog)
- General-purpose packs (`search.*`, `attachments.*`, `meta.*`) plus full customers (people, companies, deals, activities, tasks, addresses, tags, settings) and catalog (products, categories, variants, prices, offers, media, product configuration) surfaces.
- D18 catalog merchandising tools — `search_products`, `get_product_bundle`, `list_selected_products`, `get_product_media`, `get_attribute_schema`, `get_category_brief`, `list_price_kinds` — and AI-authoring tools (`draft_description_from_attributes`, `extract_attributes_from_description`, `draft_description_from_media`, `suggest_title_variants`, `suggest_price_adjustment`). *(@peter)*

### 🛍️ D18 Merchandising Demo
- `catalog.merchandising_assistant` runs end-to-end on `/backend/catalog/catalog/products` with selection-aware `pageContext`.
- Four named bulk-edit use cases flow through `bulk_update_products` with a single `[Confirm All]` approval card, per-record `catalog.product.updated` events, DataTable refresh via the DOM event bridge, and `partialSuccess` handling. *(@peter)*

### 🎛️ Playground + Settings UI
- `<AiChat>` component in `packages/ui/src/ai/AiChat.tsx` with upload adapter and a client-side UI-part registry (slots reserved for Phase 3 approval cards).
- `/backend/config/ai-assistant/playground` for agent testing (transcript + object-output + debug panel + page-context injection form).
- `/backend/config/ai-assistant/agents` for versioned prompt overrides and tool toggles; feature-gated `mutationPolicy` field for operators with `ai_assistant.settings.manage`. *(@peter)*

### 🛡️ Mutation Approval Gate (D16)
- New additive DB table `ai_pending_actions` (migration `Migration20260419134235_ai_assistant`) with repository + encrypted tenant-scoped columns.
- `prepareMutation` runtime wrapper intercepts `isMutation: true` tools for non-read-only agents, creates an `AiPendingAction`, and emits a `mutation-preview-card` UI part.
- Three new routes: `GET /api/ai/actions/:id` (reconnect/polling), `POST /api/ai/actions/:id/confirm` (full server-side re-check from §9.4 — stale-version, cross-tenant, idempotent double-confirm, read-only-agent refusal, prompt-override escalation refusal), `POST /api/ai/actions/:id/cancel`.
- Four new UI parts in `@open-mercato/ui/src/ai/parts/`: `mutation-preview-card`, `field-diff-card`, `confirmation-card`, `mutation-result-card` with `Cmd/Ctrl+Enter` / `Escape` shortcuts and SSE reconnect.
- Typed lifecycle events via `createModuleEvents`: `ai.action.confirmed`, `ai.action.cancelled`, `ai.action.expired`.
- Cleanup worker `ai_assistant:pending-action-cleanup` sweeps expired rows on a 5-minute system-scope interval (or via `yarn mercato ai_assistant run-pending-action-cleanup`).
- First mutation-capable production agent: `customers.account_assistant` for deal-stage updates. *(@peter)*

---

## 🛠️ Improvements

- Shared model factory extracted from `inbox_ops/lib/llmProvider.ts` into `@open-mercato/ai-assistant/lib/model-factory.ts` with resolution order: caller override → `<MODULE>_AI_MODEL` env → `agentDefaultModel` → provider default. The original `llmProvider.ts` API is preserved via a thin shim over the shared factory — no call-site churn.
- Production `ai-agents.ts` files with `resolvePageContext` callbacks that hydrate record-level context from real backend pages through normal injection/UI composition.
- Per-module env overrides: `<MODULE>_AI_MODEL` (internal convention; e.g., `INBOX_OPS_AI_MODEL`, `CATALOG_AI_MODEL`).
- New env var `AI_PENDING_ACTION_TTL_SECONDS` (default `900`) for pending-action expiry. *(@peter)*

---

## 🧪 Testing

- ai-assistant unit tests: 50/558 green.
- core unit tests: 344/3180 preserved.
- ui unit tests: 66/351 preserved.
- Full TC-AI integration suite: 40 passed / 1 flaky (self-retries) / 1 skipped, zero real failures.
- New integration coverage: unknown agent / forbidden agent / invalid attachment / allowed-tool filtering / tool-pack coverage; page-context resolution / model-factory fallback chain / `maxSteps` budget; pending-action contract — happy, cancel, expiry, stale-version, cross-tenant denial, idempotent double-confirm, read-only-agent refusal, prompt-override escalation refusal, page-reload reconnect; full D18 bulk-edit demo (4 scenarios, ≈1.9 min live-server). *(@peter)*

---

## 📝 Specs & Documentation

- Spec moved to `.ai/specs/implemented/2026-04-11-unified-ai-tooling-and-subagents.md` on completion (history preserved via `git mv`).
- AI Assistant `AGENTS.md` now includes an **Upgrading / Operator rollout notes** section (env vars, new table + migration, cleanup worker, prompt-override + mutation-policy-override tables, BC posture, OpenCode coexistence note).
- Run folder `.ai/runs/2026-04-18-ai-framework-unification/` captures the full 19-Step execution audit trail. *(@peter)*

---

## Backward Compatibility

All changes are additive:

- No existing event IDs, API routes, widget slots, DI keys, ACL feature IDs, notification type IDs, CLI commands, or generated file contracts were renamed or removed.
- `packages/core/src/modules/inbox_ops/lib/llmProvider.ts` keeps its public API via a thin shim over the new shared model factory — existing callers are unaffected.
- New DB table `ai_pending_actions` lands via standard `yarn db:migrate`; no data migration needed.
- New prompt-override + mutation-policy-override tables are feature-gated behind `ai_assistant.settings.manage` and carry no defaults that would change agent behavior for existing tenants.

See `BACKWARD_COMPATIBILITY.md` for the full contract-surface review.

---

# Release Notes - Open Mercato v0.4.3

**Date:** April 11, 2026

## Breaking Changes

### `roles.tenant_id` is now NOT NULL (#687)

The `roles.tenant_id` column has been changed from nullable to `NOT NULL`. Global roles (`tenantId IS NULL`) were never functional — the RBAC service could not load permissions for them (because `RoleAcl.tenantId` is already `NOT NULL`), and `ensureRolesInContext` destructively corrupted them by mutating their `tenantId` during tenant setup, causing cross-tenant access control resets.

**Migration**: `Migration20260411203200` automatically cleans up all FK dependents (`role_acls`, `user_roles`, `role_sidebar_preferences`) referencing global roles and deletes the orphaned rows before applying the constraint. No manual action is required.

**API impact**: `POST /api/auth/roles` and `PUT /api/auth/roles` no longer accept `tenantId: null`. Callers that omit `tenantId` are unaffected — it defaults to the authenticated user's tenant. Callers that explicitly passed `null` will receive a `400` error.

**Function impact**: `ensureRoles()` and `ensureRolesInContext()` now require a non-null `tenantId`. All internal callers already provided one; third-party modules calling these functions with `tenantId: null` must update.

**Spec**: [`.ai/specs/implemented/2026-04-11-eliminate-global-roles.md`](.ai/specs/implemented/2026-04-11-eliminate-global-roles.md)

---

# Release Notes - Open Mercato v0.4.2

**Date:** January 29, 2026

## Highlights

This release introduces the **Notifications module**, **Agent Skills infrastructure**, **Dashboard Analytics Widgets**, and a major architectural improvement decoupling module setup with a centralized config. It also includes important security fixes, Docker infrastructure improvements, and dependency updates.

---

## Features

### Notifications Module (#422, #457)
Full implementation of the in-app notifications system, including notification types, subscribers, custom renderers, and user preferences. *(@pkarw)*

### Agent Skills Infrastructure (#455)
Created the foundational structure for agent skills in Open Mercato, enabling extensible AI-powered capabilities. *(@pat-lewczuk)*

### Dashboard Analytics Widgets (#408)
New analytics widgets for the dashboard, providing richer data visualization and insights. *(@haxiorz)*

### Decoupled Module Setup - Centralized ModuleSetupConfig (#446)
Resolves #410 -- module setup is now decoupled using a centralized `ModuleSetupConfig`, improving modularity and reducing coupling between modules. *(@redjungle-as)*

### Specs Reorganization (#436, #416)
Reorganized architecture specs and added new specifications for SDD, messages, notifications, progress tracking, and record locking. *(@pkarw)*

### CodeQL Security Improvements (#418)
Addressed CodeQL-identified security issues across the codebase. *(@pkarw)*

---

## Bug Fixes

### Security: Prevent Open Redirect in Session Refresh (#429)
Fixed an open redirect vulnerability in the authentication session refresh flow. *(@bartek-filipiuk)*

### Fix Assistant Module (#442)
Resolved issues in the AI assistant module. *(@fto-aubergine)*

### Fix Global Search Dialog Title (#440)
Corrected the dialog title for global search and added specs for new widgets. *(@pkarw)*

### Fix Docker Compose Overlapping Services (#448, #449)
Resolved service conflicts in Docker Compose configuration where services were overlapping. *(@MStaniaszek1998)*

### Fix Docker Compose Configuration (#423, #424)
General Docker Compose configuration fixes. *(@pkarw)*

### Change Base Image to Debian for OpenCode (#443)
Switched the OpenCode container base image to Debian for better compatibility. *(@MStaniaszek1998)*

---

## Infrastructure & DevOps

### Change Service Port (#434)
Updated the default service port configuration. *(@MStaniaszek1998)*

### Database Pool Default Reduced
Lowered the implicit `DB_POOL_MAX` default from `50` to `20` to keep local and Windows development within a safer PostgreSQL connection budget. Deployments that relied on the old default should set `DB_POOL_MAX` explicitly.

### Create Dockerfile for Docs (#425)
Added a dedicated Dockerfile for building and serving the documentation site. *(@MStaniaszek1998)*

---

## Dependencies

- **#454** - Bump `tar` from 7.5.6 to 7.5.7 *(security patch)*
- **#447** - Bump `npm_and_yarn` group across 2 directories

---

## Contributors

- @pkarw
- @pat-lewczuk
- @MStaniaszek1998
- @bartek-filipiuk
- @fto-aubergine
- @redjungle-as
- @haxiorz
- @dependabot
