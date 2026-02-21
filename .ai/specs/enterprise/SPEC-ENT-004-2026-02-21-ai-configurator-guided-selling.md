# SPEC-ENT-004: AI Configurator for Guided Selling (Enterprise)

**Date**: 2026-02-21  
**Status**: Proposed  
**Scope**: Enterprise Edition  
**Related**: SPEC-ENT-003, SPEC-029, SPEC-029a, SPEC-029b

---

## 1) Overview

This specification defines a dedicated **AI Configurator** module for storefront conversational commerce.

Goal:
1. shorten path from intent to purchase,
2. keep business correctness (channel/offer/pricing/workflow),
3. provide secure, policy-driven context management.

AI Configurator is not just UI settings. It is a runtime policy engine that decides:
- what context AI can see,
- which tools AI can execute,
- how autonomous AI can be for a given session.

---

## 2) Problem Statement

Without a configurator, AI shopping assistants usually fail in three ways:

1. **Context sprawl**  
Model sees too much or wrong data (cross-channel, stale, untrusted).

2. **Unsafe autonomy**  
AI mutates cart/checkout without strict policy and idempotent boundaries.

3. **Weak operability**  
No explicit control plane for legal/compliance, experimentation, and tenant-level rollout.

---

## 3) Market Research and Benchmark (critical)

### 3.1 Observed Vendor Patterns

Based on public product/docs pages from Zoovu, Bloomreach, Dynamic Yield, Constructor, Algolia, Nosto, and Coveo:

1. guided selling uses question flows, product feed attributes, and recommendation strategies;
2. product discovery is hybrid (behavioral + catalog attributes + semantic/vector);
3. strong implementations include:
- campaign testing,
- no-result fallback,
- citations/transparency for generative answers,
- merchant controls for ranking and business rules.

### 3.2 Strengths in Market Solutions

1. fast UX wins via product finder/quiz templates,
2. rich merchandising controls for non-engineering teams,
3. measurable conversion impact through A/B and funnel instrumentation.

### 3.3 Weaknesses / Gaps (where we must be better)

1. many solutions are black-box around policy and security boundaries;
2. context lineage is often under-specified (what exact data was used and why);
3. mutating actions are frequently coupled to vendor runtime with limited domain guardrails.

### 3.4 Design Implication for Open Mercato

Open Mercato must prioritize:
1. explicit policy+scope contracts,
2. deterministic tool gating over LLM freedom,
3. context provenance and auditability as first-class features.

---

## 4) Proposed Solution

Introduce `ai_configurator` as enterprise module (control plane + runtime policy engine):

1. `Profile Builder`  
Build session profile from:
- UTM parameters,
- consented cookie signals,
- optional qualification questions.

2. `Policy Engine`  
Resolves:
- allowed context sources,
- allowed tools,
- autonomy mode (`strict`, `balanced`, `assisted-auto`),
- safety/compliance mode.

3. `Context Composer`  
Assembles bounded context from trusted buckets only.

4. `Execution Guard`  
Server-side middleware for every tool call (scope, feature flag, idempotency, guard checks).

---

## 5) Architecture

### 5.1 Module Placement

1. `packages/enterprise/src/modules/ai_configurator`
- policy models and APIs
- profile resolution
- context composition and tool gates

2. `packages/ai-assistant`
- consumes resolved config profile
- applies prompt/tool policy per session

3. `packages/core/src/modules/ecommerce`
- source of truth for cart and checkout workflow transitions

4. `packages/search`
- retrieval service constrained by configurator scope policy

### 5.2 Runtime Flow

1. session init (`storeSlug`, identity hints, utm, consent)
2. configurator resolves policy profile
3. context composer builds safe prompt context
4. AI proposes answer/actions
5. tool execution passes through execution guard
6. state sync with cart/checkout session after each mutation

---

## 6) Context Management (hard requirements)

### 6.1 Context Buckets

1. `hard_context` (mandatory, immutable in session)
- tenantId, organizationId, storeId, channelId, locale, currency

2. `commerce_state` (live, authoritative)
- cart token snapshot, cart lines, checkout session state

3. `profile_context` (configurator output)
- campaign intent, user segment, autonomy mode, tool permissions

4. `retrieval_context` (bounded evidence only)
- top-N snippets from whitelisted sources

5. `conversation_summary` (compressed memory)
- short safe summary, never source-of-truth for transactions

### 6.2 Source Whitelisting

Allowed source classes:
1. selected content files (policy/faq/pages) marked as AI-eligible,
2. products/variants/offers available in active sales channel only,
3. store metadata from active storefront config.

Anything else is blocked by default.

### 6.3 Context Budget Policy

1. fixed token budget per request with bucket priorities:
`hard_context > commerce_state > profile_context > retrieval_context > conversation_summary`
2. deterministic truncation strategy,
3. mandatory re-sync from backend after mutating tools.

### 6.4 Anti-Poisoning / Anti-Injection

1. sanitize and normalize user-provided text before persistence,
2. mark user content as untrusted and never elevate to policy,
3. enforce tool-call policy server-side, not in prompt instructions,
4. keep retrieval from trusted indexed docs only.

---

## 7) AI Configurator Model

### 7.1 Core Entity

`ai_configurator_profiles`
- `id` uuid
- `tenant_id`, `organization_id`, `store_id`
- `name`, `status`
- `priority`
- `match_rules` jsonb:
  - `utm` conditions
  - `consent_required` flags
  - `cookie_segments`
  - optional Q&A qualifiers
- `context_policy` jsonb:
  - allowed source classes
  - retrieval limits
  - citation requirements
- `tool_policy` jsonb:
  - allowed tools
  - confirmation requirements
  - idempotency requirements
- `autonomy_mode` (`strict|balanced|assisted-auto`)
- `compliance_mode` (`strict|standard`)
- `created_at`, `updated_at`, `deleted_at`

### 7.2 Session Binding

`ecommerce_ai_sessions` stores resolved profile id and effective policy snapshot.

Policy snapshot is immutable for session stability (except explicit policy refresh action).

---

## 8) API Contracts

### 8.1 Configurator Admin APIs

1. `GET /api/enterprise/ai-configurator/profiles`
2. `POST /api/enterprise/ai-configurator/profiles`
3. `PUT /api/enterprise/ai-configurator/profiles/:id`
4. `POST /api/enterprise/ai-configurator/profiles/:id/simulate`
- input: sample UTM/cookie/Q&A
- output: resolved policy decision + explanation trace

### 8.2 Runtime APIs

1. `POST /api/ecommerce/storefront/ai/config/resolve`
- resolves profile and returns policy envelope for session init

2. `POST /api/ecommerce/storefront/ai/context/compose`
- returns bounded context with provenance metadata

3. `POST /api/ecommerce/storefront/ai/tools/*`
- all tool endpoints require policy guard middleware

---

## 9) Security and Resilience

1. strict scope checks on every resolver and tool call
2. encrypted storage for sensitive session event payloads
3. correlation id and audit event for each policy and tool decision
4. rate limits and anomaly detection (`guard_blocked` spikes)
5. hard kill switches:
- disable AI globally
- disable mutating tools
- force `strict` autonomy mode

---

## 10) UI/UX for Configurator

### 10.1 Admin Panel Surface

1. Profile list (status, priority, match scope)
2. Visual rule builder:
- UTM/cookie/qualifier rules
3. Context policy editor:
- source whitelist
- retrieval size/citation level
4. Tool policy editor:
- per-tool allow/deny
- confirmation toggles
5. Simulator + explainability panel:
- “Why this profile was selected”

### 10.2 Storefront Behavior

1. unobtrusive assistant with visible trust cues:
- citations,
- “based on your selected preferences,”
- explicit confirmation for mutating actions.

2. if profile is `strict`:
- AI remains advisory unless user confirms each action.

---

## 11) Critical Assessment

### 11.1 Strong Aspects of This Approach

1. policy and context are explicit and testable,
2. aligned with existing checkout workflow authority,
3. enterprise-ready governance and rollout control.

### 11.2 Weak Aspects / Trade-offs

1. increased implementation complexity and operational overhead,
2. more configuration means potential misconfiguration risk,
3. extra latency due to policy/context resolution.

### 11.3 Mitigations

1. safe defaults + profile templates,
2. simulation mode before activation,
3. strict observability and alerting,
4. phased rollout by tenant/store.

---

## 12) Implementation Plan

### Phase 1 (P0): Safety Foundation

1. data models + migrations
2. policy resolver + context composer
3. tool guard middleware
4. profile simulation API

Acceptance:
- no cross-scope leakage in integration tests
- mutating tools blocked without policy allow

### Phase 2 (P1): Admin UX + Guided Rollout

1. admin screens for profile/rule editing
2. profile explainability and dry-run
3. analytics dashboard (policy hits, blocked actions)

Acceptance:
- non-engineers can configure and validate profile behavior

### Phase 3 (P2): Optimization

1. profile A/B testing
2. adaptive context budgets
3. auto-suggested profile improvements from telemetry

Acceptance:
- measurable conversion uplift with stable guard metrics

---

## 13) Success Metrics

1. time-to-product-match reduced by >= 30%
2. AI-assisted add-to-cart uplift >= 15%
3. invalid checkout transition attempts from AI: 0
4. policy false-block rate < 2%
5. p95 response latency stays within configured SLO

---

## 14) Open Questions

1. Should coupons ever be auto-applied in `assisted-auto` mode?
2. What minimum consent granularity is required for cookie-derived profile signals?
3. How long can session policy snapshot remain valid before mandatory refresh?
4. Which verticals require mandatory human confirmation for `place_order`?

---

## 15) References (research inputs)

1. Zoovu site and Advisor Studio docs
2. Bloomreach Conversational Shopping/Clarity pages and docs
3. Dynamic Yield Product Finder documentation
4. Constructor quizzes docs
5. Algolia Recommend docs
6. Nosto recommendations docs
7. Coveo Relevance Generative Answering docs

---

## 16) Changelog

### 2026-02-21
- Initial enterprise specification for AI Configurator module with strict context governance, policy engine, and guided-selling benchmark insights.
