# SPEC-029b: Ecommerce Workflow Checkout (State Machine)

**Date**: 2026-02-21  
**Status**: Proposed  
**Extends**: SPEC-029, SPEC-029a  
**Related Issues**: #289, #288

---

## 1) Overview

This spec introduces a full workflow-driven checkout for storefront:

- checkout session as a first-class entity
- explicit state machine transitions
- deterministic validation and idempotent order placement
- full integration with `ecommerce`, `workflows`, and `sales`

This replaces the current one-shot checkout model as the primary path, while preserving a short migration bridge.

---

## 2) Problem Statement

Current storefront checkout (`POST /cart/checkout`) is linear:

1. validate cart
2. call `sales.orders.create`
3. mark cart as converted

This works for MVP, but it is weak for:

- resumable checkout after refresh/device switch
- step-level validation and UX feedback
- robust retries and duplicate-submit safety
- future payment/shipping orchestration
- mobile and AI-agent orchestration via stable transitions

---

## 3) Proposed Solution

Add workflow checkout with:

1. `ecommerce_checkout_sessions` entity
2. workflow definition `ecommerce.checkout.v1`
3. transition API (`set_customer`, `set_shipping`, `review`, `place_order`, `cancel`)
4. idempotent `place_order` integrated with `sales.orders.create`
5. adapter compatibility for existing `POST /cart/checkout` (temporary)

---

## 4) Architecture

### 4.1 Module Responsibilities

- `packages/core/src/modules/ecommerce`:
  - session persistence
  - storefront checkout API
  - channel/offer/cart guard checks
- `packages/core/src/modules/workflows`:
  - state machine definition
  - transition execution
- `packages/core/src/modules/sales`:
  - order creation (source of truth)
- `packages/core/src/modules/events`:
  - checkout lifecycle events

### 4.2 Execution Path

1. storefront creates session from `cartToken`
2. frontend performs transitions
3. `place_order` transition executes guarded order creation
4. session moves to `completed`, cart to `converted`

---

## 5) Data Models

### 5.1 `ecommerce_checkout_sessions`

Columns:

- `id` uuid PK
- `tenant_id` uuid
- `organization_id` uuid
- `store_id` uuid
- `cart_id` uuid
- `cart_token` uuid
- `workflow_name` text (`ecommerce.checkout.v1`)
- `workflow_state` text
- `status` text (`active|completed|failed|expired|cancelled`)
- `version` int
- `customer_info` jsonb nullable
- `shipping_info` jsonb nullable
- `billing_info` jsonb nullable
- `metadata` jsonb nullable
- `placed_order_id` uuid nullable
- `idempotency_key` text nullable
- `expires_at` timestamptz
- `created_at` timestamptz
- `updated_at` timestamptz
- `deleted_at` timestamptz nullable

Indexes/constraints:

- index `(tenant_id, organization_id, store_id, status)`
- unique active session per cart
- unique `idempotency_key` (for non-null, per tenant/org scope)

---

## 6) Workflow Definition

States:

1. `cart`
2. `customer`
3. `shipping`
4. `review`
5. `placing_order`
6. `completed`
7. `failed`
8. `expired`
9. `cancelled`

Transitions:

1. `start`: `cart -> customer`
2. `set_customer`: `customer -> shipping|review` (config dependent)
3. `set_shipping`: `shipping -> review`
4. `review`: `review -> placing_order`
5. `place_order`: `placing_order -> completed|failed`
6. `expire`: `active -> expired`
7. `cancel`: `active -> cancelled`

Mandatory guards:

- store exists and is storefront-ready (channel binding present)
- cart exists, belongs to same tenant/org/store, status `active`
- all cart lines still mapped to active offers in bound sales channel
- strict zod validation for transition payloads
- session not expired

---

## 7) API Contracts

All routes expose `openApi`.

### 7.1 `POST /api/ecommerce/storefront/checkout/sessions`

Input:

- `cartToken`

Output:

- session DTO + allowed transitions

### 7.2 `GET /api/ecommerce/storefront/checkout/sessions/:id`

Output:

- session DTO + state + allowed transitions

### 7.3 `POST /api/ecommerce/storefront/checkout/sessions/:id/transition`

Input:

- `action`
- `payload`
- `idempotencyKey` (required for `place_order`)

Output:

- updated session DTO
- for success of `place_order`: `orderId`

### 7.4 Legacy Adapter

`POST /api/ecommerce/storefront/cart/checkout` temporarily delegates to transition pipeline.

---

## 8) Security & Reliability

1. tenant/org scoping is mandatory in all reads/writes
2. no cross-module ORM relationships
3. optimistic concurrency via `version`
4. idempotent `place_order` to prevent duplicate orders
5. minimal public errors; detailed diagnostics only in server logs
6. rate limiting on checkout transition routes

---

## 9) UI / UX

Storefront checkout screens render by `workflow_state` from session API:

- recoverable progress after refresh
- explicit step errors (field + business guards)
- optimistic UI only after transition success

---

## 10) Alternatives Considered

1. Keep one-shot checkout only
- pros: lower short-term complexity
- cons: hard to scale for shipping/payment/AI/mobile orchestration

2. Implement custom state table without workflows module
- pros: local flexibility
- cons: duplicates platform capability, less consistent with architecture

Chosen: use `workflows` directly to stay aligned with platform direction.

---

## 11) Implementation Approach

1. add `ecommerce_checkout_sessions` entity + migration
2. register checkout workflow definition in ecommerce module
3. implement session/transition routes
4. implement `place_order` transition with idempotent order creation
5. adapt legacy `POST /cart/checkout` to workflow pipeline
6. update storefront UI to transition-based flow
7. add integration + e2e tests

---

## 12) Does It Fully Solve the Problem?

Short answer: **yes for checkout orchestration**, with two caveats.

Solved:

1. deterministic checkout lifecycle
2. resumable sessions
3. safe retries and double-submit protection
4. channel-consistent validation at order placement
5. clear API contract for web/mobile/AI clients

Not fully solved yet (separate phases):

1. payment provider orchestration and async callbacks
2. stock reservation/availability race handling between cart and place order

---

## 13) Further Improvements

1. add `payment_intent` sub-state and webhook-safe transitions (`authorized`, `failed`, `requires_action`)
2. add optional inventory pre-check transition before `place_order`
3. add session telemetry dashboard (drop-off per state)
4. add policy hooks for B2B approvals (PO required, credit hold)
5. add fraud/velocity checks as transition guards
6. add `workflow_state` snapshots to analytics events for funnel analysis

---

## 14) Success Metrics

1. duplicate order rate from checkout retries: `0`
2. checkout completion rate improves vs one-shot baseline
3. transition error rate reduced by step-level validation
4. restore/resume success rate after reload > 95%

---

## 15) Open Questions

1. Should shipping be optional per store, or controlled by store settings?
2. Do we require billing data in v1 or only customer+shipping?
3. How long should session TTL be per vertical?
4. Should checkout session allow cart mutation after entering `review`?

## Changelog

### 2026-02-21
- Added concrete runtime integration approach: checkout session transitions are executed via `workflows` engine (`startWorkflow` + `executeTransition`) instead of only local branching.
- Added per-session workflow instance binding (`metadata.workflowInstanceId`) and tenant-scoped workflow definition bootstrap (`ecommerce_checkout_v1`).
- Clarified that `place_order` uses two-phase transition flow: `review -> placing_order`, then `placing_order -> completed|failed` based on sales command outcome.

---

## Changelog

### 2026-02-21
- Initial specification for workflow-based checkout (`SPEC-029b`)
- Added fit assessment (what is solved vs what remains)
- Added concrete improvement backlog for payment/inventory/fraud phases
