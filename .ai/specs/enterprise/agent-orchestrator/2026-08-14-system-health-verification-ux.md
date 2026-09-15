# System Health — Verified on Entry, Honest in the Panel

**Date:** 2026-08-14 · **Status:** draft (ready to implement)
**Scope:** enterprise `agent_orchestrator`, plus an additive contract field in OSS `packages/web-research`
**Related:** [`../2026-07-11-agent-web-search-tool.md`](../2026-07-11-agent-web-search-tool.md) (adapter engine, cost model), [`2026-07-12-ux-data-honesty-pass.md`](./2026-07-12-ux-data-honesty-pass.md) (the "never claim a number you did not compute" rule this spec extends to health)

## TLDR

The Fleet Overview's **System health** tile can never turn green. Not because anything is broken — because it never checks. `SystemHealthTile.tsx:64-75` fetches `/api/agent_orchestrator/web-search/health` without `probe=1`, `systemHealth.ts:79` maps an unprobed answer to `unknown`, and `rollupHealth` is worst-of, so one permanently-`unknown` indicator pins the headline badge at **Not checked** while MCP, OpenCode and the OpenCode → MCP binding all report **Healthy**. The operator reads "Not checked" as "broken".

The no-probe rule is deliberate and correct: a live probe calls the adapter, and a metered source bills for it (`api/web-search/health/route.ts:51-56`). But it is applied with a blunt instrument. **The adapters' probes do not all cost money** — and the existing `capabilities.cost` field does not tell you which do, because it describes the cost of *searching*, not of *checking*:

| Adapter | `capabilities.cost` (search) | What `healthCheck()` actually does | Real probe cost |
|---|---|---|---|
| `model-native` | `llm-tokens` | resolves the model, loads tool descriptors (`web-research-model/src/adapter.ts:209-229`) | **free** — no completion is issued |
| `exa` | `metered` | tests `apiKey.length > 0` (`web-research-exa/src/adapter.ts:168-172`) | **free** |
| `searxng` | `free` | `GET {baseUrl}/healthz` (`web-research-searxng/src/adapter.ts:125-133`) | **free** — own infrastructure |
| `serp-html` | `free` | *no `healthCheck`* → engine returns `ok` (`engine.ts:555`) | **free** |
| `browser` | `metered` | spawns the sidecar, `ping` (`web-research-browser/src/adapter.ts:170-178`) | free in money, **costs a process** |
| `firecrawl` | `metered` | `POST /v1/search` with a real query (`web-research-firecrawl/src/adapter.ts:161-169`) | **billable** |
| `tavily` | `metered` | `POST /search` with a real query (`web-research-tavily/src/adapter.ts:109-124`) | **billable** |

Five of seven can be verified for free. In the reported installation the enabled set is `model-native, firecrawl` — so **one free probe would have proven web search works**, and the page instead reports nothing.

This spec introduces **probe cost** as a first-class, adapter-declared property distinct from search cost, auto-verifies everything free on page entry, serves billable results from a tenant-scoped TTL cache that only an explicit operator action ever populates, and rebuilds the `Details` panel that today truncates its own content.

**Invariant preserved without exception: a page view never initiates a billable call.**

## Problem statement

### 1. The tile reports readiness and the operator reads health

`deriveWebSearchIndicator` (`lib/systemHealth.ts:64-82`) is right to refuse to call an unprobed adapter healthy. The defect is that nothing ever probes. The result is a permanent `unknown`, and because `rollupHealth` (`:145-150`) takes the worst state over `SEVERITY = { ok: 0, unknown: 1, degraded: 2, down: 3 }`, the tile's headline badge is structurally incapable of reading `Healthy` on any installation with web search enabled. A status surface that has exactly one reachable value carries no information.

### 2. The `Details` panel does not fit its own content

Observed at `w-80` (320px, `SystemHealthTile.tsx:111`):

| Symptom | Cause |
|---|---|
| Every label and badge sits flush against the panel border | `PopoverContent` defaults to `p-0` (`packages/ui/src/primitives/popover.tsx:25`) — the primitive supplies no inset, so the panel body has to bring its own |
| `Not checked` wraps across two lines and shoves `model-native, firecrawl` into the label column | `<li>` is `flex … justify-between` with no column sizing and no `whitespace-nowrap` on the badge (`:131-140`) |
| `Installed but off: browser, searxng, serp-html, tavily, exa…` is clipped at the panel edge | `<p>` with no truncation, no `title`, no scroll container (`:163-169`) |
| Panel overlaps the neighbouring KPI card | 320px popover anchored `align="start"` in a three-column KPI grid |
| A failed fetch is indistinguishable from "not checked" | both `.catch(() => null)` paths land in the same `unknown` verdict (`:65-73`) |
| No answer to "how old is this?" | `checkedAt` is returned by the route (`route.ts:100`) and dropped by the client |
| Runtime dependencies and web-search adapters read as one flat list | no section headings between the two `<ul>`s (`:129`, `:146`) |

### 3. Two health vocabularies in one module

`/backend/settings/web-search` says `Not tested` / `Healthy` / `Problem` (`i18n/en.json` → `settings.webSearch.health*`, rendered in `AdapterRow.tsx:232-246`); the overview says `Not checked` / `Healthy` / `Degraded` / `Down` (`overview.health.state.*`). Same underlying facts, two spellings, two sets of colour decisions, in five locales.

## Design

### 3.1 Probe cost is a property of the probe, not of the search

Add one **optional** field to the adapter contract:

```ts
// packages/web-research/src/contract/adapter.ts
/**
 * What calling `healthCheck()` costs. Distinct from `capabilities.cost`, which
 * prices a search: Exa's probe reads a local key, Firecrawl's issues a billable
 * query, and the browser tier's spawns a process. A status surface may run the
 * free ones unattended and may not run the others.
 */
export type ProbeCost = 'free' | 'heavy' | 'billable'

export interface SearchAdapter {
  // …
  /** Defaults to `billable` for a metered adapter, `free` otherwise. */
  readonly probeCost?: ProbeCost
}
```

Optional, with a **conservative default derivation** in the engine — `capabilities.cost === 'metered' ? 'billable' : 'free'` — so a third-party adapter that never declares it is treated as billable and is never auto-probed. First-party adapters declare it explicitly:

| Adapter | `probeCost` | Rationale |
|---|---|---|
| `model-native` | `free` | resolves config only; no completion issued |
| `exa` | `free` | inspects the configured key |
| `searxng` | `free` | `/healthz` on infrastructure the tenant owns |
| `serp-html` | `free` | no probe exists to pay for |
| `browser` | `heavy` | spawns and disposes an OS process |
| `firecrawl` | `billable` | real `/v1/search` call |
| `tavily` | `billable` | real `/search` call |

`heavy` is its own tier because the trade-off differs: nothing is billed, but running it on every page view of every operator would spawn a sidecar per view. It is auto-probed only when the operator's own action asks for it, and cached like a billable one.

### 3.2 Engine: a probe budget instead of a boolean

`HealthOptions.probe?: boolean` stays exactly as it is (the settings page and every existing caller keep their behaviour). One additive option joins it:

```ts
// packages/web-research/src/engine/types.ts
export type HealthOptions = RunOptions & {
  readonly probe?: boolean
  /** Ceiling on what may be spent probing. Ignored when `probe` is false. */
  readonly maxProbeCost?: ProbeCost   // 'free' | 'heavy' | 'billable'; default 'billable' = today's behaviour
}
```

`health()` skips any adapter whose `probeCost` exceeds the ceiling and reports it as `probed: false` — the same shape the route already produces, so no consumer sees a new state machine. `AdapterHealthReport` gains `probeCost` and `probed` so the API can explain *why* a row was not checked.

### 3.3 API: three probe modes, one of which is new

`GET /api/agent_orchestrator/web-search/health?probe=<mode>`

| Mode | Who calls it | Required feature | Behaviour |
|---|---|---|---|
| absent / `0` | unchanged callers | `agent_orchestrator.proposals.view` | readiness only — today's default, byte-identical response shape |
| `auto` | **new** — the overview tile on mount | `agent_orchestrator.proposals.view` | probes every `free` adapter live; `heavy` and `billable` rows are served from the tenant cache when fresh, otherwise returned `probed: false, checkedAt: null` |
| `1` | settings page *Recheck*, panel *Recheck* and per-row *Test* | **`agent_orchestrator.agents.manage`** | probes everything live and **writes** every result into the cache; reuses a fresh cached row unless `force=1` |

**The billable mode needs its own gate.** Today the whole route sits behind
`agent_orchestrator.proposals.view` (`route.ts:19`) while the settings page that owns
the only existing *Recheck* sits behind `agent_orchestrator.agents.view`
(`backend/settings/web-search/page.meta.ts:16`). Moving a probe button onto the
Overview would put the ability to spend the tenant's Firecrawl and Tavily credits one
click away from every proposal reviewer. `probe=1` therefore requires
`agent_orchestrator.agents.manage` (already declared, `acl.ts:12-17`); the route
returns 403 without it, and the panel hides the *Test* and *Recheck* controls rather
than offering a button that will fail. Reading health stays on `proposals.view`, so no
reviewer loses visibility.

**Spending is bounded three ways**, because a paid endpoint with an unlimited button
is a self-inflicted cost incident and the module has no rate-limit precedent to lean on:

1. **The cache is the rate limit.** `probe=1` reuses a cached row that is still within
   TTL and only calls the adapter when the entry is missing, expired, or the caller
   passes `force=1`. `force=1` additionally requires a row older than a 30-second floor,
   so holding the button down cannot bill in a loop.
2. **One flight per tenant.** Concurrent `probe=1` calls for the same tenant collapse
   onto a single in-flight probe keyed on the cache key, and late callers await its
   result — reusing the engine's existing `singleFlight` helper (`engine.ts:535`). Two
   operators clicking *Recheck* together spend one credit and spawn one browser sidecar,
   not two.
3. **The control disables itself.** *Recheck* and per-row *Test* are disabled while a
   probe is in flight and until the row's `checkedAt` passes the 30-second floor.

The cache is the DI `cache` service, resolved exactly as `lib/webSearch/registry.ts:55-63` already does it, and degrading to "no cache" the same way when the container has none:

- key `agent_orchestrator:health:web_search:v1:<tenantId ?? 'global'>:<adapterId>`
- value `{ ok, detail, latencyMs, probeCost, checkedAt }` — the row's age is read from
  the cached `checkedAt`, never from the response envelope, so a reused row always
  displays its own age rather than the age of the request that returned it
- tag `agent_orchestrator:health:<tenantId ?? 'global'>` — so a settings save can invalidate health with `deleteByTags`
- TTL from `OM_AGENT_HEALTH_PROBE_TTL_MS`, default **600000** (10 min)
- **written only by `probe=1`**; `probe=auto` reads and never writes a billable row
- **no cache registered** — `registry.ts:55-63` degrades to `null` and this path does
  the same: billable and heavy rows then report unverified on every `auto` request,
  indefinitely. A missing cache must never be treated as licence to probe them.

That asymmetry is the whole safety argument. An operator who clicks *Recheck* once spends one credit and every colleague's overview shows that verified result for ten minutes. Nobody's page load ever spends anything.

Response gains `probeCost` and per-row `checkedAt` (additive; `adapters[]`, `problems[]`, `status`, `probed`, `checkedAt` keep their meaning, so `backend/settings/web-search/page.tsx:381-390` is unaffected).

### 3.4 Verdict logic: how green becomes reachable honestly

`deriveWebSearchIndicator` gains one rule — *a racing engine needs one working adapter, not all of them*:

| Enabled adapters | Verdict | Detail line |
|---|---|---|
| ≥1 verified `ok`, none verified failing | `ok` | verified ids; unverified billable ids noted as *not verified* |
| ≥1 verified failing, ≥1 verified `ok` | `degraded` | failing ids |
| all verified failing | `down` | failing ids |
| none verifiable (all billable and uncached) | `unknown` | *"needs a manual check"* |
| none enabled (`not_configured`) | `unknown` | unchanged — a deliberate non-configuration is not a fault |

Under the reported installation (`model-native` free-verified `ok`, `firecrawl` billable-unverified) the indicator is **`ok`** and the tile headline goes green, while the panel still says plainly that Firecrawl was not verified. The claim "web search works" is true and is backed by an actual call.

The roll-up **rule** is unchanged — worst-of stays, and the green comes from the verdict
rather than from a softened roll-up. Its **scale** does change, because a new state
joins the union:

```ts
// lib/systemHealth.ts — both must change together
export type HealthState = 'ok' | 'unknown' | 'degraded' | 'down' | 'error'
const SEVERITY: Record<HealthState, number> =
  { ok: 0, unknown: 1, degraded: 2, down: 3, error: 4 }
```

`error` means **the health surface itself could not answer** — the fetch rejected, or the
route returned a shape that fails the type guard — as opposed to `unknown`, which means
"we chose not to check". It ranks above `down` deliberately: a dependency known to be
dead is a smaller problem than a page that cannot see whether anything is alive, and the
operator's next action differs (fix the dependency vs. fix the health path).

Because `SEVERITY` is a total `Record<HealthState, number>`, extending the union without
extending the map is not a style question: it either fails to typecheck or, if widened,
yields `SEVERITY['error'] === undefined`, and `undefined > n` is always false — the
roll-up would silently swallow exactly the state it was added to surface. The
implementation MUST change both in one edit, and the unit suite MUST pin
`rollupHealth(['ok', 'error']) === 'error'`.

`down` also becomes reachable for web search for the first time. In the panel, `error`
renders an `Alert`, not a grey dot.

### 3.5 One health vocabulary, one shared panel

New `components/health/`:

| File | Contents |
|---|---|
| `HealthStateBadge.tsx` | the single `StatusBadge` mapping for `ok / degraded / down / unknown / error` |
| `HealthRow.tsx` | label · detail · age · badge, with the column sizing the current `<li>` lacks |
| `SystemHealthPanel.tsx` | the sectioned panel body, rendered inside the tile's popover |
| `vocabulary.ts` | `HealthState → i18n key`, used by the tile **and** by `backend/settings/web-search/AdapterRow.tsx` |

Settings adopts `HealthStateBadge` + `vocabulary.ts`; its `Not tested` becomes the shared `Not checked`, and its `Problem` becomes `Degraded`/`Down` by the same rule as the overview. Old keys (`settings.webSearch.healthOk|healthProblem|healthUntested`) are retained for one minor and marked `@deprecated` in the locale files' companion comment block, per `BACKWARD_COMPATIBILITY.md` — locale keys are consumed by downstream overlay locales.

**Panel layout** (DS-compliant — semantic tokens only, Tailwind scale only, no arbitrary values):

```
┌──────────────────────────────────────────────┐  w-96, max-h-[…] via max-h-96 on the
│ System health              ⟳ Recheck         │  scroll region, not the panel
├──────────────────────────────────────────────┤
│ RUNTIME                                      │  section label, text-xs uppercase muted
│ MCP server            83 tools   ● Healthy   │  badge column fixed, whitespace-nowrap
│ OpenCode              1.18.3     ● Healthy   │
│ OpenCode → MCP                   ● Healthy   │
├──────────────────────────────────────────────┤
│ WEB SEARCH                       ● Healthy   │
│ model-native          412ms      ● OK        │  verified free, checked on entry
│ firecrawl             not verified   [Test]  │  billable — explicit spend, per row
│ Installed but off: browser, searxng, …       │  truncate + title, never clipped
├──────────────────────────────────────────────┤
│ Checked 12s ago                              │
└──────────────────────────────────────────────┘
```

Rules the implementation must hold: `bg-status-success-*` / `text-status-success-text` for green (never `bg-green-*`), no `dark:` overrides on status tokens, lucide icons only, `aria-label` on the icon-only *Recheck*, the per-row *Test* is a real labelled button, `role="status"` on the region that changes after a probe, and the sr-only state text on the tile's four dots is preserved.

### 3.6 Frontend architecture contract

| Concern | Decision |
|---|---|
| Server/Client boundary | `backend/overview/page.tsx` unchanged; `SystemHealthTile` stays the only client entry |
| `"use client"` ledger | `SystemHealthTile.tsx` (existing), `components/health/*.tsx` (new — they hold state and handlers). `vocabulary.ts` and `lib/systemHealth.ts` are **not** client files and must not import React |
| Client blob | net ≈ +3 KB gzipped; no new dependency, no new provider, no new context |
| Bootstrap scope | none — the tile self-fetches on mount as today |
| Budgets | `probe=auto` must return in < 2 s p95 with free adapters only (`HEALTH_TIMEOUT_MS` already bounds each adapter); the tile renders its skeleton immediately and never blocks the KPI row |
| Evidence before merge | Playwright timing assertion on `/backend/overview` first paint, plus the network assertion in §5 that no billable host is contacted |

## Phasing

### Phase 1 — Honest panel, one vocabulary (UI only, no probe change)

Ships alone and is useful alone: the panel stops truncating and the two vocabularies merge, while the data contract stays exactly as it is today.

| Step | Work | Done when |
|---|---|---|
| 1.1 | `components/health/` — `vocabulary.ts`, `HealthStateBadge.tsx`, `HealthRow.tsx` | unit test pins one badge variant per state; no React import in `vocabulary.ts` |
| 1.2 | `SystemHealthPanel.tsx` — sections, `w-96`, scroll region, `checkedAt` age, truncation with `title` | panel renders the longest real string set (7 adapter ids + problems) with no clipping at 1280×800 |
| 1.3 | Distinct `error` state for a failed fetch; `Alert` instead of a grey dot | unit test: fetch rejection ⇒ `error`, not `unknown` |
| 1.4 | `SystemHealthTile.tsx` consumes the panel; Boy Scout pass on every touched line | no hardcoded colour or arbitrary value remains in the file |
| 1.5 | `AdapterRow.tsx` adopts the shared badge + vocabulary; old keys deprecated, not deleted | settings and overview show the same word for the same state |
| 1.6 | i18n for all five locales (`en`, `pl`, `de`, `es`, `ko`) | `yarn i18n:check-values` reports no new gaps |

### Phase 2 — Verified on entry

| Step | Work | Done when |
|---|---|---|
| 2.1 | `ProbeCost` + optional `SearchAdapter.probeCost` in `packages/web-research` contract | typecheck passes with no adapter changed (default derivation covers them) |
| 2.2 | Declare `probeCost` on the seven first-party adapters | table in §3.1 matches the code |
| 2.3 | `maxProbeCost` in `engine.health()`; `probeCost`/`probed` on `AdapterHealthReport` | engine unit test: `maxProbeCost: 'free'` never calls a billable adapter's `healthCheck` |
| 2.4 | `probe=auto` in the route + tenant-scoped TTL cache (read on `auto`, write on `1`); extend the route's zod `healthSchema` and its `openApi` doc with `probeCost` / per-row `checkedAt` and the new `probe` mode | `TC-AGENT-HEALTH-002`: `auto` on a cold cache issues zero billable calls and returns `probed: false` for those rows; `/backend/api-docs` renders the new fields |
| 2.5 | Split the route gate — `probe=1` requires `agent_orchestrator.agents.manage`, everything else keeps `proposals.view`; **hide** *Recheck* on `backend/settings/web-search/page.tsx` and the panel's *Test* when the feature is absent | `TC-AGENT-HEALTH-005`: reviewer-only principal gets 200 on `auto`, 403 on `probe=1`, and sees no probe control |
| 2.6 | Spend controls: cache-as-rate-limit with the 30-second `force=1` floor, per-tenant single-flight on `probe=1`, controls disabled while in flight | `TC-AGENT-HEALTH-003`: a second `probe=1` inside the floor makes no adapter call; a unit test proves two concurrent calls collapse to one `healthCheck` |
| 2.7 | New verdict rules in `lib/systemHealth.ts` (§3.4), **including `HealthState` and `SEVERITY` extended in the same edit** | unit tests for all five rows of the verdict table plus `rollupHealth(['ok','error']) === 'error'` |
| 2.8 | Tile calls `probe=auto` on mount; panel gains per-row *Test* for billable rows | Overview shows a green headline on an installation with one healthy free adapter |
| 2.9 | Settings save invalidates the health cache by tag (`deleteByTags(['agent_orchestrator:health:<tenant>'])`) | changing the enabled set does not serve a stale verdict |
| 2.10 | Document `OM_AGENT_HEALTH_PROBE_TTL_MS` in `apps/mercato/.env.example` **and** mirror it into `packages/create-app/template/.env.example` | root `AGENTS.md` → Template Sync Checklist satisfied |

## Testing

**Unit**

| Suite | Coverage |
|---|---|
| `packages/enterprise/.../__tests__/system-health.test.ts` | every verdict row in §3.4; `error` ≠ `unknown`; `rollupHealth(['ok','error']) === 'error'` (the `SEVERITY` pin); `not_configured` still not a fault |
| `packages/web-research` | default `probeCost` derivation (`metered` ⇒ `billable`, else `free`); `maxProbeCost: 'free'` never calls a billable adapter's `healthCheck`; `dispose()` still runs in `finally` on every path |

**Integration** — Playwright specs live in
`packages/enterprise/src/modules/agent_orchestrator/__integration__/`, registered through
its `meta.ts`, which already declares `requiredEnvVars: ['OM_ENABLE_ENTERPRISE_MODULES_AGENTS']`
so discovery **skips** them when the module is not enabled instead of failing with 404s
that read as product bugs. Follow `TC-AGENT-HONESTY-001.spec.ts`'s header convention:
case id, back-reference to this spec and section, and the defect the case pins.

| Case | Asserts |
|---|---|
| `TC-AGENT-HEALTH-001` | `GET …/web-search/health` with no param still reports configuration only — `probed: false` on the envelope and on every row, `checkedAt: null` per row, `probeCost` present; plus 401 for an unauthenticated caller |
| `TC-AGENT-HEALTH-002` | `?probe=auto` marks a row `probed` only when its `probeCost` is `free`; nothing heavy or billable is ever called unattended; `model-native`, when configured, comes back verified with a timestamp |
| `TC-AGENT-HEALTH-003` | a fixture principal holding `agent_orchestrator.proposals.view` but not `agents.manage` gets 200 on readiness and on `auto`, and **403** on `probe=1` and on the per-adapter `probe=1&adapter=…` |
| `TC-AGENT-HEALTH-004` | `/backend/overview` → the panel opens, the Runtime section renders, no element inside it overflows its column without a scroll container, and `Escape` closes it |

**Where the spend rules are tested, and why not end-to-end.** The TTL reuse, the
30-second `force` floor and the targeted-adapter narrowing are pinned in
`__tests__/health-probe-plan.test.ts` against the pure `selectProbeTargets`,
not in Playwright. Asserting them through HTTP would require a configured
billable adapter in the test environment — that is, a suite that spends real
money to prove it does not spend money. The pure function is the whole decision,
so testing it there is both cheaper and stricter.

**Fixtures** — self-contained per `.ai/qa/AGENTS.md`: a stub adapter registered through
the loader registry (`packages/web-research/src/loader/registry.ts`) in test setup,
declaring a known `probeCost` and counting its own `healthCheck` calls, so "zero billable
calls" is asserted on a counter rather than on a network mock. No real Firecrawl or
Tavily key is ever required. Registry entries and any seeded cache keys are removed in
`finally`.

## Migration & Backward Compatibility

| Surface | Change | Classification |
|---|---|---|
| `SearchAdapter.probeCost` | new **optional** field with a conservative default | ADDITIVE-ONLY — a third-party adapter compiles and behaves unchanged (and is never auto-probed) |
| `HealthOptions.maxProbeCost` | new optional option, default = today's behaviour | ADDITIVE-ONLY |
| `AdapterHealthReport` | `+probeCost`, `+probed` | ADDITIVE-ONLY |
| `GET …/web-search/health` | `probe=auto` added; absent/`0`/`1` byte-compatible | ADDITIVE-ONLY |
| `settings.webSearch.health*` i18n keys | superseded by the shared vocabulary; retained ≥1 minor with `@deprecated` | Deprecation protocol, step 3 (bridge) |
| `HealthState` / `SEVERITY` (`lib/systemHealth.ts`) | union and severity map both gain `error` | Module-internal — two consumers, both in-module (the tile and its unit suite); no published surface. Must change together (§3.4) |
| `probe=1` authorization | **tightened** from `agent_orchestrator.proposals.view` to `agent_orchestrator.agents.manage` | **Behaviour change, deliberate.** `setup.ts:66-89` grants `employee` and `operator` `agents.view` + `proposals.view` but not `agents.manage`, so those roles lose the settings page's *Recheck*. That is the point — the button spends tenant money and neither role is a settings persona. They keep every read path, including `auto`. Call it out in `UPGRADE_NOTES.md`; a tenant that wants the old reach grants `agents.manage` explicitly |
| `contractVersion` | **not** bumped — nothing required changes shape | — |

No database change, no new entity, no migration, and no new ACL feature ID: the tightened
gate reuses `agent_orchestrator.agents.manage`, which already exists (`acl.ts:12-17`) and
is already granted to `admin`, `superadmin` and `engineer`.

## Risks

| Risk | Mitigation |
|---|---|
| A third-party adapter's `healthCheck` bills despite `capabilities.cost !== 'metered'` | default derivation is conservative only for `metered`; document `probeCost` as **required for any adapter whose probe costs money** in `packages/web-research`'s AGENTS.md and in the adapter-authoring skill |
| Cached billable verdict outlives a revoked API key | TTL is 10 min and the tag is invalidated on settings save; the row always shows its age |
| `heavy` (browser) probe spawned by many operators at once | never auto-probed; `probe=1` is restricted to `agents.manage`, collapsed by the per-tenant single-flight (§3.3), and disposes in `finally` (`route.ts:66-73`) |
| An operator holds down *Recheck* and bills once per click | the 30-second `force=1` floor and the in-flight disable (§3.3) make the second click a cache read |
| Green headline while an unverified billable adapter is actually down | the racing engine only needs one working adapter, and the panel names every unverified row — the tile claims what it checked, never more |

## Open Questions

None — resolved 2026-08-14: probe-cost classification with a TTL cache for billable adapters; one spec in two phases; the four existing indicators (no queue/event-bus/LLM expansion); shared panel and vocabulary with the web-search settings page.

## Implementation Status

| Phase | Status | Date | Notes |
|---|---|---|---|
| Phase 1 — Honest panel, one vocabulary | Done | 2026-08-14 | Shared `components/health/*`, `error` state, settings row migrated, 14 keys × 5 locales |
| Phase 2 — Verified on entry | Done | 2026-08-14 | `probeCost` contract, probe budget, `probe=auto`, TTL cache, split gate, spend controls |

### Phase 1 — detailed progress

- [x] 1.1 `components/health/vocabulary.ts` (React-free), `HealthStateBadge.tsx`, `HealthRow.tsx`
- [x] 1.2 `SystemHealthPanel.tsx` — sections, `w-96`, `max-h-96` scroll region, per-row age, truncation with `title`
- [x] 1.3 `error` state distinct from `unknown`, rendered as an `Alert`
- [x] 1.4 `SystemHealthTile.tsx` consumes the panel; Boy Scout pass (icon-only control moved to `IconButton`, `type="button"` added)
- [x] 1.5 `AdapterRow.tsx` adopts the shared badge and vocabulary; its exported `AdapterHealth` type kept and widened
- [x] 1.6 `agent_orchestrator.health.*` in en/pl/de/es/ko — `yarn i18n:check-sync` reports all five in sync

### Phase 2 — detailed progress

- [x] 2.1 `ProbeCost` + optional `SearchAdapter.probeCost` in `packages/web-research`
- [x] 2.2 Declared on all seven first-party adapters, matching the §3.1 table
- [x] 2.3 `maxProbeCost` + `only` in `engine.health()`; `probeCost`/`probed` on `AdapterHealthReport`
- [x] 2.4 `probe=auto`, tenant-scoped TTL cache (`lib/webSearch/healthCache.ts`), zod + `openApi` updated
- [x] 2.5 `probe=1` gated on `agents.manage`; *Recheck* hidden on the settings page and in the panel without it
- [x] 2.6 Spend controls: cache-as-rate-limit, 30 s `force` floor, per-tenant single-flight, controls disabled in flight
- [x] 2.7 `HealthState` and `SEVERITY` extended together; verdict rules per §3.4
- [x] 2.8 Tile calls `probe=auto` on mount; per-row *Test* for costly adapters
- [x] 2.9 Settings save invalidates the health cache by tag
- [x] 2.10 `OM_AGENT_HEALTH_PROBE_TTL_MS` documented in `apps/mercato/.env.example` — see deviation below

### Deviations from the plan as written

1. **Template sync skipped, deliberately.** `packages/create-app/template/.env.example` carries **no** `agent_orchestrator` variable — not `OM_OPENCODE_*`, not `OM_AGENT_ARTIFACT_*`, not `OM_WEB_SEARCH_*` — because the module is enterprise and is not part of the OSS template. Adding this one var alone would be the only enterprise entry in that file. The root Template Sync Checklist is about app-shell parity; this stays with its siblings instead.
2. **Two helpers extracted that the plan did not name.** `lib/webSearch/healthProbePlan.ts` (pure spend decision) and `lib/webSearch/healthCache.ts` (keys, TTL, read/write, tag invalidation). The first exists so the rule that governs spending is testable without a billable adapter; the second so the health route and the settings route share one cache contract.
3. **The cache/floor case moved from Playwright to unit tests** — rationale in the Testing section.

## Final Compliance Report

| MUST | Verdict |
|---|---|
| Semantic status tokens, no raw Tailwind shades, no `dark:` on status tokens | §3.5 mandates `status-success-*`; Boy Scout pass on `SystemHealthTile.tsx` in Step 1.4 |
| Tailwind scale only, no arbitrary values | `w-96`, `max-h-96`, `text-xs`, `text-overline` — all on-scale |
| Shared DS primitives | `StatusBadge` (all five variants exist), `Alert`, lucide icons, `aria-label` on icon-only *Recheck* |
| `apiCall`, never raw `fetch` | unchanged from today's tile |
| zod on API inputs + OpenAPI doc updated | Step 2.4 |
| Per-method route `metadata` for auth | preserved; the split gate is expressed there (Step 2.5) |
| ACL: no new feature ID, no wildcard assumption | reuses `agent_orchestrator.agents.manage` |
| Tenant scoping | cache key and tag both carry `tenantId`; no cross-tenant read path |
| Encryption maps | **N/A** — no PII, no credential, no persisted column |
| Cache via DI, tagged invalidation | §3.3 + Step 2.9 |
| i18n, five locales in lockstep | Step 1.6 |
| Events for cross-module side effects | **N/A** — nothing leaves the module |
| Commands / undo | **N/A** — read-only surface |
| Integration coverage shipped in the same change | `TC-AGENT-HEALTH-001…005` |
| BC: additive-only, deprecation bridges, documented behaviour change | Migration section, incl. the `probe=1` gate tightening |

## Changelog

| Date | Change |
|---|---|
| 2026-08-14 | Spec drafted; Open Questions gate resolved (probe-cost + TTL cache, one spec two phases, four indicators, shared panel) |
| 2026-08-14 | Pre-implementation audit applied: `SEVERITY`/`HealthState` correction, split authorization gate, three spend controls, cache value shape and no-cache rule, integration tests relocated to `__integration__`, env-var template-sync step |
| 2026-08-14 | Both phases implemented. Gate: `yarn typecheck` (30/30), `yarn build:packages` (30/30), `yarn i18n:check-sync` (5 locales in sync), `@open-mercato/enterprise` 1731 tests and `@open-mercato/web-research` 172 tests green. One defect caught in self-review and fixed before it shipped: a caller denied `ai_assistant.view` would have seen the runtime dots turn red — 401/403 now resolves to `unknown`, not `error` |
| 2026-08-15 | Panel padding fix: `SystemHealthPanel` carries its own `p-4`, because `PopoverContent` is `p-0` by default and the body was rendering flush to the border. `TC-AGENT-HEALTH-004` gained a computed-padding assertion so the inset cannot be stripped silently again; re-run green (panel padding measured 16px) |
| 2026-08-14 | `TC-AGENT-HEALTH-001…004` executed against a live app — 6/6 passing. Live payload on the reported installation (`model-native` + `firecrawl` enabled) confirms the fix end to end: `probe=auto` returns `model-native` `probed: true` and `firecrawl` `probed: false`, so the headline reaches `ok` while the panel still names Firecrawl unverified, and the default readiness mode still reports every row `probed: false`. Runner note: spec discovery is gated on `OM_ENABLE_ENTERPRISE_MODULES_AGENTS` being present in the **shell** env — without it Playwright reports "No tests found" rather than skipping |

## Audit trail

Pre-implementation analysis: [`.ai/specs/analysis/ANALYSIS-2026-08-14-system-health-verification-ux.md`](../../analysis/ANALYSIS-2026-08-14-system-health-verification-ux.md) (2026-08-14).

Applied to this spec from that audit: the `SEVERITY` / `HealthState` correction (§3.4),
the split authorization gate (§3.3), the three spend controls (§3.3), the cache value
shape and no-cache degradation rule (§3.3), the integration-test relocation to
`__integration__/TC-AGENT-HEALTH-00x` (Testing), and the env-var template-sync step (2.10).

Still open from that audit, to close as the work lands: the `AdapterHealth` re-export
bridge for `AdapterRow.tsx` (BC-2), the top-level `probed` semantics under `auto` (BC-3),
`probeCost` documentation in `packages/web-research/AGENTS.md`, and this spec's
`## Changelog` section.
