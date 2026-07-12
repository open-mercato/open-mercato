# Web Search & Fetch Tools for File-Defined Agents (ACL-Gated MCP `defineAiTool`)

> Status: **DRAFT — full spec, Open Questions resolved**
> Scope: Enterprise (`packages/enterprise/src/modules/agent_orchestrator`)
> Date: 2026-07-11

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

**Provider strategy: SearXNG-first, adapter-based.** OpenCode's own "free" web search either hits
**Exa's public unauthenticated MCP** (native `websearch`) or delegates to the **model's built-in
search tool** (the `opencode-websearch` plugin) — both send queries to a third party and **bypass
the very ACL/trace guarantees this module exists to enforce**. Instead we define a small
`WebSearchProvider` interface in a dedicated package and ship **SearXNG** (self-hosted, AGPL-3.0, no
API keys, JSON output) as the default provider, so egress stays inside infrastructure we own. Keyed
providers (Exa/Tavily API) are optional drop-in adapters behind the same interface.

## Decisions Locked (Open Questions gate — resolved 2026-07-11)

| # | Decision | Choice |
|---|----------|--------|
| Q1 | Provider | **SearXNG-first adapter** — `WebSearchProvider` interface, SearXNG default, Exa/Tavily optional keyed adapters |
| Q2 | Scope | **Search + fetch** — both `web_search` (discovery) and `web_fetch` (retrieve one URL → readable text); fetch adds an SSRF surface to guardrail |
| Q3 | Placement | **Dedicated package** — `packages/search-provider-searxng` (adapter + interface), per root `AGENTS.md` external-provider rule; `defineAiTool` wrappers live in `agent_orchestrator` |
| Q4/Q5 | Governance | **New ACL feature + permissive guardrails** — new grantable `agent_orchestrator.web_search` feature re-checked per MCP call; guardrails optional with sane permissive defaults (still SSRF-safe for fetch) |

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
- Egress runs server-side through a provider we own by default (SearXNG); no third-party dependency required.
- Every call is ACL-checked per invocation and emits a trace row.
- Zero change to the sandbox no-net rule and zero change to the file-agent renderer/allowlist logic.

**Non-Goals**
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
                                   │  DI-resolved WebSearchProvider
                                   ▼
                 packages/search-provider-searxng  ──HTTP──▶  self-hosted SearXNG (JSON)
                 (optional keyed adapters: Exa / Tavily)
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

- **SearXNG adapter (default):** calls a configured instance's `/search?format=json`; base URL is an
  ops/env setting; no credentials. `fetch` retrieves the URL server-side and returns readable text
  (HTML→text), size-capped.
- **Keyed adapters (optional):** Exa / Tavily behind the same interface; API keys handled via the
  module encryption path (never plaintext), following the integration-provider credential pattern.
- Zod-validated inputs/outputs; TS types via `z.infer`. No `any`.

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
  - `di.ts` — register default `WebSearchProvider` (SearXNG), config-selected
- `docker/opencode/opencode.jsonc` — **unchanged** (native web tools stay disabled; asserted by test)
- Ops: self-hosted SearXNG container (JSON output enabled) + base-URL config; optional keyed-adapter creds (encrypted)
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

- **SearXNG ops dependency:** default provider needs a running instance; document deploy + health,
  and define behavior when it's down (clean tool error, not agent failure).
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
