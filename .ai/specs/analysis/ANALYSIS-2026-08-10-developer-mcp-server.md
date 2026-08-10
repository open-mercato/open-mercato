# Pre-Implementation Analysis: Developer MCP Server — Local Introspection Tools for Coding Agents

Spec: `.ai/specs/2026-08-10-developer-mcp-server.md`

## Executive Summary

The spec is architecturally sound — additive-only, no FROZEN/STABLE surface touched, correct
avoidance of the frozen `registerMcpTool` signature — and Phase 0 is genuinely implementable
today. One concrete correction is required before implementation starts: the spec assumes a new
public export (`getRegisteredMcpTools()`) is needed on `@open-mercato/ai-assistant`, but an
equivalent already exists (`getToolRegistry()`, already used by `mcp:list-tools`) — Phase 0
should be updated to reuse it instead of adding a redundant export. No Critical BC violations.
**Recommendation: ready to implement Phase 0 after the one spec correction below; Phase A stays
correctly blocked on the Platform Map spec.**

## Backward Compatibility

### Violations Found

None. All 13 contract-surface categories checked; the spec introduces no renames/removals of
any FROZEN or STABLE surface. `registerMcpTool(tool, options?)` (BC doc line 111, FROZEN) is
correctly left untouched — the spec's own filtering happens externally in the new `dev_mcp`
module, confirmed against the actual `tool-registry.ts` implementation (`options?.moduleId` only
populates an internal `moduleMap`, never changes the function's signature or behavior).

### Missing BC Section

Not missing — the spec's "Risks & Impact Review" § Backward compatibility bullet and the "Final
Compliance Report" § BC line cover this, in lieu of a separately headed "Migration & Backward
Compatibility" section. Since nothing here is a breaking change, no migration/deprecation path
is needed per `BACKWARD_COMPATIBILITY.md`'s own trigger condition ("any PR that modifies a
contract surface"). No action needed.

## Spec Completeness

All required sections from the spec-writing checklist are present: TLDR, Problem Statement,
Proposed Solution, Architecture, Data Model, API Contracts, UI/UX (marked N/A with reason),
Edge Cases & Failure Scenarios, Risks & Impact Review, Research, Phasing, Implementation Plan,
Future Work, Cross-reference note, Final Compliance Report, Changelog.

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| Architecture / API Contracts | Claims a new `@open-mercato/ai-assistant` export is needed for tool-registry read access | **Correct before implementation**: `getToolRegistry()` is already exported (`packages/ai-assistant/src/index.ts`) and already returns `listToolsByModule(moduleId)` / `getTool(name)` / `getTools()` — reuse it. Also fix the imprecise phrasing "filters `getTools()` down to entries whose `moduleId` is in an explicit allowlist" — `getTools()`'s `McpToolDefinition` values carry no `moduleId` field; the real filter is `listToolsByModule(id)` per allowlisted id, not a predicate over `getTools()`. |
| Integration Test Coverage | The spec's Phasing embeds test steps inline (step 9, step 12) rather than a dedicated "Integration & test coverage" section like the Platform Map spec has | Low-priority stylistic gap; the inline tests are concrete and sufficient. Optionally add a short dedicated section for consistency with sibling specs, not required. |

## AGENTS.md Compliance

### Violations

None blocking. Two naming/precedent notes to correct in the Final Compliance Report:

| Rule | Location | Fix |
|------|----------|-----|
| Root `AGENTS.md` "Modules: plural, snake_case... Special cases: `auth`, `example`" | Spec's Final Compliance Report, "Naming" bullet | The spec already avoids over-claiming precedent (good), but should note that root `AGENTS.md`'s two-exception list is itself stale relative to the actual codebase — many existing modules are already singular (`catalog`, `checkout`, `content`, `design_system`, `directory`, `onboarding`, `planner`, `portal`, `progress`, `query_index`, `scheduler`, `search`, `staff`, `wms`, `ai_assistant`). This doesn't change the spec's conclusion (still flag for reviewer sign-off) but the current wording undersells how common singular module ids actually are — a reviewer checking only `AGENTS.md` would wrongly think this is a rare exception. |
| `packages/core/src/modules/` structural convention | Architecture § module home (Q1) | Every existing `packages/core` module that has a `cli.ts` also has `acl.ts` + `data/entities.ts`; the handful without ACL/entities (`core`, `portal`, `widgets`) have no `cli.ts` either. `dev_mcp` (cli.ts, no acl.ts, no entities) would be the **first** module of this shape in `packages/core`. Not a violation — just worth stating explicitly in the spec so the reviewer isn't surprised, and so `dev_mcp`'s `AGENTS.md` (Phase 0 step 1) explains why it deviates from the sibling-module template. |

**Module structure**: correct location (`packages/core/src/modules/dev_mcp/`), correct
auto-discovery shape (`cli.ts` default export, standard `ModuleCli` entries) — confirmed no
`packages/cli/src/mercato.ts` changes are needed (generic dispatch already handles any module +
command pair). No `setup.ts`/`acl.ts` is proposed, and none is needed — the server carries no
ACL-gated business feature (Q3 chose no-auth/loopback-only over an ACL check).

**Data & security**: no new entities, no PII, no encryption-map applicability — confirmed by the
spec's own Data Model section ("None"). Tenant scoping for the future Tier-3 rows is opt-in via
explicit `--tenant`/`--org`, matching the Platform Map CLI's own convention — no gap.

**API & UI canonical mechanisms**: N/A — no HTTP API route, no UI, no CrudForm/DataTable. MCP
tool registration correctly reuses `registerMcpTool` rather than inventing a parallel mechanism.

**Events & side effects**: N/A — no new events, no cross-module side effects proposed.

**Commands**: N/A — read-only introspection, no undoable mutation.

**Design System**: N/A — no UI.

## Risk Assessment

### High Risks

None.

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Redundant-export gap (§ Spec Completeness above) ships as written | Implementation adds an unnecessary, near-duplicate public export (`getRegisteredMcpTools()`) alongside the already-public `getToolRegistry()`, creating two ways to do the same read, and a future BC surface to maintain for no reason | Correct the spec now (see Remediation Plan) before Phase 0 implementation starts — cheap to fix pre-code, awkward to walk back post-ship since any new export instantly becomes a de facto contract |
| No-auth, loopback-only posture is a first-of-its-kind exception in the MCP surface | A future contributor extending `dev_mcp` might copy the no-auth pattern into a context where loopback-only no longer holds (e.g. a shared devbox with port-forwarding) | Already mitigated in the spec itself: hard-coded bind, no `--host` flag, hard production refusal. Worth a one-line `AGENTS.md` note in the new module explaining why this deviates from the rest of the MCP surface, so the reasoning travels with the code, not just the spec. |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `packages/core/src/modules/dev_mcp/` is a structurally novel module shape (cli.ts, no acl.ts, no entities) | Slightly higher chance a reviewer or generator assumption trips on an unfamiliar shape | Call it out explicitly in the module's own `AGENTS.md` (Phase 0 already plans to write one); no code risk found |
| Root `AGENTS.md`'s naming-exception list is stale | Low — doesn't block this spec, just a pre-existing documentation gap | Optional follow-up, out of scope for this spec |

## Gap Analysis

### Critical Gaps (Block Implementation)

None.

### Important Gaps (Should Address)

- **Reuse `getToolRegistry()` instead of adding a new export.** Update Architecture (bullet at
  "Tool registry stays global and untouched"), API Contracts, Phasing step 3/10, Risks/BC
  bullet, and Final Compliance Report to say: `dev_mcp` calls `getToolRegistry()` (already
  exported from `@open-mercato/ai-assistant`) and filters via `listToolsByModule(moduleId)` for
  each allowlisted `moduleId`, exactly like the existing `mcp:list-tools` CLI command already
  does. No new export needed on `@open-mercato/ai-assistant` for Phase 0 or Phase A.

### Nice-to-Have Gaps

- A one-line note in the eventual `dev_mcp/AGENTS.md` explaining the no-auth/loopback-only
  deviation from the rest of the MCP surface (traceability for future contributors).
- A one-line note that `dev_mcp` is the first CLI-only/no-ACL/no-entity module under
  `packages/core/src/modules/`, so the shape isn't mistaken for a copy-paste error by a future
  module-scaffolding review.

## Remediation Plan

### Before Implementation (Must Do)

1. **Correct the tool-registry-access design in the spec**: replace every reference to a new
   `getRegisteredMcpTools()` export with `getToolRegistry().listToolsByModule(moduleId)` /
   `.getTool(name)`, and fix the imprecise "filters `getTools()`" phrasing to describe filtering
   via `listToolsByModule` per allowlisted `moduleId` instead. Touches: Architecture bullet,
   API Contracts intro, Phasing step 3 and step 10, Risks/BC bullet, Final Compliance Report.

### During Implementation (Add to Spec)

1. Add the two "nice-to-have" `AGENTS.md` notes (no-auth rationale; novel module shape) as part
   of Phase 0 step 1 (module `AGENTS.md` authoring) — no spec change required, just an
   implementation-time reminder.

### Post-Implementation (Follow Up)

1. None specific to this spec. General follow-up (already tracked in the spec's own Future
   Work): a telemetry memory-provider spec, and its own addendum/follow-up to wire
   `telemetry.*` tools onto this server once that exists.

## Recommendation

**Needs one small spec update first** (the `getToolRegistry()` correction above), then **ready
to implement Phase 0**. Phase A remains correctly gated on Platform Map Phase 1+2 landing — do
not start it early. No blockers found against `BACKWARD_COMPATIBILITY.md` or `AGENTS.md`.
