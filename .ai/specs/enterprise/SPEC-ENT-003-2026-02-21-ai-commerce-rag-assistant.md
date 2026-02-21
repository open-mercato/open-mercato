# SPEC-ENT-003: AI Commerce RAG Assistant (Enterprise)

**Date**: 2026-02-21  
**Status**: Proposed  
**Scope**: Enterprise Edition  
**Related**: SPEC-029, SPEC-029a, SPEC-029b, SPEC-012, SPEC-025

---

## 1) Overview

This specification defines an enterprise-grade AI commerce assistant for storefronts, designed to minimize time-to-purchase while preserving strict business correctness.

The assistant uses:
- RAG for product and store knowledge
- workflow-driven checkout orchestration
- tool-based action execution (no direct DB writes by LLM)
- tenant/org/store/channel isolation

---

## 2) Problem Statement

Current storefront flows are strong for standard browsing and checkout, but enterprise teams need:

1. conversational discovery with high precision (products, variants, policies)
2. guided purchase path from intent to order with minimal friction
3. deterministic execution for cart/checkout actions
4. auditable and policy-governed AI behavior
5. reusable architecture for mobile assistants and external AI agents

Without this, AI either becomes read-only (low value) or unsafe (bypassing pricing/channel/workflow rules).

---

## 3) Proposed Solution

Implement `AI Commerce RAG Assistant` as a layered capability:

1. `Knowledge Layer`  
RAG index over catalog/ecommerce/content data, scoped by tenant/org/store/channel/locale.

2. `Tool Layer`  
Typed MCP/API tools for discovery and transaction intents (`find_products`, `add_to_cart`, `transition_checkout_session`, etc.).

3. `Orchestration Layer`  
Two workflows:
- `ai-shopping-journey` (conversation orchestration)
- existing `checkout session` workflow (`SPEC-029b`) for order placement

4. `Governance Layer`  
RBAC, feature flags, audit logs, guardrails, policy checks, and fallback behavior.

---

## 4) Architecture

### 4.1 High-Level Components

1. `packages/ai-assistant`  
- prompt orchestration  
- tool registration  
- policy enforcement at tool-call boundary

2. `packages/search` + `packages/core/query_index`  
- hybrid retrieval (fulltext + vector)  
- faceted metadata filters

3. `packages/core/modules/ecommerce`  
- carts, checkout sessions, store context, sales channel funnel

4. `packages/core/modules/workflows`  
- conversational state machine and deterministic checkout transitions

5. `apps/storefront`  
- chat UI + action cards + checkout handoff

### 4.2 Reference Request Flow

1. user intent
2. AI retrieves scoped candidates (RAG + structured filters)
3. AI asks clarifying question (if needed)
4. AI calls tool to add selected variant/offer to cart
5. AI drives checkout session transitions
6. order placement via existing sales integration

---

## 5) Data Models

### 5.1 Enterprise AI Session Entity (new)

`ecommerce_ai_sessions`
- `id` uuid
- `tenant_id`, `organization_id`, `store_id`
- `channel_binding_id` (nullable)
- `customer_session_token` (nullable)
- `workflow_instance_id` (conversation workflow)
- `status` (`active|completed|abandoned|failed`)
- `locale`, `currency_code`
- `metadata` jsonb
- `created_at`, `updated_at`, `deleted_at`

### 5.2 Enterprise AI Turn/Event Entity (new)

`ecommerce_ai_events`
- `id` uuid
- `ai_session_id`
- `event_type` (`user_message|retrieval|tool_call|tool_result|guard_blocked|summary`)
- `payload` jsonb
- `latency_ms`
- `token_usage` jsonb
- `created_at`

### 5.3 RAG Document Contract (indexed shape)

- `doc_type` (`product|variant|offer|category|policy|faq|store`)
- `doc_id`
- `title`, `subtitle`, `body`
- `tenant_id`, `organization_id`, `store_id`
- `sales_channel_id`, `price_kind_id`
- `locale`, `currency_code`
- `availability_flags`
- `facets` jsonb

---

## 6) API Contracts

All routes must publish `openApi` metadata.

### 6.1 Assistant Session APIs

1. `POST /api/ecommerce/storefront/ai/sessions`
- input: `storeSlug`, optional cart token, optional locale
- output: session context + capabilities

2. `POST /api/ecommerce/storefront/ai/sessions/:id/messages`
- input: user message
- output: assistant response + actions + citations

3. `GET /api/ecommerce/storefront/ai/sessions/:id/state`
- output: current AI journey state, linked cart/session/order ids

### 6.2 Retrieval APIs

1. `POST /api/ecommerce/storefront/ai/retrieval/search`
- input: intent + filters
- output: ranked products/offers with explanations and confidence

2. `GET /api/ecommerce/storefront/ai/retrieval/sources`
- output: source snippets used in last response (RAG transparency)

### 6.3 Tool APIs (transactional)

1. `POST /api/ecommerce/storefront/ai/tools/add-to-cart`
2. `POST /api/ecommerce/storefront/ai/tools/checkout-transition`
3. `POST /api/ecommerce/storefront/ai/tools/cancel-checkout`

All transactional tool APIs must validate against store/channel/offer guards in core ecommerce services.

### 6.4 Canonical Request/Response DTOs

All DTOs use zod in module-local validators and derive TS types with `z.infer`.

1. `AssistantMessageRequest`
- `message`: string (1..4000)
- `sessionId`: uuid
- `locale`: string optional
- `context`: object optional

2. `AssistantMessageResponse`
- `message`: string
- `intent`: enum (`search|compare|recommend|add_to_cart|checkout|help`)
- `citations`: array of `{ docType, docId, title, snippet }`
- `actions`: array of action cards:
  - `type`: enum (`open_product|choose_variant|add_to_cart|go_checkout|confirm_transition`)
  - `label`: string
  - `payload`: object
- `state`: `{ workflowState, cartToken?, checkoutSessionId? }`

3. `RetrievalSearchRequest`
- `query`: string
- `storeSlug`: string
- `filters`:
  - `categoryIds?`, `tagIds?`, `priceMin?`, `priceMax?`, `inStock?`
  - `salesChannelId?`, `priceKindId?`
- `limit`: int <= 50
- `locale`: string optional

4. `RetrievalSearchResponse`
- `results`: ranked array with
  - `productId`, `variantId?`, `offerId?`
  - `score`: number
  - `reasons`: string[]
  - `price`: `{ gross, net, currencyCode }`
  - `availability`: `{ canBuy, reason? }`
- `facets`: normalized facet buckets
- `debug`: optional (`retrievalStrategy`, `latencyMs`, `thresholds`)

5. `ToolAddToCartRequest`
- `sessionId`: uuid
- `cartToken`: uuid optional
- `productId`: uuid
- `variantId`: uuid optional
- `quantity`: int >= 1

6. `ToolCheckoutTransitionRequest`
- `sessionId`: uuid
- `checkoutSessionId`: uuid
- `action`: enum (`set_customer|set_shipping|review|place_order|cancel`)
- `payload`: object optional
- `idempotencyKey`: string required for `place_order`

### 6.5 Error Contract (uniform)

All AI endpoints return:
- `{ error: string, code?: string, details?: any, correlationId?: string }`

Common codes:
- `AI_SCOPE_FORBIDDEN`
- `AI_GUARD_BLOCKED`
- `AI_TOOL_VALIDATION_FAILED`
- `AI_RETRIEVAL_EMPTY`
- `AI_TRANSITION_CONFLICT`
- `AI_RATE_LIMITED`

### 6.6 Idempotency Contract

1. Mutating tool endpoints support `X-Idempotency-Key`.
2. `place_order` must require idempotency key and map to checkout session idempotency.
3. Repeated key must return same outcome body where possible.

---

## 7) Workflow Design

### 7.1 AI Shopping Journey Workflow (new)

States:
1. `intent_capture`
2. `candidate_retrieval`
3. `clarification`
4. `selection_ready`
5. `cart_ready`
6. `checkout_guidance`
7. `handoff_completed`
8. `aborted`

Transitions are manual/signal-driven by tool outcomes and user responses.

### 7.2 Checkout Workflow (existing)

Keep `SPEC-029b` checkout transitions as the transactional authority:
- `set_customer`
- `review`
- `place_order`
- terminal `completed|failed|cancelled`

AI may initiate transitions, but never bypasses checkout session APIs.

### 7.3 AI Journey Transition Rules (explicit)

1. `intent_capture -> candidate_retrieval`
- on parsed intent confidence >= configured threshold

2. `candidate_retrieval -> clarification`
- if ambiguity > threshold or required variant axis unresolved

3. `candidate_retrieval -> selection_ready`
- if exactly one strongly-ranked candidate or explicit user choice

4. `selection_ready -> cart_ready`
- after successful `add_to_cart` tool result

5. `cart_ready -> checkout_guidance`
- when user asks to buy now or cart value exceeds soft threshold prompt

6. `checkout_guidance -> handoff_completed`
- when checkout workflow reaches `completed`

7. any state -> `aborted`
- explicit user cancel, repeated guard failures, policy violation

### 7.4 Human-in-the-loop Escalation

Escalation triggers:
1. repeated uncertainty (N turns without confident recommendation)
2. payment/compliance-sensitive edge case
3. explicit user request for human support

Escalation actions:
1. create inbox item for support/sales
2. persist context summary in `ecommerce_ai_events`
3. handoff link to cart/PDP/checkout session

---

## 8) Security, Isolation, and Compliance

1. strict scoping by `tenant_id` + `organization_id` + `store_id`
2. channel-aware filtering for offers and pricing
3. no direct SQL from AI layer; tools call module services/APIs only
4. PII minimization in prompts and event logs
5. encryption helpers for sensitive payloads at rest
6. rate limits + abuse detection for AI endpoints
7. audit trail for tool calls and guard rejections

### 8.1 Prompt and Data Handling Policy

1. Never include raw secrets, access tokens, or internal keys in prompts.
2. Mask direct PII fields in stored AI event payloads by default.
3. Keep per-tenant encryption fallback policy aligned with platform encryption service.
4. Record data lineage for each response:
- model id
- retrieval doc ids
- tool calls performed

### 8.2 Policy Enforcement Points

1. Before retrieval:
- verify store + channel binding + tenant/org scope

2. Before any mutating tool:
- enforce feature flags and RBAC capability

3. Before checkout transitions:
- verify checkout session belongs to same scoped store
- enforce allowed transition set from session state

4. On recommendation output:
- block unsupported claims (e.g., fake stock guarantees)

### 8.3 Compliance Modes

1. `strict`
- citations mandatory
- no autonomous transition execution

2. `balanced`
- citations for high-impact responses
- explicit confirmations for mutating actions

3. `assisted-auto`
- transactional tools allowed for trusted sessions
- still requires checkout idempotency and guard pass

---

## 9) UI/UX

1. storefront chat panel with “action cards”
2. transparent citations (“why this recommendation”)
3. explicit confirmation for mutating actions
4. resilient fallback to classic UI when AI confidence is low
5. unified cart state between chat and standard storefront pages

---

## 10) Configuration

Feature flags:
- `ecommerce.ai.enabled`
- `ecommerce.ai.tools.transactional.enabled`
- `ecommerce.ai.rag.hybrid.enabled`
- `ecommerce.ai.autocheckout.enabled` (default off)

Environment:
- vector provider/model parameters
- retrieval limits and threshold
- per-tenant policy toggles

### 10.1 Recommended Enterprise Defaults

1. `ecommerce.ai.enabled=true` for pilot tenants only
2. `ecommerce.ai.tools.transactional.enabled=true` only with audit sink enabled
3. `ecommerce.ai.autocheckout.enabled=false`
4. retrieval:
- topK=20
- rerankK=8
- maxContextTokens fixed per model
- minConfidence threshold configured per locale

### 10.2 Feature-to-Role Mapping (minimum)

1. `ecommerce.ai.view`
2. `ecommerce.ai.chat`
3. `ecommerce.ai.checkout.assist`
4. `ecommerce.ai.admin`

---

## 11) Alternatives Considered

1. Chat-only read mode  
- Low implementation risk, low business impact.

2. LLM direct checkout writes  
- Fast prototype, unacceptable correctness/compliance risk.

3. Separate AI checkout implementation  
- Duplicates domain logic; rejected in favor of `SPEC-029b` reuse.

Chosen approach: tool-driven AI orchestration over existing core workflows.

---

## 12) Implementation Approach

### 12.1 Delivery Principles

1. Reuse existing ecommerce/checkout core logic; do not fork transaction paths.
2. Ship behind flags with tenant-level rollout.
3. Every mutating action must be idempotent and auditable.
4. Keep OSS/Enterprise boundaries clean (`.ai/specs/enterprise`, `packages/enterprise` integrations as needed).

### 12.2 EPIC Plan (detailed)

#### EPIC A: Foundation & Contracts
1. Define zod DTOs and OpenAPI for all AI storefront endpoints.
2. Add module ACL feature declarations and setup defaults.
3. Add DI registrations for retrieval and orchestration services.
4. Add structured error contract + correlation ids.

Done criteria:
1. OpenAPI generated with endpoint schemas.
2. Contract tests pass for status and payload shapes.

#### EPIC B: Data & Indexing
1. Add entities:
- `ecommerce_ai_sessions`
- `ecommerce_ai_events`
2. Generate migrations via standard flow.
3. Add query helpers with tenant/org/store scoping.
4. Extend indexing pipeline for RAG docs:
- products/variants/offers
- store policy docs (content module)
5. Add reindex command hooks for new doc types.

Done criteria:
1. migrations apply cleanly
2. retrieval returns scoped results only
3. no cross-tenant leakage in integration tests

#### EPIC C: Retrieval Engine
1. Implement hybrid retrieval service:
- lexical first pass
- vector reranking
- facet-aware filtering
2. Add result post-processing:
- dedupe by product+variant+offer tuple
- availability and channel checks
3. Add citation formatter and source trace records.

Done criteria:
1. p95 retrieval latency target met
2. relevance acceptance baseline met in evaluation set

#### EPIC D: Tooling Layer
1. Add read tools:
- `find_products`
- `get_product_detail`
- `compare_products`
2. Add mutating tools:
- `add_to_cart`
- `update_cart_line`
- `checkout_transition`
3. Implement tool guard middleware:
- feature flag checks
- scope checks
- dry-run validation mode

Done criteria:
1. tool-call audit records complete
2. idempotency tests pass for mutating tools

#### EPIC E: Workflow Orchestration
1. Add `ai-shopping-journey` workflow definition and seed mechanism.
2. Implement transition mapping from tool outcomes and user intents.
3. Integrate with existing checkout session workflow (`SPEC-029b`) without duplicate business logic.
4. Add escalation paths to human support/inbox.

Done criteria:
1. deterministic journey transitions in tests
2. no direct order creation outside checkout workflow

#### EPIC F: Storefront UX Integration
1. Implement chat shell and action cards.
2. Add fallback UX if AI unavailable or confidence low.
3. Sync chat/cart/checkout states in a single session context.
4. Add localization support for prompts/action labels.

Done criteria:
1. complete assisted purchase flow in manual QA
2. accessibility checks pass (keyboard + screen reader basics)

#### EPIC G: Observability, Governance, and Rollout
1. Add dashboards:
- conversion funnel by AI state
- guard-block rate
- recommendation acceptance
2. Add SLO monitors and alerting.
3. Add rollout playbook and rollback switches.
4. Run pilot for selected tenants and gate GA by metrics.

Done criteria:
1. operational dashboards active
2. rollback validated in staging

### 12.3 Work Packages by Module

1. `packages/core/src/modules/ecommerce`
- AI session/event entities
- tool endpoints and shared validators
- checkout linkage and guard checks

2. `packages/search/src/modules/search`
- retrieval services and index config
- hybrid query profile for storefront

3. `packages/ai-assistant/src/modules/ai_assistant`
- tool registry wiring
- policy and prompt orchestration

4. `packages/core/src/modules/workflows`
- journey workflow definition and transition helpers

5. `apps/storefront`
- chat UI, actions, and state sync integration

### 12.4 Acceptance Gates Per Phase

Gate A (contracts): OpenAPI + DTO tests green  
Gate B (data): migrations + scope tests green  
Gate C (retrieval): relevance/latency baseline met  
Gate D (tools): idempotency and guard tests green  
Gate E (workflow): end-to-end deterministic flow green  
Gate F (UX): manual QA + accessibility pass  
Gate G (ops): dashboards + alerts + rollback validated

### 12.5 Explicit Non-Goals (v1)

1. fully autonomous payment authorization
2. negotiated B2B contract pricing in conversation loop
3. cross-store/global federated shopping assistant

---

## 13) Success Metrics

1. median time-to-add-to-cart reduced
2. conversion rate from AI-assisted sessions improved
3. duplicate/invalid order attempts from AI = 0
4. recommendation acceptance rate
5. handoff success rate from AI to completed checkout

### 13.1 KPI Targets (initial)

1. time-to-add-to-cart: -25% vs baseline storefront flow
2. AI-assisted checkout completion: +10% vs control
3. guard-block false positives: <2%
4. invalid transition attempts reaching checkout API: 0
5. p95 AI response latency: <2.5s (without heavy tools), <4.0s (with retrieval+tool)

### 13.2 Operational SLOs

1. AI endpoint availability: 99.9%
2. tool success ratio: >=99.5% (excluding user validation errors)
3. retrieval service availability: 99.9%

---

## 14) Testing Strategy

### 14.1 Test Pyramid

1. unit tests
- validators
- ranking heuristics
- transition mappers

2. integration tests
- scoped retrieval correctness
- tool execution against ecommerce guards
- workflow progression with mocked LLM

3. end-to-end tests
- full conversational purchase path
- fallback path when AI disabled/unavailable

### 14.2 Mandatory Regression Packs

1. Scope isolation pack:
- cross-tenant/store leakage checks

2. Transaction safety pack:
- duplicate idempotency key behavior
- checkout transition conflict handling

3. Recommendation correctness pack:
- variant disambiguation
- channel-bound offer filtering

4. Failure-mode pack:
- vector provider timeout
- tool 4xx/5xx propagation
- workflow partial failure with graceful recovery

### 14.3 Test Data Fixtures

1. multi-locale catalog with variant-rich products
2. at least two sales channels with distinct offer sets
3. stores with different policies and shipping settings
4. edge cases: unavailable products, stale offers, missing translations

---

## 15) Rollout & Operations

### 15.1 Rollout Stages

1. `Stage 0` internal dev + synthetic data
2. `Stage 1` pilot tenants, read-only mode
3. `Stage 2` pilot with transactional tools
4. `Stage 3` controlled GA by tenant feature flag

### 15.2 Rollback Plan

1. disable `ecommerce.ai.enabled`
2. disable transactional tools flag if needed
3. keep checkout/session/cart fully operational through classic UI
4. preserve AI audit data for postmortem

### 15.3 Runbook Signals

1. sudden increase in `AI_GUARD_BLOCKED`
2. increase in `AI_TRANSITION_CONFLICT`
3. retrieval empty-rate spike
4. drop in recommendation acceptance

---

## 16) Open Questions

1. Should AI be allowed to auto-apply coupons/promotions?
2. How much policy/legal content should be quoted vs summarized?
3. Do we allow proactive upsell before order placement?
4. Which tenants can enable autonomous checkout transitions by default?

---

## 17) Changelog

### 2026-02-21
- Initial enterprise specification for AI commerce RAG assistant integrated with storefront and workflow checkout.
- Expanded to enterprise execution blueprint: detailed API/DTO/error contracts, EPIC-level roadmap, work packages, KPI/SLO targets, test matrix, rollout, and rollback runbook.
