# Enterprise maintenance mode — implementation

## Goal

Ship the Enterprise `maintenance` module from the spec: CLI-toggled maintenance windows that return a 503 (JSON for APIs, a self-contained HTML page for pages), pause workers and the scheduler, run a drain/hold protocol, and make encryption key rotation require a drained window on Enterprise installs. OSS behavior stays unchanged.

Source doc: `.ai/specs/enterprise/2026-11-13-maintenance-mode.md`
Spec PR: #9434 (merged)

## Scope

- OSS seams that do nothing until a gate is registered: a request-gate registry in `@open-mercato/shared`, call sites in the API dispatcher, `api/auth/login` and `proxy.ts` (mirrored to the create-app template), a worker gate hook in `@open-mercato/queue` and the local scheduler poll, and the `MaintenanceCoordinator` contract plus a `withMaintenanceHold` helper.
- Enterprise module `packages/enterprise/src/modules/maintenance`:
  - file and Redis state stores with compare-and-set;
  - the gate, the page renderer and the template loader;
  - the bypass flow;
  - CLI `on|off|status|drain`;
  - heartbeats and drain;
  - the coordinator;
  - `GET /api/maintenance/status`;
  - the overlay and bypass-banner widgets;
  - i18n.
- Key rotation integration: the audited encryption CLI commands acquire a drained hold when the coordinator resolves. Adds `--enter-maintenance` and `--exit-maintenance`.

## Non-goals

- Phase 4, the backups `--maintenance` integration. It is delivered with the `backups` module PR; this PR only ships the coordinator contract it consumes.
- Partial modes (read-only, announce-only), per-tenant windows, and HTTP/admin toggles (spec Q5, Q6, Q8).
- Deployment-specific writer fences beyond what the process inventory can prove. When a fence cannot be verified, protected operations fail closed, as the spec requires.

## Decisions

- Spec ⚠ Q2, Q3 and Q9: the maintainer merged the spec PR (#9434) and explicitly requested implementation. The applied defaults are treated as confirmed.
- Phase 0 proxy path: the registry lives on `globalThis`. The proxy and the route handlers run in the same Node process (Next 16 proxy is pinned to the Node runtime), so the enterprise gate registered during bootstrap is visible to the proxy. A process that has not bootstrapped yet serves pages fail-open, which is the same boot fail-open as Q9. It never heartbeats, so the drained-hold inventory blocks on it.

## Implementation Plan

### Phase 0 — spikes and audit
1. Proxy/registry sharing decision recorded in the spec.
2. Audit of mutating encryption CLI entry points, frozen in the spec.

### Phase 1 — OSS seams (no behavior change)
1. Request-gate registry + unit tests.
2. Dispatcher gate call + `api/auth/login` + tests.
3. `proxy.ts` gate call + template mirror + tests.
4. Worker/scheduler gate hook + tests.
5. Maintenance coordinator types, errors, DI key, `withMaintenanceHold` helper.

### Phase 2 — Enterprise module
1. Scaffold the module, wire it in `modules.ts`, run `yarn generate`.
2. File and Redis state stores with CAS + tests.
3. Gate decisions, Retry-After, sticky cache, bypass verification + tests.
4. Page renderer, built-in template, template loader + XSS tests.
5. CLI `on/off/status/drain` + exit-code tests.
6. Heartbeat, admission accounting, drain evaluator, coordinator/holds + tests.
7. Status endpoint, bypass form, overlay and banner widgets, i18n.
8. Integration tests (coverage matrix subset runnable in CI).

### Phase 3 — Key rotation integration
1. Wire `withMaintenanceHold` into the audited commands.
2. `--enter-maintenance` / `--exit-maintenance` flags.
3. Unit tests for the OSS path, Enterprise refusal, timeout, store down, mode left on.
4. `UPGRADE_NOTES.md`, rotation docs, spec changelog.

## Risks

- Very large change surface. Each Phase is committed and pushed separately so it can be resumed with `om-auto-continue-pr`.
- Changing rotation behavior on Enterprise installs breaks unattended scripts. They fail closed on purpose; `UPGRADE_NOTES.md` documents the fix.
- Redis-backed CAS uses `WATCH/MULTI`; the file backend covers a single host only.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 0: Spikes and audit

- [x] 0.1 Record proxy/registry sharing decision in the spec — d90ade6b63
- [x] 0.2 Freeze the audited encryption CLI entry-point list in the spec — d90ade6b63

### Phase 1: OSS seams

- [x] 1.1 Request-gate registry with unit tests — aa8f692a1b
- [x] 1.2 Dispatcher and api/auth/login gate call sites with tests — 3506f749ff
- [x] 1.3 proxy.ts gate call site mirrored to the create-app template — 8191a06959
- [x] 1.4 Worker and scheduler gate hook with tests — 725bf5fdb0
- [x] 1.5 Maintenance coordinator types, errors, DI key and withMaintenanceHold helper — ae431c2115

### Phase 2: Enterprise maintenance module

- [x] 2.1 Scaffold module and wire it behind OM_ENABLE_ENTERPRISE_MODULES — 26af1207f8
- [x] 2.2 File and Redis state stores with CAS and tests — de4529a570
- [x] 2.3 Gate decisions, Retry-After, sticky cache and bypass verification with tests — 3ca955ffaf
- [x] 2.4 Page renderer, built-in template and template loader with XSS tests — 980b20118a
- [x] 2.5 CLI on/off/status/drain with exit-code tests — 327bb2159d
- [x] 2.6 Heartbeats, admission accounting, drain and coordinator holds with tests — 5d39a2014e
- [x] 2.7 Status endpoint, bypass form, overlay and banner widgets, i18n — bf7ad6cc6d
- [x] 2.8 Integration tests — e459fc85c1

### Phase 3: Key rotation integration

- [x] 3.1 Wrap audited rotation entry points with withMaintenanceHold — 2aea797e5e
- [x] 3.2 Add --enter-maintenance and --exit-maintenance flags — 2aea797e5e
- [x] 3.3 Rotation maintenance unit tests — 61aebd0733
- [x] 3.4 UPGRADE_NOTES, rotation docs and spec changelog — 16a5509495
