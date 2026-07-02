# Structured Logging Facade for `@open-mercato/shared`

- **Status:** Draft
- **Scope:** OSS (cross-cutting shared contract)
- **Issue:** [#3743](https://github.com/open-mercato/open-mercato/issues/3743)
- **Origin:** Follow-up to [#3738](https://github.com/open-mercato/open-mercato/issues/3738) (`OM_WORKFLOW_TRIGGER_DEBUG` env flag added to make a silent wildcard subscriber observable)
- **Risk:** `risk-high` (new shared contract surface, eventually reaches broadly) · **Priority:** `priority-low`
- **Category:** `refactor`

## TLDR

Introduce a thin, swappable **logging facade** at `@open-mercato/shared/lib/logger` exposing `createLogger(namespace)` → `{ debug, info, warn, error, child }`. It is backed by **pino** on the Node server (structured JSON) and a **console-backed transport** on the browser/edge (isomorphic-safe), selected at runtime so pino never leaks into client bundles. Global level is controlled by a single env var `OM_LOG_LEVEL` (default `debug` in dev, `info` in prod). This issue delivers **the facade + unit tests + docs + one reference migration** (the `@open-mercato/events` bus/bridge/worker) — **not** a big-bang rewrite of the ~2,300 existing `console.*` call sites. Everything is purely additive: no existing `console.*` call is removed by this spec.

## Problem Statement

There is no logging abstraction in the codebase. Application code reaches directly for `console.log` / `console.warn` / `console.error`. Current footprint of raw `console.*` in `packages/*/src` (non-test), measured on the base branch:

| Package | `console.*` (non-test) |
|---|---:|
| core | 1289 |
| cli | 361 |
| ai-assistant | 324 |
| search | 135 |
| shared | 103 |
| ui | 70 |
| queue | 24 |
| events | 9 |
| webhooks | 5 |
| cache | 1 |

This is the *absence of a pattern*, and it has real costs at that scale:

- **No log levels.** `console.log` vs `console.warn` is the only granularity. There is no global "emit `debug` in dev, `info` in prod" switch. Teams work around this with per-feature env flags (`OM_WORKFLOW_TRIGGER_DEBUG`, `OM_EVENTS_SINGLE_DELIVERY` debug branches) — each reinvents level-gating locally.
- **No structure.** Lines are string-concatenated (`tenant=X organization=Y matched=0 …`), so they can't be queried in a log aggregator. A structured logger emits `{ level, msg, tenantId, organizationId, event, … }` as JSON.
- **No context propagation.** Every line manually re-injects `tenant=`, `organization=`, `eventName=`. A child logger (`logger.child({ tenantId, eventName })`) attaches that once and every downstream line inherits it.
- **No redaction / sampling / correlation IDs** — all things a multi-tenant system eventually needs (never leaking secrets or PII into logs).

## Goals / Non-Goals

**Goals**
- A stable, minimal facade export (`@open-mercato/shared/lib/logger`) with `createLogger` + `child` + four levels.
- Isomorphic safety: no regression for existing browser/edge consumers of `@open-mercato/shared`; pino stays server-only.
- Single global level knob (`OM_LOG_LEVEL`).
- Unit tests, a docs page, and one real reference migration (`@open-mercato/events`).
- A written rationale for **why a facade** (not direct pino) and **how modules adopt it**.

**Non-Goals**
- Rewriting all ~2,300 `console.*` sites (incremental via the Boy Scout rule afterward).
- Log shipping/transport plumbing to an external aggregator (pino's stdout JSON is enough; ops wires the collector).
- Removing existing per-feature debug env flags in this issue (they collapse into `logger.debug(...)` as their files are migrated later).
- Request-scoped correlation-ID middleware (facade must *allow* it via `child()`, but wiring it is out of scope here).

## Proposed Solution

### Public API (contract surface — additive, STABLE once shipped)

```ts
// @open-mercato/shared/lib/logger
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogBindings = Record<string, unknown>

export interface Logger {
  debug(msg: string, fields?: LogBindings): void
  info(msg: string, fields?: LogBindings): void
  warn(msg: string, fields?: LogBindings): void
  error(msg: string, fields?: LogBindings): void
  /** Returns a logger with `bindings` merged into every subsequent line. */
  child(bindings: LogBindings): Logger
}

/** Create (or reuse) a namespaced logger. `namespace` is attached as `name`. */
export function createLogger(namespace: string): Logger

/** Resolve the effective level once, for callers that want to gate expensive work. */
export function getLogLevel(): LogLevel
export function isLevelEnabled(level: LogLevel): boolean
```

Call shape mirrors pino (`logger.info(msg, fields)`), so the reference implementation is a near pass-through server-side and cheap to reason about. `error` accepts an `Error` in `fields.err` (pino serializes it; console transport prints `.stack`).

**Design note — why a facade, not direct pino (acceptance-criteria item):**
1. **Isomorphism.** pino is a Node library (uses `worker_threads`, `process.stdout`, `sonic-boom`). Importing it directly from `@open-mercato/shared` — which is consumed by browser and edge bundles — would break those bundles. The facade lets us pick a console transport client-side and pino server-side behind one import.
2. **Swappability.** ~2,300 future call sites must never import `pino` directly. If we later swap pino for another backend (or add OpenTelemetry log bridging, redaction, sampling), we change one file, not thousands. This is the same rationale as `apiCall` wrapping `fetch` and DI-resolved cache wrapping Redis.
3. **Contract stability.** The facade's four-method surface is small and freezable under `BACKWARD_COMPATIBILITY.md`; pino's full API is not something we want third-party modules coupling to.

### Architecture

```
@open-mercato/shared/lib/logger/
  index.ts            # public facade: createLogger, getLogLevel, isLevelEnabled, types
  level.ts            # resolveLevel(): reads OM_LOG_LEVEL + NODE_ENV, numeric ordering
  transport.ts        # selectTransport(): runtime env detection → server | console
  transport.server.ts # pino-backed transport (lazy, server-only)
  transport.console.ts# console-backed transport (browser/edge/fallback)
  __tests__/logger.test.ts
```

**Prior art.** `packages/search/src/lib/debug.ts` is the closest existing analog: a per-module helper exposing gated (`searchDebug`/`searchDebugWarn`) and always-on (`searchWarn`/`searchError`) console wrappers behind an env flag. It proves the shape but is search-scoped and reinvents level-gating locally — exactly what this facade generalizes. The env-source-injection pattern from `packages/events/src/single-delivery.ts` (`isSingleDeliveryRequested(env = process.env)`) is mirrored in `level.ts` for testability.

**Transport selection (the isomorphic core).** `@open-mercato/shared` builds **per-file, unbundled** with esbuild (`scripts/build-package.mjs`: `platform: 'node'`, `target: 'node18'`, `format: 'esm'`, `bundle: false`) and exposes subpath exports via wildcard patterns (`./*/*` → `dist/lib/logger.js`, types → `src`); the barrel `src/index.ts` is intentionally empty. Because the build is unbundled, importing `@open-mercato/shared/lib/logger` pulls in **only** the logger files, nothing else — and the wildcard export means **no `package.json` `exports` edit is required** (a new `lib/logger/` path resolves automatically). To keep pino out of client/edge bundles:

- `index.ts` and `transport.console.ts` have **zero static dependency on pino**.
- pino is loaded **lazily and guardedly** inside `transport.server.ts` — only when a genuine Node server runtime is detected. Detection follows the existing `typeof window === 'undefined'` convention (see `packages/shared/src/lib/browser/safeLocalStorage.ts`) plus an edge guard (`process.env.NEXT_RUNTIME === 'edge'` → console transport). Because pino is CJS and shared is ESM, it is required via `createRequire(import.meta.url)`, wrapped in `try/catch`; any failure falls back to the console transport.
- The server transport is a **lazy singleton**: the pino root instance is created on first server-side log call, not at module load, so merely importing the facade never touches pino.

Result: browser/edge consumers get a tiny console shim; Node server gets structured pino JSON. No consumer's existing import of `@open-mercato/shared` regresses because the logger is a new, independently-resolved subpath.

**Console transport behavior.** Maps `debug/info/warn/error` to `console.debug/info/warn/error`, gated by the resolved level, and prints `\`[${namespace}]\`` + message + a compact `key=value` rendering of merged bindings (keeps dev output readable and matches the current hand-rolled `tenant=X …` style). `child()` returns a new shim with merged bindings.

**Server (pino) transport.** One root pino instance (`pino({ level })`); `createLogger(namespace)` → `root.child({ name: namespace })`; facade `.child(bindings)` → pino `.child(bindings)`. Level set from `resolveLevel()`. Pretty-printing (`pino-pretty`) is **not** a runtime dependency — dev readability is handled by the compact console transport when appropriate and by `OM_LOG_LEVEL`; raw JSON is correct for prod aggregation. (If dev pretty-printing is later desired, it is an additive follow-up behind the facade.)

### Level configuration

`resolveLevel()` reads a single env var and falls back on `NODE_ENV`:

| Source | Value | Effective level |
|---|---|---|
| `OM_LOG_LEVEL` set | `debug`\|`info`\|`warn`\|`error` (case-insensitive) | that level |
| `OM_LOG_LEVEL` unset, `NODE_ENV=production` | — | `info` |
| `OM_LOG_LEVEL` unset, otherwise (dev/test) | — | `debug` |
| `OM_LOG_LEVEL` set to junk | — | fall back to the `NODE_ENV` default + one `warn` line |

Numeric ordering `debug(10) < info(20) < warn(30) < error(40)` gates emission in both transports. Reading env is done once and memoized (invalidatable in tests). This is the single knob that replaces per-feature debug flags; parsing reuses the project's lowercase-token approach consistent with `packages/shared/src/lib/boolean.ts` (no ad-hoc truthiness).

## Reference Migration — `@open-mercato/events`

`@open-mercato/events` is the ideal reference target named by the issue ("the events/workflows subscribers that motivated it"): it is small (9 non-test `console.*` calls), already `dependsOn` `@open-mercato/shared` (`packages/events/package.json`), and is exactly the subsystem where the motivating `OM_WORKFLOW_TRIGGER_DEBUG` / `OM_EVENTS_SINGLE_DELIVERY` debug flags live.

Sites to migrate (all currently `console.warn`/`console.error` with hand-built `[events] … "${event}"` prefixes):

| File | Line(s) | Current |
|---|---|---|
| `packages/events/src/bus.ts` | 214, 257, 280 | handler / global-tap / cross-process publish errors |
| `packages/events/src/bridge.ts` | 69, 121, 140, 167 | cross-process listener/parse/dropped-payload |
| `packages/events/src/modules/events/workers/events.worker.ts` | 134 | subscriber failed for event |
| `packages/events/src/modules/events/api/stream/route.ts` | 126 | payload-exceeds-bytes skip |

Migration pattern:

```ts
import { createLogger } from '@open-mercato/shared/lib/logger'
const logger = createLogger('events')

// before: console.error(`[events] Handler error for "${event}" (pattern: "${pattern}"):`, error)
logger.error('Handler error', { event, pattern, err: error })

// child logger carries context for a delivery span:
const log = logger.child({ event, subscriberId: sub.id })
log.debug('Delivering to subscriber')
```

This demonstrates: namespace replacing the `[events]` prefix, structured fields replacing string interpolation, `child()` for context propagation, and `logger.debug(...)` gated by `OM_LOG_LEVEL` replacing a bespoke debug env flag. It is behavior-preserving at `info` level (warn/error still print); it only *adds* queryable structure and dev-time `debug` visibility.

> Note: the `route.ts` line 126 runs in a Next.js server route (Node runtime), so the server transport applies; no edge concern there. The migration does not touch any `"use client"` file.

**Secondary reference (the `#3738` motivating case), optional in this issue.** The workflow-trigger subscribers named by the origin PR — `packages/core/src/modules/workflows/subscribers/event-trigger.ts` (4 `console.*`) and `packages/core/src/modules/workflows/lib/event-trigger-service.ts` (3 `console.*`), all `[workflow-trigger]`-prefixed — currently fire **unconditionally**; the proposed `OM_WORKFLOW_TRIGGER_DEBUG` flag does **not** exist in the tree. Here the facade *introduces* level-gated logging (the noisy trace lines become `logger.debug(...)`, gated by `OM_LOG_LEVEL`) rather than migrating an existing flag — which is precisely the "no bespoke flag needed" outcome the issue seeks. Recommended as a fast-follow once `@open-mercato/events` lands; folding it into this issue is optional.

## Optional advisory lint rule (decision — recommended: add now, non-blocking)

Add a **non-blocking** checker, mirroring the existing advisory `yarn i18n:check-hardcoded` pattern, that flags **new** raw `console.*` in `packages/*/src` (non-test). It ships **advisory-only** (prints, exit 0) with a per-package allowlist for genuinely intended stdout (CLI user output in `@open-mercato/cli`, generator scaffolding, etc.). Rationale for advisory-first: a blocking rule against ~2,300 existing sites would require mass suppression churn and contradicts the incremental Boy Scout rollout. Wire it into CI as informational; promote to blocking in a later issue once the bulk is migrated. (An ESLint `no-console` rule with overrides is the alternative; a standalone script is preferred to avoid touching the shared ESLint config and to match the existing i18n-checker ergonomics.)

## Phasing

Each phase leaves the app building and testable.

**Phase 1 — Facade + tests (the deliverable core).**
- Add pino to `packages/shared/package.json` dependencies (net-new; pino is not currently a dependency anywhere).
- Implement `logger/{index,level,transport,transport.server,transport.console}.ts`.
- **No `package.json` `exports` change needed** — `@open-mercato/shared/lib/logger` resolves via the existing `./*/*` wildcard (types → `src`, default → `dist`). Optionally add a curated barrel entry for parity with `./lib/commands` et al., but it is not required.
- Unit tests (`packages/shared/src/lib/logger/__tests__/logger.test.ts`): level resolution matrix, level gating per method, `child()` binding merge, console-transport output shape, server/console transport selection under mocked `window`/`NEXT_RUNTIME`, junk-`OM_LOG_LEVEL` fallback, and an isomorphism assertion that importing the facade does not eagerly load pino.
- `yarn generate` (if module registries change) + `yarn build:packages` + `yarn typecheck` + `yarn test`.

**Phase 2 — Reference migration (`@open-mercato/events`).**
- Migrate the 9 sites above to `createLogger('events')` + `child()`.
- Preserve messages/behavior at `info`; convert genuinely diagnostic lines to `debug`.
- Update/extend the events package tests to assert no behavior change (existing warn/error still emitted).

**Phase 3 — Docs + advisory checker.**
- Docs page `apps/docs/docs/framework/runtime/logging.mdx` (logging is a runtime cross-cutting concern, alongside `runtime/workers.mdx`, `runtime/request-lifecycle.mdx`) — usage, `child()`, `OM_LOG_LEVEL`, isomorphic notes, the facade rationale, and migration guidance (Boy Scout rule, how to collapse a per-feature debug flag).
- Add advisory `console.*` checker script + `yarn logger:check-console`; document it as informational.
- Root `AGENTS.md` Task Router row: "Structured logging / replacing `console.*` → `@open-mercato/shared/lib/logger`" pointing at the docs page and this spec. Add a short `packages/shared/AGENTS.md` import cheat-sheet entry.

## Integration & Test Coverage

Per `.ai/specs/AGENTS.md`, list coverage for affected paths. This feature has **no new API routes or UI pages**, so coverage is unit-level plus a targeted integration assertion:

- **Unit (`packages/shared`)** — level resolution, gating, `child()`, transport selection, isomorphism (no eager pino load), junk-value fallback. (Server file: `testEnvironment: 'node'`; a jsdom-flavored case mocks `window` to force the console transport.)
- **Unit (`packages/events`)** — migrated bus/bridge/worker still emit on error paths; a `debug` line appears only when `OM_LOG_LEVEL=debug`.
- **Integration** — the `packages/events/src/modules/events/api/stream/route.ts` oversize-payload path (line 126) is exercised by the existing events stream integration coverage; assert the migrated `logger.warn` still fires (no regression). No new integration harness is required; fixtures follow `.ai/qa/AGENTS.md` (self-contained, cleaned up).

## Backward Compatibility

Per `BACKWARD_COMPATIBILITY.md` (contract-surface categories: import paths, types, generated files):

- **Purely additive.** No existing `console.*` call is removed by this issue; the events migration is behavior-preserving at default level.
- **New shared export** `@open-mercato/shared/lib/logger` — ADDITIVE to the import-path contract. Once shipped, the four-method `Logger` interface and `createLogger` signature are **STABLE**; changes follow the deprecation protocol (re-export/alias bridge ≥1 minor, `@deprecated` JSDoc, RELEASE_NOTES entry).
- **No DB schema, no DI keys, no event IDs, no ACL, no CLI-command removals.** The new `yarn logger:check-console` script is additive and advisory.
- **`OM_LOG_LEVEL`** is a new, optional env var with safe defaults; unset behavior matches today's implicit "print everything in dev".
- **Browser/edge consumers** of `@open-mercato/shared` are unaffected: the logger is an independently-resolved subpath and never statically imports pino.

## Risks & Impact Review

| # | Risk / Failure scenario | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|---|
| R1 | pino leaks into a browser/edge bundle → build break or bloat for existing shared consumers | High | Build/isomorphism | Zero static pino import in facade/console transport; lazy `createRequire` guarded by `window`/`NEXT_RUNTIME` checks; unit test asserts no eager pino load; empty barrel means subpath isolation | Low |
| R2 | Secrets/PII leak into structured logs (bindings passed verbatim) | High | Security/GDPR | Docs mandate never logging credentials/PII; facade leaves a redaction seam (pino `redact` / console filter) for a follow-up; reference migration logs only IDs/event names, never payload bodies | Medium |
| R3 | Level misconfiguration silences prod errors, or floods logs | Medium | Ops | `error`/`warn` always above default `info`; junk `OM_LOG_LEVEL` falls back to NODE_ENV default + one warn; documented matrix | Low |
| R4 | pino added as a new runtime dependency (supply chain, size) | Medium | Dependencies | pino is small, widely used, single well-maintained dep; kept behind facade so it is swappable; no `pino-pretty` in prod deps | Low |
| R5 | Facade API churns and third-party modules couple to it | Medium | Contract | Minimal four-method surface frozen under BC protocol; pino never re-exported | Low |
| R6 | Async init from a dynamic `import('pino')` makes logging lose synchronous ordering | Medium | Correctness | Use synchronous `createRequire` (CJS) rather than async `import()`, so `logger.info` stays synchronous like `console.*` | Low |
| R7 | Perf regression from per-call binding merges on hot paths | Low | Performance | `child()` merges once, not per line; `isLevelEnabled()` exposed so callers can gate expensive field construction | Low |

## Open Decisions (confirm during review)

1. **Library:** pino (recommended) vs alternative — spec assumes **pino** behind the facade, console transport client/edge.
2. **Env var name:** `OM_LOG_LEVEL` (recommended) — confirm the name.
3. **Advisory lint rule now vs follow-up:** spec recommends **add now, non-blocking** (informational CI), promote to blocking later.

## Final Compliance Report

| Rule | Status | Notes |
|---|---|---|
| Spec before implementation (cross-cutting shared contract) | ✅ | This document |
| Singular naming / FK-only / org scoping | n/a | No entities, no cross-module ORM, no tenant data |
| Canonical primitives (facade over raw lib, à la `apiCall`/DI-cache) | ✅ | Facade wraps pino; modules never import pino directly |
| Isomorphic safety of `@open-mercato/shared` | ✅ | Runtime transport selection; no eager pino; empty barrel + subpath export |
| Backward compatibility (additive, deprecation protocol noted) | ✅ | New export, no removals |
| Zod validation | n/a | No API inputs |
| Encryption / PII maps | n/a (seam noted) | R2 leaves redaction seam; no persisted data |
| Design System | n/a | No UI |
| i18n hardcoded-string rule | ✅ | Logger messages are internal diagnostics (not user-facing); docs note prefix conventions unaffected |
| Tests + docs + reference migration (acceptance criteria) | ✅ | Phases 1–3 |
| Task Router / AGENTS.md updated | ✅ | Phase 3 adds router row + shared cheat-sheet entry |

**Acceptance-criteria trace:**
- `@open-mercato/shared/lib/logger` with `createLogger` + `child` + levels, unit-tested → Phase 1.
- Isomorphic server/client transports, no browser-consumer regression → Phase 1 (transport selection + isomorphism test).
- `OM_LOG_LEVEL` controls global level, documented → Phase 1 (`level.ts`) + Phase 3 (docs).
- Docs page under `apps/docs` → Phase 3.
- One real subsystem migrated (events subscribers) → Phase 2.
- Written note on why facade + adoption guidance → this spec (§ Design note) + Phase 3 docs.

## Changelog

- 2026-07-02 — Initial draft (skeleton → full spec) for issue #3743. Library choice (pino), env var name (`OM_LOG_LEVEL`), and advisory-lint timing captured as open decisions with recommendations.
