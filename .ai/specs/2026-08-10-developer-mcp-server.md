# Developer MCP Server — Local Introspection Tools for Coding Agents

> Status: **DRAFT — ready for review** (Open Questions gate cleared 2026-08-10)
> Scope: OSS — developer tooling (DX), no business behavior
> Date: 2026-08-10

## 📝 TLDR

A dedicated, **dev-only MCP server**, separate from the production MCP server the in-app AI
assistant uses, that hands a coding agent (Claude Code, or any MCP-capable coding tool working
on this repo) live, structured facts about the app's own composition — which events exist,
which ACL features gate what, which DI keys are resolvable, which widget spots are available —
so generated code integrates correctly on the first pass instead of by grepping generated
registries by hand. It reuses the existing `mcp-dev-server.ts` transport pattern and, once
available, the Platform Map introspection core. It never runs in production, never requires an
API key (loopback-only), and ships its scaffolding independently of the data it will eventually
serve.

## Resolved assumptions (from the Open Questions gate, 2026-08-10)

| # | Question | Answer |
|---|---|---|
| Q1 | Where does the code live? | **New module `packages/core/src/modules/dev_mcp/`** — isolates dev-only tooling from `ai_assistant`'s production release surface. Depends on `@open-mercato/ai-assistant` (MCP SDK re-exports, tool-registry read access) and, from Phase A, `@open-mercato/shared`'s introspection core. |
| Q2 | Which Platform Map tier(s) gate Phase A? | **All of it** — Phase A tool-wiring waits for Platform Map **Phase 1 + Phase 2** (Tier 1 static + Tier 2 DI keys + Tier 3 tenant-scoped + derived `event-flow`/`acl-matrix` views), so the first real tool set ships complete rather than partial. Scaffolding (Phase 0 below) does **not** wait — it ships now with zero/placeholder tools. |
| Q3 | Auth model? | **No auth. Loopback-only.** Bind hard-coded to `127.0.0.1`; no `--host` flag exists. Tier-3 tenant scoping (once wired) is opt-in per invocation via explicit `--tenant <id> [--org <id>]` CLI flags at server boot, mirroring the Platform Map CLI's own `--tenant`/`--org` convention — omit them and Tier-3 rows are simply absent from the tool output. |
| Q4 | Docker wiring in scope? | **Yes** — a dev-only `dev-mcp` compose service, in the dev-only compose overlays only, never in the plain `docker-compose.yml` or the more production-shaped `docker-compose.fullapp.yml`. |

## 📝 Problem Statement

A coding agent working on this repo has no way to ask the running app "does this event ID
exist", "what ACL feature would gate this route", "what DI key resolves this service", or
"what widget spot IDs exist here" — it either greps ~25 generated registry files by hand or
guesses, and guesses produce code that fails at runtime or silently no-ops (an unmatched event
ID, a typo'd ACL feature, a DI key that doesn't exist). The existing MCP server
(`packages/ai-assistant`) is the wrong place to answer this: it is production-facing,
multi-tenant, session-token-scoped, and every tool on it is implicitly available to the
in-app customer-facing AI assistant — bolting dev-introspection tools onto it would leak
internal wiring detail into a surface with a completely different threat model and audience.

**Non-goals.** This is read-only introspection for local development. No mutation of
registries, no business logic, no production exposure, no replacement for
`BACKWARD_COMPATIBILITY.md`/OpenAPI docs.

## 📝 Proposed Solution

Stand up a second, independent MCP server process — `dev_mcp`'s `mcp:serve-dev-tools` CLI
command — that a coding agent connects to locally via `.mcp.json`, entirely separate from the
`ai_assistant` module's `mcp:serve` / `mcp:serve-http` / `mcp:dev` commands. It clones the
transport and per-request-instance discipline of the existing `mcp-dev-server.ts` (the closest
precedent in the repo — an HTTP/Streamable MCP server with boot-time-only auth) but drops
authentication entirely in favor of a loopback-only bind, and serves a **curated subset** of
the global MCP tool registry rather than everything registered process-wide.

**Alternatives considered:**
- *Add dev tools to the existing `ai_assistant` MCP server, gated by ACL feature.* Rejected —
  the tool would then be reachable (even if ACL-gated) from the exact same server the
  production, multi-tenant, session-token-scoped customer assistant uses; a misconfigured ACL
  grant or a future refactor could leak internal wiring detail to end users. A hard process
  boundary is a stronger, simpler guarantee than an ACL check.
- *Reuse `mcp:dev` itself, adding dev-tools as more tools on it.* Rejected for the same reason,
  plus `mcp:dev` already has a job (local testing of the *production* tool surface with a real
  API key) — conflating the two makes neither easy to reason about.

## 📝 Architecture

```
                    ┌─────────────────────────────────────────┐
                    │  packages/core/src/modules/dev_mcp/      │
                    │                                           │
  coding agent  ───►│  mcp:serve-dev-tools (CLI)                │
  (.mcp.json,        │   └─ lib/dev-mcp-server.ts               │
   loopback HTTP)     │       • fresh McpServer + Streamable-   │
                    │       │  HTTPServerTransport per request  │──► curated tool subset
                    │       • bind 127.0.0.1 only, no auth       │    (moduleId allowlist,
                    │       • --tenant/--org → Tier-3 scoping    │     built inside this
                    │       • hard-refuses NODE_ENV=production   │     module — the shared
                    │                                           │     registry itself is
                    └─────────────────────────────────────────┘     untouched)
                                   ▲                        ▲
                                   │ registerMcpTool()        │ registerMcpTool()
                                   │ at process boot            │ at process boot
                    ┌──────────────┴───────┐   ┌────────────┴───────────────┐
                    │ Phase A: platform.*   │   │ Future work (not this spec):│
                    │ wraps collectPlatform-│   │ a telemetry allowlist entry │
                    │ Map() from            │   │ once a telemetry memory-    │
                    │ @open-mercato/shared  │   │ provider spec exists — no   │
                    │ introspection core    │   │ tool contract designed here │
                    │ — Platform Map        │   └─────────────────────────────┘
                    │ Phase 1+2 prerequisite│
                    └───────────────────────┘
```

- **Tool registry stays global and untouched, and needs no new export.**
  `registerMcpTool`/`ToolRegistrationOptions` in `packages/ai-assistant/.../lib/tool-registry.ts`
  keeps its current shape. `@open-mercato/ai-assistant` already exports `getToolRegistry()`
  (used today by the existing `mcp:list-tools` CLI command), whose
  `listToolsByModule(moduleId)` returns exactly the per-`moduleId` tool set `dev_mcp` needs.
  `dev_mcp`'s server builder calls `getToolRegistry().listToolsByModule(id)` for each id in an
  explicit allowlist (starts as `['dev_mcp']` in Phase 0, gains `'platform_map'` in Phase A —
  see Phasing) before wiring the results into each request's `McpServer` instance — mirroring
  the ACL-based filter already present in `mcp-dev-server.ts`, just keyed on `moduleId` instead
  of required features. No new public export is added anywhere.
- **`dev_mcp` registers its own tools at boot**, not via some other module's auto-discovery —
  the CLI process bootstraps the app registry exactly like `mercato inspect` and `seed:defaults`
  do (`bootstrapFromAppRoot` + `createRequestContainer`), builds an `IntrospectionContext`, and
  calls `registerMcpTool` for each `platform.*` tool itself. This keeps the introspection core's
  "isomorphic, takes inputs by injection" design intact — `dev_mcp` is just another consumer,
  same as the `mercato inspect` CLI and the future backoffice UI.
- **No new database entities, no new ORM.** Tier-3 reads (once wired) go through the
  introspection core's existing `em`-based reads (`role_acl`, `entity_definition`) exactly as
  Platform Map's own spec describes; `dev_mcp` supplies `tenantId`/`organizationId` from its
  `--tenant`/`--org` flags, nothing more.
- **Hard production refusal.** `mcp:serve-dev-tools` checks `process.env.NODE_ENV === 'production'`
  at startup and exits non-zero with a clear message — no opt-in flag, unlike Platform Map's UI
  (which has a legitimate prod-inspection use case). This tool never has one.

## 📝 Data Model

None. No new database tables, no new entities, no persisted state. Tier-3 reads (Phase A, once
wired) go through the introspection core's read-only queries against existing tables
(`role_acl`, `entity_definition`/`entity_field`) — `dev_mcp` adds no schema of its own.

## 📝 API Contracts

Not an HTTP API — an MCP tool surface, plus one CLI command.

**CLI:**
```
mercato dev_mcp mcp:serve-dev-tools
  --port <n>              # default 3002, env DEV_MCP_PORT
  --tenant <id>            # optional — enables Tier-3 rows once Phase A tools exist
  --org <id>               # optional, requires --tenant
```
No `--host` flag exists; the bind address is hard-coded to `127.0.0.1`.

**MCP tools (Phase A, `moduleId: 'platform_map'`):**
| Tool | Input | Output |
|---|---|---|
| `platform.getSurface` | `{ surfaceId: string }` | `SurfaceRow[]` for that surface (per Platform Map's `SurfaceProvider.collect()`) |
| `platform.getEventFlow` | `{}` | derived event↔subscriber join, flags dead events / orphan subscribers |
| `platform.getAclMatrix` | `{}` | features × roles matrix (static + live grants when `--tenant` was supplied) |

**`telemetry.*` tools are explicitly out of scope for this spec.** A telemetry memory-provider
spec does not exist yet (see Future Work), so no tool contract is designed here — committing to
input/output shapes ahead of that spec's own design would almost certainly need rework once it
exists. When that spec lands, it (or a short follow-up to this one) defines the `moduleId:
'telemetry'` allowlist entry and its tools; this spec only reserves the allowlist mechanism that
makes adding them additive.

All tool outputs follow Platform Map's own posture: **shapes, not values** — no secrets, no PII,
no resolved DI-container instances (DI-key rows list keys, never resolved objects).

## UI/UX

N/A — no UI. CLI to start the server; the coding agent's own MCP client (e.g. Claude Code) is
the only "interface."

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behavior |
|---|---|
| Started with `NODE_ENV=production` | Exits immediately, non-zero, with a clear stderr message. No opt-in. |
| Port already in use (e.g. `mcp:dev` also running on a nearby port) | Fails fast with the underlying `EADDRINUSE`, same as any Node HTTP listener — no silent fallback to a different port. |
| Called before Platform Map Phase 1+2 ships | `platform.*` tools are simply not registered yet — `getTools()` on the `dev_mcp` server returns whatever placeholder/no tools exist for Phase 0. Not an error state; documented as the expected pre-Phase-A state. |
| `platform.getAclMatrix` called without `--tenant` | Returns the static half of the matrix only (features × roles from static registries); live-grant rows are simply absent, exactly like the Platform Map CLI's own `--tenant`-gated behavior. |
| Two coding agents on the same machine both start the server | Second start fails on the port bind (see above) — no multi-instance coordination is provided; not a target use case for v1. |

## 📝 Risks & Impact Review

- **Delivery depends on an unimplemented spec.** Phase A cannot ship until Platform Map Phase
  1+2 land. *Mitigation:* Phase 0 (module, CLI command, transport, production refusal, docker
  service, `dev.status` tool) is fully independent and ships first, with an integration test that
  asserts "the server starts, binds loopback-only, refuses production, and answers `dev.status`"
  — real, testable value arrives before Phase A, nothing is blocked waiting for the full stack.
  Unlike an earlier draft of this spec, telemetry tools are **not** a third phase here — they are
  explicitly deferred to Future Work so this spec has a clean, reachable "implemented" state
  (Phase A) instead of staying open indefinitely behind a spec that doesn't exist yet.
- **No-auth surface, even loopback-only, is a deliberate posture change** from every other MCP
  server in the repo. *Mitigation:* hard loopback bind with no `--host` escape hatch, hard
  production refusal with no opt-in, and its own compose service confined to dev-only overlay
  files. Documented explicitly as a decision (Q3), not an oversight, in this spec's Open
  Questions resolution.
- **Backward compatibility.** Additive only: new module id `dev_mcp` (no collision — grep
  confirms no existing module uses it), new CLI command, new dev-only compose service, new
  `moduleId` values (`dev_mcp`, `platform_map`) used only as allowlist filter keys inside
  `dev_mcp` — no changes to `registerMcpTool`'s public shape, and **no new export at all**:
  `@open-mercato/ai-assistant`'s already-public `getToolRegistry()` covers the read access this
  spec needs. No FROZEN/STABLE surface from `BACKWARD_COMPATIBILITY.md` is touched.
- **Rollback.** Deleting the `dev_mcp` module and its compose service fully removes the feature;
  nothing else in the repo depends on it (it is a pure consumer of the introspection core and
  the tool registry, never a producer other modules read from).

## Research — how comparable tooling handles local, agent-facing MCP servers

Locally-scoped MCP servers built for coding-agent consumption (filesystem, git, and similar
reference-style MCP servers) overwhelmingly skip authentication entirely and bind to the loopback
interface or stdio by design — the security boundary is "this only ever runs on the developer's
own machine," not a credential. That validates Q3's default directly: adding an API key here
would be defending a threat model (remote/multi-tenant access) this server structurally cannot
have, at the cost of one more secret to provision for a purely local dev loop. It also validates
keeping this server's tool surface intentionally narrow (a curated allowlist, not "everything
registered") — the same reference servers expose a small, purpose-built tool set rather than a
generic passthrough, which is exactly the `moduleId`-allowlist design above.

## 📋 Phasing

Each phase leaves the app working and is independently shippable.

### Phase 0 — Scaffolding (no dependency on Platform Map)
1. `packages/core/src/modules/dev_mcp/` module skeleton (id `dev_mcp`), short `AGENTS.md`
   (documenting why it deviates from the sibling-module template: no `acl.ts`, no entities —
   the first CLI-only tooling module under `packages/core`; and why it skips auth, unlike the
   rest of the MCP surface).
2. Confirm `@open-mercato/ai-assistant`'s existing `getToolRegistry()` export (already used by
   `mcp:list-tools`) covers the read access needed — no new export required.
3. `lib/dev-mcp-server.ts`: clone `mcp-dev-server.ts`'s per-request `McpServer` +
   `StreamableHTTPServerTransport` construction; hard-code `127.0.0.1` bind; call
   `getToolRegistry().listToolsByModule(id)` for each `moduleId` in an explicit allowlist,
   starting as `['dev_mcp']` (just this module's own `dev.status` tool) — `'platform_map'` is
   added to the allowlist in Phase A, `'telemetry'` only if/when the Future Work addendum lands.
4. `cli.ts`: `mcp:serve-dev-tools` command (`--port`/`DEV_MCP_PORT` default 3002, `--tenant`,
   `--org`), registered as a standard `ModuleCli` entry — no core CLI changes needed.
5. Hard `NODE_ENV === 'production'` refusal at startup.
6. `.mcp.json` example entry documented in `dev_mcp/AGENTS.md`, cross-linked from
   `packages/ai-assistant/AGENTS.md`.
7. Dev-only `dev-mcp` compose service in `docker-compose.fullapp.dev.yml` /
   `.fullapp.dev.local.yml` only, reusing the app image, `${DEV_MCP_PORT:-3002}:3002`, running
   `mercato dev_mcp mcp:serve-dev-tools` (no `--tenant` in compose — tenant-scoped Tier-3 stays a
   CLI-only, interactive flag).
8. Register one trivial `dev.status` tool (`moduleId: 'dev_mcp'`, no allowlist filtering needed
   since it's the server's own tool) returning `{ version, allowlistedModuleIds, toolCount }` —
   gives Phase 0 a real, testable connection-smoke-test value instead of shipping a
   zero-tool server while Phase A is still pending.
9. Integration test: server starts, binds loopback-only, refuses to start under
   `NODE_ENV=production`, lists exactly `dev.status` before Phase A tools exist, and `dev.status`
   returns the expected shape.

### Phase A — Structural tools (gated on Platform Map Phase 1 **and** Phase 2 per Q2)
10. Depend on `@open-mercato/shared`'s introspection core (`collectPlatformMap`,
    `IntrospectionContext`) once published.
11. On server boot, bootstrap the app registry (`bootstrapFromAppRoot` +
    `createRequestContainer`, the `seed:defaults`/`mercato inspect` pattern), build an
    `IntrospectionContext` from `--tenant`/`--org`, and `registerMcpTool` for
    `platform.getSurface`, `platform.getEventFlow`, `platform.getAclMatrix` with
    `moduleId: 'platform_map'`.
12. Integration test: call each tool against a running server, assert real rows from a fixture
    app registry; a `--tenant`-scoped test confirming no cross-tenant leakage in
    `platform.getAclMatrix`.

This spec is considered **fully implemented once Phase A ships** — that is the complete,
independently deployable capability described in the TLDR. It does not stay open waiting on
telemetry (see Future Work).

## Future Work (explicitly out of scope for this spec)

A `telemetry.*` tool set is a natural next consumer once a **separate** telemetry
memory-provider spec exists (dev-only in-memory ring buffer + read API under
`packages/telemetry`, not designed here). When that spec is written, it should either extend
this spec with a short addendum (new phase, same `moduleId`-allowlist mechanism — add
`'telemetry'` to the allowlist array, add a boot-time registration block mirroring step 11) or
land as its own short follow-up spec that references this one. No tool contract, input/output
shape, or timeline is committed here — designing it now would be speculation ahead of that
spec's own architecture.

## 📋 Implementation Plan

See the numbered steps under **Phasing** above — each is independently testable and leaves the
app in a working state. Phase 0 can be handed to `om-implement-spec`/`om-auto-create-pr` today;
Phase A is blocked on Platform Map Phase 1+2 landing and should be re-scoped (not started) until
then.

## Cross-reference added to the Platform Map spec

A one-paragraph pointer was added to `.ai/specs/2026-06-17-platform-map-introspection.md`'s
"Proposed Solution" section identifying this Developer MCP Server as a planned third consumer
of the introspection core, alongside the CLI and the Phase-3 UI. That spec's locked Q1–Q5
decisions are untouched.

## Final Compliance Report

- **Naming:** module id `dev_mcp` is a new singular-name exception (AGENTS.md documents only
  `auth`/`example` as existing exceptions; this spec explicitly requests a third, for the same
  reason — a tooling module, not a domain-entity module — and flags it for reviewer sign-off
  rather than claiming established precedent). CLI command `mcp:serve-dev-tools` follows the
  existing `mcp:*` command family. The `moduleId` allowlist value `platform_map` is this spec's
  own choice for the filter key (the Platform Map spec itself declares no module id — it ships
  as a `packages/shared` core + CLI, not a registered module — so there is no cross-spec name to
  match; `platform_map` only needs to stay unique among `dev_mcp`'s own allowlist entries).
- **No cross-module ORM:** confirmed — `dev_mcp` has no entities and reads through the
  introspection core's existing data-engine access, same as Platform Map's own Tier-3 design.
- **No new production dependency:** `@open-mercato/ai-assistant`'s MCP SDK dependency is already
  present; `dev_mcp` reuses it rather than adding a second `@modelcontextprotocol/sdk` import
  site.
- **BC:** additive-only, confirmed above.

## Changelog

- 2026-08-10 — Initial draft written; Open Questions gate cleared same day (Q1: new `dev_mcp`
  module; Q2: Phase A waits for full Platform Map Phase 1+2; Q3: no-auth/loopback-only; Q4:
  dev-only compose service included).
- 2026-08-10 — Scope-cohesion review (fresh-context subagent): removed the speculative Phase B
  telemetry tool contract (moved to Future Work, no shape committed ahead of its own spec),
  added a real `dev.status` tool to Phase 0 so it has non-zero standalone value, corrected two
  overstated Final Compliance Report claims (naming precedent, cross-spec `moduleId` matching).
  Spec's implemented state is now Phase A, not an indefinitely-open Phase B.
- 2026-08-10 — `om-pre-implement-spec` audit (`.ai/specs/analysis/ANALYSIS-2026-08-10-developer-mcp-server.md`):
  no BC/AGENTS.md blockers found. Corrected the tool-registry access design — `dev_mcp` reuses
  the already-public `getToolRegistry().listToolsByModule(moduleId)` (used today by
  `mcp:list-tools`) instead of adding a redundant new export. No spec-shape changes otherwise.
