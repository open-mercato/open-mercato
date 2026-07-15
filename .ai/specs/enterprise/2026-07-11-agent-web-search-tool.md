# Web Search & Fetch Tools for File-Defined Agents (ACL-Gated MCP `defineAiTool`)

> Status: **IN PROGRESS — Phases 1–3 implemented; provider strategy pivoted (2026-07-15, see Provider Licensing Pivot)**
> Scope: Enterprise (`packages/enterprise/src/modules/agent_orchestrator`)
> Date: 2026-07-11 (updated 2026-07-15)

## TLDR

File-defined OpenCode agents in `agent_orchestrator` are propose-only and **no-network by
invariant**: the OpenCode container disables native `websearch`/`webfetch`, the renderer hardcodes
each agent's allowlist to `open-mercato_*` MCP tools, and local tools/skill scripts run in an
`isolated-vm` sandbox with no `fs`/net/`require`. This spec adds **read-only web search and fetch
tools** for deal-research agents **without** breaking those invariants: two `defineAiTool`s
(`agent_orchestrator.web_search`, `agent_orchestrator.web_fetch`) exposed through the **existing
`open-mercato` MCP server**, ACL-gated per call, traced, and guardrailed. Network egress happens
**server-side in the OM process** (already allowed net) — never inside the sandbox and never via
OpenCode's native web tools. Agents opt in by declaring the tools `// @ref` in `AGENT.md`.

**Provider strategy (pivoted 2026-07-15): bring-your-own-key, bundle nothing.** The original draft
shipped **SearXNG** (self-hosted metasearch) as the default provider. SearXNG is **AGPL-3.0**;
*calling* a separately-deployed instance over HTTP does not contaminate our MIT code, but
**bundling/shipping** its container as the product default does (AGPL distribution). Research also
found **no permissively-licensed self-hostable web-metasearch engine exists** to swap to — the whole
category is AGPL. So the default flips to: **ship the `WebSearchProvider` interface plus several
adapters, bundle no provider container and no credentials, and default the search provider to the
model-native adapter (Flavor B)** — it reuses the agent's own LLM `web_search` (the LLM key the
platform already has), so search works out of the box with **no separate search vendor, no bundled
software, and full ACL/guardrail/trace governance**. Operators can switch to a keyed API (Tavily /
Brave / Exa) or their own SearXNG. `web_fetch` is always on because it is our own MIT code (HTTP GET
→ text, no index, no discovery). Egress remains opt-in per agent via the default-off
`agent_orchestrator.web_search` ACL grant. This eliminates the AGPL distribution problem at the root
and sidesteps every provider's ToS/attribution clause (the *operator* accepts a provider's terms when
they add a key). See **Provider Licensing Pivot** and **Provider Menu & Model-Native Search** below.

## Decisions Locked (Open Questions gate — resolved 2026-07-11)

| # | Decision | Choice |
|---|----------|--------|
| Q1 | Provider | ~~SearXNG-first adapter~~ → **PIVOTED 2026-07-15: model-native default, bundle nothing.** `WebSearchProvider` interface + adapters; **default = model-native adapter (Flavor B)** — reuses the agent's LLM `web_search`, so search works with no separate vendor or bundled software, still governed. Operators may switch to keyed APIs (Tavily/Brave/Exa) or their own SearXNG (never shipped). `web_fetch` always on. See Provider Licensing Pivot. |
| Q2 | Scope | **Search + fetch** — both `web_search` (discovery) and `web_fetch` (retrieve one URL → readable text); fetch adds an SSRF surface to guardrail |
| Q3 | Placement | **Dedicated package(s)** — the `WebSearchProvider` interface + adapters live in provider package(s); `defineAiTool` wrappers live in `agent_orchestrator`. (Interface currently ships in `packages/search-provider-searxng`; the pivot extracts the interface + keyed/model adapters — see Pivot § Implementation delta.) |
| Q4/Q5 | Governance | **New ACL feature + permissive guardrails** — new grantable `agent_orchestrator.web_search` feature re-checked per MCP call; guardrails optional with sane permissive defaults (still SSRF-safe for fetch) |

## Provider Licensing Pivot (2026-07-15)

**Trigger.** SearXNG is **AGPL-3.0**. The team rejected it as the shipped default.

**Legal analysis (verified).** AGPL §13 ("remote network interaction") obliges whoever *modifies and
operates* the program to offer source to network users. Consequences:
- **Calling** a separately-deployed, unmodified SearXNG over HTTP from our MIT code is **not**
  contaminating — a REST client is not a derivative work; any source-offer duty falls on the
  *operator*, only if they modified it.
- **Bundling/shipping** a SearXNG container as the product default **is** the exposure — that is
  distribution of the AGPL work.
- Research finding: **there is no permissively-licensed (MIT/Apache/BSD) self-hostable web-metasearch
  engine** to switch to (the category — SearXNG/4get/LibreY — is AGPL; Whoogle is MIT but defunct;
  YaCy is GPL). Content-index engines (Meilisearch/Typesense/OpenSearch) index *your* data, not the
  public web, so they do not solve discovery.

**Decision.** **Bundle nothing; default to the model-native adapter (Flavor B).** Ship the interface
+ adapters, no provider container, no credentials. The **default provider is model-native** — our
`web_search` tool calls the agent's own LLM provider with its native `web_search` enabled, reusing
the LLM key the platform already holds. This gives out-of-box search with **no separate search
vendor, no AGPL software, and full governance** (the call still flows through our ACL/guardrails/
traces). When the agent's model does not support native `web_search`, the tool returns
`not_configured` so the agent degrades gracefully; operators then select a keyed provider or their
own SearXNG. Keep `web_fetch` always on (our MIT code, no provider dependency). Egress stays opt-in
per agent via the default-off `agent_orchestrator.web_search` ACL grant. Document SearXNG only as an
*optional, operator-supplied, never-bundled* self-host endpoint (calling it is non-contaminating).

**Implementation delta from Phases 1–3 (all additive / behavior-preserving):**
- Rename/repurpose `packages/search-provider-searxng` → the SearXNG adapter becomes **one optional
  adapter**, not the default. Extract the `WebSearchProvider` interface + shared bits (SSRF guard,
  HTML→text, errors) into a neutral home (e.g. `packages/web-search/` or keep the interface where it
  is and add sibling adapter packages). *(Naming finalized in the pivot phase below.)*
- Add a **Tavily** keyed adapter (reference default recommendation) and a **model-native adapter**
  (Option B — wraps the agent's LLM provider `web_search`, reusing the existing key).
- Change the DI default: `webSearchProvider` resolves from a **provider-selection config**
  (`OM_AGENT_WEB_SEARCH_PROVIDER` = `model` | `tavily` | `brave` | `exa` | `searxng` | `none`),
  **defaulting to `model`** (the model-native adapter). When the resolved agent model lacks native
  `web_search`, the adapter returns `not_configured`.
- `web_fetch` no longer depends on any provider being configured (it uses the built-in fetch path).

## Provider Menu & Model-Native Search

Three integration flavors sit behind the SAME `agent_orchestrator.web_search` ACL gate; all keep
`web_fetch` (ours) unchanged:

| Flavor | Mechanism | Governed by ACL + guardrails + traces? | Extra key/infra | When |
|--------|-----------|:--:|:--:|------|
| **A — Keyed search adapter** (Tavily / Brave / Exa) | Our MCP tool calls the search API server-side via a `WebSearchProvider` adapter | ✅ Yes | One search key | Dedicated, governed search; recommended keyed upgrade |
| **B — Model-search-as-adapter** ⭐ **DEFAULT** | A `WebSearchProvider` adapter makes a minimal call to the agent's LLM provider with its native `web_search` enabled, returns the results | ✅ Yes | None (reuses LLM key) | **Default** — no separate helper, no bundled software, keeps governance |
| **C — Pure model-native** | The LLM provider's `web_search` runs on the agent's own generation turns (enabled at model/loop config, not via our MCP tool) | ❌ **No** — runs on the vendor's infra, bypasses our MCP/ACL/guardrails/traces | None | Simplicity over control; opt-in, documented tradeoff |

**B is the DEFAULT provider.** It avoids a separate *search vendor* by reusing the LLM provider's
built-in search (`~$10/1k` on the existing Anthropic/OpenAI bill), yet every search still flows
through our `defineAiTool` → so ACL, domain allow/deny, rate limits, and trace rows all apply. It
needs no bundled software (no AGPL exposure) and no new key. **Fallback:** when the agent's resolved
model does not support native `web_search`, the adapter returns `not_configured` and the operator
selects a keyed provider (A). **C** is the lowest-effort but re-introduces the exact ungoverned-
egress posture this module was designed to avoid (it is why OpenCode's native `websearch` stays
disabled), and it only works on turns of that specific model — offer it only as a clearly-labeled
opt-in. Ship B (default) + A (keyed upgrades) as first-class adapters.

**Avoid as defaults:** Serper/SerpApi (active Google SERP-scraping litigation), Bing Web Search API
(retired Aug 2025), Google Custom Search (closed to new customers, sunset Jan 2027).

## Problem Statement

Deal-research file-agents cannot access current external information (company news, pricing pages,
public filings, competitor sites). The module's no-net invariant (AGENTS.md rule 5 / "Never";
SKILL.md Gate 3) blocks OpenCode's native web tools and sandbox net access — correctly, because
those paths bypass the per-run session-token ACL and the trace/audit surface that make these agents
enterprise-safe. We need a **governed egress path** that preserves propose-only, ACL, and trace
guarantees while giving research agents real web reach.

## Goals / Non-Goals

**Goals**
- Read-only `web_search` + `web_fetch` available to agents that explicitly opt in and are ACL-granted.
- Egress runs server-side through a **swappable provider**, **defaulting to the model-native adapter**
  (reuses the agent's LLM `web_search`); operators may switch to a keyed API or their own SearXNG.
  **No provider container or credential is bundled** in the product.
- `web_fetch` always works (our MIT code); `web_search` works out of the box via the model-native
  default and falls back to `not_configured` when the model lacks native search.
- Every call is ACL-checked per invocation and emits a trace row.
- Zero change to the sandbox no-net rule and zero change to the file-agent renderer/allowlist logic.

**Non-Goals**
- **Bundling/shipping any search provider** (no AGPL container, no default credentials) — see Pivot.
- Enabling OpenCode's native `websearch`/`webfetch` (explicitly stays disabled in `opencode.jsonc`).
- Allowing local `tools/*.ts` or skill scripts to reach the network (sandbox invariant unchanged).
- Mutation/write capability of any kind (`isMutation: false` only).
- A general-purpose crawler — `web_fetch` retrieves a single URL, bounded and guardrailed.

## Proposed Solution (Route B — chosen)

### Architecture overview

```
OpenCode file-agent  ──MCP──▶  open-mercato MCP server
  AGENT.md tools:                 │
    - agent_orchestrator.web_search│  per-call session-token ACL  (agent_orchestrator.web_search)
    - agent_orchestrator.web_fetch │  guardrails (domain/SSRF/caps/rate)
                                   │  trace row per call
                                   ▼
                        defineAiTool wrappers (agent_orchestrator)
                                   │  DI-resolved WebSearchProvider (operator-selected; default = none)
                                   ▼
        ┌──────────────────────────┼───────────────────────────┐
        ▼                          ▼                           ▼
  model-native adapter ⭐    Tavily / Brave / Exa        (optional) operator's own
  DEFAULT — reuses the      keyed API adapter           SearXNG over HTTP — never bundled
  agent's LLM key (B)       (A, keyed upgrade)          (A-variant)

  web_fetch: always on — built-in HTTP GET → text (our MIT code, no provider)
```

- The sandbox (`isolated-vm`) is **untouched** — the tool executes in the OM server process, which
  is already permitted network access. Local `tools/*.ts` still have no net.
- `defineFileAgent.ts` renderer + mirrored CLI `agent-files.ts` need **no change**: the new tools
  are ordinary `open-mercato_agent_orchestrator_*` MCP ids, so they flow through the existing
  allowlist union the moment an agent references them. (Verify, don't assume — see Phase 3.)
- `docker/opencode/opencode.jsonc` stays as-is: native `websearch`/`webfetch` remain disabled.

### `WebSearchProvider` interface (dedicated package)

`packages/search-provider-searxng` exports the interface and the SearXNG adapter (health check,
config, optional keyed adapters may live in sibling packages later).

> **Naming note (deliberate):** the package keeps the `search-provider-*` prefix to follow the root
> `AGENTS.md` external-provider convention, but the `WebSearchProvider` interface intentionally also
> exposes `fetch()` — the two are one governed-egress capability (see scope-cohesion verdict
> KEEP-AS-ONE). The name understates fetch on purpose rather than splitting the package; if a future
> provider only does one mode, it implements the other as an explicit "unsupported" error.

```ts
export interface WebSearchProvider {
  readonly id: string
  search(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]>
  fetch(url: string, opts: WebFetchOptions): Promise<WebFetchResult>
  healthCheck(): Promise<{ ok: boolean; detail?: string }>
}
```

Adapters behind this interface (post-pivot — none bundled/enabled by default):
- **Tavily (recommended default to document):** keyed API purpose-built for agents (returns cleaned,
  extracted content). Flavor A.
- **Brave / Exa (keyed alternatives):** Brave = independent crawler/index (no Google-scraping legal
  risk, needs an attribution string); Exa = semantic/neural index. Flavor A.
- **Model-native adapter:** wraps the agent's LLM provider `web_search` (Anthropic/OpenAI) — reuses
  the existing LLM key, no separate search vendor, still governed. Flavor B.
- **SearXNG adapter (optional, operator-supplied):** calls an operator's own instance's
  `/search?format=json`; base URL is an ops/env setting; no credentials. **Never bundled** — the
  container is not shipped; only the client adapter code remains.
- **`fetch` (all providers / provider-less):** retrieves the URL server-side, returns readable text
  (HTML→text), size-capped — implemented once in our code, independent of the search provider.
- API keys handled via the module encryption path (never plaintext), following the
  integration-provider credential pattern. Zod-validated inputs/outputs; TS types via `z.infer`. No `any`.

### `defineAiTool` wrappers (`agent_orchestrator`)

Two read-only tools registered in the module's ai-tools, resolving the provider via DI:

- `agent_orchestrator.web_search` — `{ query, limit? }` → `[{ title, url, snippet, score? }]`
- `agent_orchestrator.web_fetch` — `{ url }` → `{ url, title?, text }` (truncated to cap)

Both `isMutation: false` so `loadFileAgents` accepts them (the fail-closed mutating/unknown-tool
gate stays intact). Exposed automatically as `open-mercato_agent_orchestrator_web_search` /
`_web_fetch` on the existing MCP server.

### Access control (new ACL feature)

- New feature `agent_orchestrator.web_search` in the module `acl.ts`, **default-off**, separately
  grantable — a tenant/agent must be explicitly authorized for web egress.
- Re-checked on **every** MCP call via the existing per-run session-token ACL path (not just at
  agent load). Both `web_search` and `web_fetch` gate on this single feature in v1.
- **v1 tradeoff (explicit):** `web_fetch` carries the SSRF surface while `web_search` does not, yet
  both gate on one feature. This is a deliberate v1 simplification. A separate
  `agent_orchestrator.web_fetch` feature (so a tenant can grant search-only) is a low-risk additive
  follow-up if any deal needs that split — noted in Open Risks.

### Guardrails (permissive defaults, still SSRF-safe)

Config object with sane permissive defaults; each item overridable per tenant:
- **Domain allow/deny list** — default empty (allow all except deny defaults below).
- **SSRF protection (fetch, always-on, not overridable to off):** block private/loopback/link-local
  ranges, cloud metadata IPs (`169.254.169.254`), non-http(s) schemes; resolve-then-check to defeat
  DNS rebinding; cap redirects.
- **Result cap** — default max results (e.g. 10) and **response-size truncation** (e.g. 64 KB text).
- **Rate limit** — per-run and per-tenant query ceiling with a permissive default. **Counter state
  lives in the DI-resolved `@open-mercato/cache`**, tenant-scoped keys with a TTL matching the
  window (per-run counter keyed by run id; per-tenant counter keyed by tenant id). No new table.
- **Timeouts** — bounded request timeout per call.
> Permissive means *optional to tune*, not *unsafe*: SSRF and size/timeout caps are always enforced;
> domain lists and rate ceilings default permissive but present.

### Tracing

Every `web_search`/`web_fetch` invocation emits a trace row through the existing trace surface:
provider id, query or target URL, result count / bytes, latency, ACL decision, guardrail outcome.
Feeds the operations cockpit and evals like any other tool call.

## Affected Surfaces

- `packages/search-provider-searxng/` — **new package**: `WebSearchProvider` interface + SearXNG adapter + health check
- `packages/enterprise/src/modules/agent_orchestrator/`
  - `ai-tools.ts` — `web_search` + `web_fetch` `defineAiTool` wrappers (DI-resolved provider)
  - `acl.ts` — new `agent_orchestrator.web_search` feature
  - guardrail config + trace wiring
  - `di.ts` — register `WebSearchProvider` from `OM_AGENT_WEB_SEARCH_PROVIDER` selection (default `none`)
- `docker/opencode/opencode.jsonc` — **unchanged** (native web tools stay disabled; asserted by test)
- Ops: **no bundled provider**; operator picks a provider + supplies a key (Tavily/Brave/Exa) or uses
  the model-native adapter (existing LLM key), or points at their own SearXNG (never shipped). Keys
  encrypted.
- `apps/mercato/src/modules/agent_examples/agents/` — one opt-in demo agent declaring the tools
- Docs: module `AGENTS.md` + `om-create-opencode-agent` SKILL.md note the governed egress path and Ask-First history

## Backward Compatibility

- **Additive only.** New package, new ACL feature (default-off), two new MCP tool ids. No existing
  tool, renderer, or agent changes behavior.
- Agents without the ACL grant or without the `@ref` see no change — web tools simply aren't present.
- No contract surface removed; renderer allowlist logic untouched. No deprecation needed.
- **Ask-First record:** this relaxes the module's no-net posture at the *tool layer only*; the
  decision + rationale are recorded here and cross-linked from `AGENTS.md`.

## Phasing

### Phase 1 — Provider package
1. Scaffold `packages/search-provider-searxng` with `WebSearchProvider` interface, zod schemas, types.
2. SearXNG adapter: `search` (JSON API) + `fetch` (server-side retrieve → readable text, size-capped) + `healthCheck`.
3. Unit tests for adapter (mocked SearXNG), including malformed-response handling.

### Phase 2 — Tools + ACL + guardrails
4. `web_search` + `web_fetch` `defineAiTool` wrappers in `agent_orchestrator` (`isMutation: false`), DI-resolved provider.
5. New `agent_orchestrator.web_search` ACL feature (default-off); per-call re-check wired.
6. Guardrail layer: SSRF (always-on), domain allow/deny, result cap, size truncation, rate limit, timeout.
7. Trace emission per call.

### Phase 3 — Wiring, opt-in, verification
8. DI registration + config-based provider selection (SearXNG default; env base URL).
9. **Verify renderer/allowlist unchanged**: confirm `defineFileAgent.ts` + CLI `agent-files.ts` emit the new MCP ids with no code change; add regression assertion.
10. Example opt-in agent under `agent_examples` + `yarn generate` to re-emit artifacts.
11. Docs: module `AGENTS.md`, SKILL.md, ops note for SearXNG.

### Phase 4 — Integration tests (below)

### Phase 5 — Provider Licensing Pivot (2026-07-15, post-Phase-3)
12. **Model-native adapter (Flavor B) as the DEFAULT** — new adapter wraps the agent's resolved LLM provider `web_search` (reuses the existing LLM key); returns `not_configured` when the model lacks native search. Unit tests (mocked provider call).
13. **Extract the neutral interface** — move `WebSearchProvider` + shared SSRF/HTML→text/errors out of the SearXNG-named package into a neutral home so the default carries no AGPL association; SearXNG adapter kept as an optional sibling.
14. **Change DI provider selection** — `OM_AGENT_WEB_SEARCH_PROVIDER` (`model` default | `tavily` | `brave` | `exa` | `searxng` | `none`); demote SearXNG to one opt-in adapter, never the default.
15. **Tavily adapter** (Flavor A) — reference keyed upgrade; encrypted key config; unit tests (mocked API).
16. **Decouple `web_fetch`** from provider configuration — it uses the built-in fetch path regardless of the selected search provider.
17. **Docs** — provider menu + Flavor A/B/C tradeoff table in module AGENTS.md; "default = model-native; no provider bundled; SearXNG never shipped" note; env matrix (`OM_AGENT_WEB_SEARCH_PROVIDER` + per-provider keys).
18. Update integration tests: default (model-native) path stubbed; keyed-adapter path stubbed; assert `not_configured` fallback when the model lacks native search.

## Integration Test Coverage

Per-feature, self-contained (fixtures created in setup, cleaned in teardown; no seeded-data reliance):

- **ACL denial:** agent without `agent_orchestrator.web_search` → tool call rejected mid-run (per-call, not just load-time).
- **ACL grant:** granted agent → `web_search` returns provider results (SearXNG stubbed).
- **Guardrail — domain deny:** query/fetch to a denied domain rejected.
- **Guardrail — SSRF:** `web_fetch` to `169.254.169.254`, `localhost`, private ranges, and non-http scheme all blocked; DNS-rebinding case (public name → private IP) blocked.
- **Guardrail — caps:** result count capped; oversized response truncated to limit.
- **Guardrail — rate limit:** over-ceiling calls rejected within a run.
- **Trace emission:** one trace row per call with provider/query/result-metadata/ACL/guardrail outcome.
- **Propose-only preserved:** wrappers are `isMutation:false`; a mutating web tool would be rejected by `loadFileAgents` (regression guard).
- **Sandbox invariant intact:** local `tools/*.ts` still cannot reach net (regression guard).
- **Container config:** `docker/opencode/opencode.jsonc` asserts native `websearch`/`webfetch` remain disabled.
- **Provider health:** `healthCheck` failure surfaces a clean tool error, not a crash.

## Open Risks / Follow-ups

- **No default provider (by design):** `web_search` is disabled until an operator configures one;
  the tool returns `not_configured` and the agent must degrade gracefully (say so, return empty
  findings). Document the provider menu + env matrix. Any configured provider that is down surfaces a
  clean tool error, not an agent failure.
- **Model-native (Flavor C) governance gap:** pure provider-native search bypasses our ACL/guardrails/
  traces — only offer it as a labeled opt-in; prefer Flavor B (adapter) when governance matters.
- **`web_fetch` abuse surface:** even guardrailed, arbitrary-URL retrieval is the riskiest part;
  SSRF suite must be treated as security-critical (`risk-high`).
- **Per-tenant provider config** (keyed adapters, per-tenant SearXNG) — deferred to a follow-up if
  a deal needs it; interface already supports it.
- **Split ACL feature** (`agent_orchestrator.web_fetch` separate from `web_search`) — additive,
  low-risk follow-up if a tenant wants search-only grants (see Access control v1 tradeoff).
- **Content trust:** fetched/searched content enters the agent's context — note prompt-injection
  exposure; keep tools read-only and outcomes propose-only (already enforced).

## Data Model

No new database entities. State touched:
- **Rate-limit counters** — DI-resolved `@open-mercato/cache`, tenant-scoped keys with TTL (no table).
- **Guardrail config** — module config (per-tenant overridable); no schema migration.
- **Keyed-adapter credentials** (optional providers only) — stored via the module encryption path
  (`encryption.ts` map + `findWithDecryption`), never plaintext. SearXNG default needs none.

## API / Tool Contracts

MCP tools on the existing `open-mercato` server (zod-validated; types via `z.infer`):
- `open-mercato_agent_orchestrator_web_search` ← `{ query: string, limit?: number }`
  → `{ results: Array<{ title: string, url: string, snippet: string, score?: number }> }`
- `open-mercato_agent_orchestrator_web_fetch` ← `{ url: string }`
  → `{ url: string, title?: string, text: string, truncated: boolean }`
Both `isMutation: false`. Errors return clean tool errors (ACL-denied, guardrail-blocked,
provider-unhealthy, timeout) — never a crash.

## Final Compliance Report (to complete at implementation)

| MUST | Status |
|------|--------|
| Singular naming (tools, ACL feature, MCP ids) | ✅ planned |
| Zod validation + `z.infer` types, no `any` | ✅ planned |
| Encryption map for keyed-adapter credentials | ✅ planned (optional providers) |
| `apiCall`/DI (no raw `fetch` in app code; provider egress is server-side, isolated) | ✅ planned |
| DI-resolved cache (no raw Redis) | ✅ planned |
| No cross-module ORM; org/tenant scoping on all state | ✅ planned |
| Propose-only + sandbox no-net invariants preserved | ✅ planned (regression guards) |
| Integration tests per affected path | ✅ planned (matrix above) |

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Provider package | Done | 2026-07-11 | `packages/search-provider-searxng` scaffolded; SearXNG adapter (search/fetch/health) + always-on SSRF guard + HTML→text; 45 unit tests pass; typecheck + build green |
| Phase 2 — Tools + ACL + guardrails | Done | 2026-07-11 | `web_search`/`web_fetch` `defineAiTool`s (isMutation:false, `requiredFeatures:['agent_orchestrator.web_search']`) + default-off ACL feature + domain/rate guardrails + DI provider registration; 23 unit tests pass; enterprise typecheck + lint + generate green. Tracing is automatic (runner captures tool calls). |
| Phase 3 — Wiring, opt-in, verification | Done | 2026-07-11 | Renderer verified UNCHANGED (regression test + real generated artifact both emit `open-mercato_agent_orchestrator_web_{search,fetch}`); opt-in example agent `deal_web_researcher` added + `yarn generate` re-emitted `docker/opencode/agents/deals_web_researcher.md`; docs updated (module AGENTS.md Web Egress + rule-10 exception, om-create-opencode-agent SKILL.md). Full suite 317/317 green. |
| Phase 4 — Integration tests | Not Started | — | — |
| Phase 5 — Provider Licensing Pivot | Not Started | — | Default = model-native adapter (Flavor B); extract neutral interface, add Tavily keyed adapter, demote SearXNG to opt-in, decouple `web_fetch`, docs. See Pivot section. |

### Phase 1 — Detailed Progress
- [x] Step 1: Scaffold package (`package.json`, `tsconfig`, `build.mjs`, `watch.mjs`, `jest.config.cjs`) + `WebSearchProvider` interface + zod schemas (`types.ts`) + typed errors (`errors.ts`)
- [x] Step 2: SearXNG adapter (`searxng-provider.ts`) — `search` (JSON API, mapped + capped), `fetch` (SSRF-guarded, redirect-revalidated, byte-capped HTML→text), `healthCheck`; SSRF guard (`ssrf.ts`, resolve-then-check, IPv4/IPv6 private+metadata ranges); HTML→text extractor (`html-to-text.ts`)
- [x] Step 3: Unit tests (`__tests__/`) — 45 cases incl. malformed/non-JSON/shape-mismatch responses, SSRF blocks (literal + rebinding + redirect target), truncation, redirect follow, health states

### Phase 2 — Detailed Progress
- [x] Step 4: `web_search` + `web_fetch` `defineAiTool` wrappers (`lib/webSearch/webSearchTools.ts`, `isMutation:false`), DI-resolved provider; added to `ai-tools.ts` `aiTools` array
- [x] Step 5: New `agent_orchestrator.web_search` ACL feature (`acl.ts`, default-off, `dependsOn` agents.run); per-call re-check is the MCP server's declarative `requiredFeatures` gate — no handler assertion
- [x] Step 6: Guardrail layer (`lib/webSearch/config.ts` + `guardrails.ts`) — domain allow/deny (deny-wins, dot-boundary suffix), result/byte caps, per-run + per-tenant rate ceilings via canonical `rateLimiterService` (permissive when absent); always-on SSRF stays in the provider
- [x] Step 7: Trace emission — confirmed AUTOMATIC (the OpenCode runner captures every tool call into `AgentSpan`/`AgentToolCall` via `ingestTrace`); no per-tool code needed
- Wiring: `di.ts` registers `webSearchProvider` (SearXNG default from `OM_AGENT_WEB_SEARCH_*` env, null when unconfigured → `not_configured`); `packages/enterprise/package.json` deps + `jest.config.cjs` module map updated for the new package

### Phase 3 — Detailed Progress
- [x] Step 8: DI provider selection done in Phase 2 (`webSearchProvider` from `OM_AGENT_WEB_SEARCH_*` env, SearXNG default)
- [x] Step 9: **Renderer verified unchanged** — `renderOpenCodeAgentFile` unions `args.tools` with the core tool ids, so a declared `agent_orchestrator.web_search`/`web_fetch` emits `open-mercato_agent_orchestrator_web_{search,fetch}: true` with zero renderer edit. Proven two ways: regression test (`__tests__/webSearchRenderer.test.ts`, also pins the propose-only denies) AND the real generated `docker/opencode/agents/deals_web_researcher.md`. The CLI generator mirror (`agent-files.ts`) produced the same artifact during `yarn generate` — no code change there either.
- [x] Step 10: Opt-in example agent `apps/mercato/src/modules/agent_examples/agents/deal_web_researcher/` (AGENT.md declares the two tools + OUTCOME.md informative + SAMPLE.json); `yarn generate` re-emitted the manifest + docker artifact
- [x] Step 11: Docs — module `AGENTS.md` (new "Web Egress" section + env, rule-10 exception carve-out for egress features) and `om-create-opencode-agent` SKILL.md (web egress note)

Decisions honored: web egress lives ONLY in the centrally-registered, MCP/ACL-gated `defineAiTool` resolving its provider from DI (per the module's Ask-First rules) — the sandbox no-net rule and the renderer are untouched. Deliberate divergence from the `agents.run`-reuse convention: a dedicated default-off `web_search` feature gates network egress (admin/superadmin still receive it via the existing `agent_orchestrator.*` wildcard grant; narrower roles are intentionally excluded from `setup.ts`). Error `code`s are returned as data (not thrown/toast), so no i18n keys are required.

Notes: `tsconfig.json` sets `types: ["node"]` — this pure-lib package pulls no `@types/node` transitively (unlike sibling provider packages), so node builtins (`node:dns/promises`, `node:net`) need the explicit reference. Internal `WebSearchProviderError` messages stay developer-facing; Phase 2 maps error `code`s to user-facing i18n keys in the tool wrappers.

## Changelog

- 2026-07-11 — Initial draft. Route B (ACL-gated `defineAiTool` on existing MCP server) chosen over
  native OpenCode `websearch`/Exa/model-built-in. Open Questions resolved: SearXNG-first adapter,
  search + fetch, dedicated package, new ACL feature + permissive (SSRF-always-on) guardrails.
  Scope-cohesion review: KEEP-AS-ONE. Folded in rate-limit persistence (cache), ACL v1 tradeoff,
  provider-naming note, and Data Model / Tool Contract / Compliance sections.
- 2026-07-11 — Phases 1–3 implemented (SearXNG default). Provider package, ACL-gated tools,
  guardrails, renderer verification, example agent, docs.
- 2026-07-15 — **Provider Licensing Pivot.** SearXNG (AGPL-3.0) rejected as bundled default;
  verified that *calling* it over HTTP is non-contaminating but *shipping* the container is, and that
  no permissive self-hostable web-metasearch exists. Pivoted to **bundle-nothing** with the
  **model-native adapter (Flavor B) as the DEFAULT** (`OM_AGENT_WEB_SEARCH_PROVIDER=model`): search
  reuses the agent's own LLM `web_search` — no separate vendor, no bundled software, full
  ACL/guardrail/trace governance — and falls back to `not_configured` when the model lacks native
  search. Keyed adapters (Tavily/Brave/Exa) are opt-in upgrades; SearXNG demoted to an optional
  operator-supplied never-bundled adapter; `web_fetch` always on (our MIT code). Added Provider
  Licensing Pivot, Provider Menu & Model-Native Search (Flavors A/B/C), and Phase 5. Flavor C (pure
  native) remains ungoverned and opt-in only.
