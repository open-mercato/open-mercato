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

---

## 8) Security, Isolation, and Compliance

1. strict scoping by `tenant_id` + `organization_id` + `store_id`
2. channel-aware filtering for offers and pricing
3. no direct SQL from AI layer; tools call module services/APIs only
4. PII minimization in prompts and event logs
5. encryption helpers for sensitive payloads at rest
6. rate limits + abuse detection for AI endpoints
7. audit trail for tool calls and guard rejections

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

1. define enterprise spec + contracts
2. add AI session/event entities and migrations
3. implement scoped RAG retrieval service for storefront
4. expose discovery + transactional tool endpoints
5. add `ai-shopping-journey` workflow definition
6. integrate chat UI in `apps/storefront`
7. add observability and guardrail audits
8. rollout by feature flags per tenant/store

---

## 13) Success Metrics

1. median time-to-add-to-cart reduced
2. conversion rate from AI-assisted sessions improved
3. duplicate/invalid order attempts from AI = 0
4. recommendation acceptance rate
5. handoff success rate from AI to completed checkout

---

## 14) Open Questions

1. Should AI be allowed to auto-apply coupons/promotions?
2. How much policy/legal content should be quoted vs summarized?
3. Do we allow proactive upsell before order placement?
4. Which tenants can enable autonomous checkout transitions by default?

---

## 15) Changelog

### 2026-02-21
- Initial enterprise specification for AI commerce RAG assistant integrated with storefront and workflow checkout.
