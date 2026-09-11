# INVOKE_AGENT Output Mapping

## TLDR

**Key Points:**
- Give the `INVOKE_AGENT` workflow activity an optional `outputMapping`, mirroring `SUB_WORKFLOW`, so a workflow author can route an agent's result into **chosen** `workflowContext` keys instead of only the hardcoded `disposition` / `agentProposalId` / `proposalPayload`.
- Mapping reads from a stable, normalized **agent-result envelope** (`kind`, `disposition`, `proposalId`, `proposalPayload`, `data`) via plain dot-paths — identical authoring model to sub-workflow output mapping (`targetContextKey ← sourcePath`).
- **Additive and opt-in.** When no mapping is declared the engine writes the exact same legacy keys it always did. No DB migration (config is JSON inside the definition).

**Scope:**
- `invokeAgentConfigSchema.outputMapping?: Record<string,string>` (`data/validators.ts`).
- A shared mapper `lib/agent-result-mapping.ts` (`mapAgentResultToContext`) used by **both** context-write sites so the contract is identical regardless of resolution path.
- Wiring the mapping through the two paths an agent result can take into context: the parked-and-resumed worker path (`activity-worker-handler.ts`, the common sequential case) and the inline parallel-branch path (`step-handler.ts`). The job payload type (`activity-queue-types.ts`) carries `outputMapping` so the worker can apply it.
- Visual editor key/value editor on the INVOKE_AGENT node (`components/NodeEditDialog.tsx`) + i18n (en/es/de/pl).
- Unit tests for the mapper and schema.

**Concerns:**
- This does **not** widen what an agent can do. The agent is still propose-only and cannot address context keys itself; the *workflow author* chooses the mapping at design time. The mapper only re-routes the already-produced result.
- The legacy fixed-key payload is preserved byte-for-byte when no mapping is present (the mapper returns `null`, and each call site falls back to its existing literal).

---

## Overview

An `INVOKE_AGENT` activity runs an agent (in-process or OpenCode) and surfaces the result into the workflow context so the outgoing transition can branch (e.g. effector vs skip). Previously the engine wrote a **fixed** set of keys:

- `auto_approved` → `{ disposition: 'auto_approved', agentProposalId, proposalPayload }`
- `informative` → `{ disposition: 'informative', <stepId>_agent: data }`

Unlike `SUB_WORKFLOW` — which supports `outputMapping: Record<string,string>` to route a child's context into chosen parent keys — `INVOKE_AGENT` had no such binding, so downstream nodes had to read the fixed keys. This spec adds the same `outputMapping` affordance.

## Design

### Normalized result envelope

Because an agent result reaches context through two different code paths (the sequential park/resume worker and the rarely-used parallel-branch inline path), mapping is centralized in one helper that reads a normalized envelope:

```ts
type AgentResultEnvelope = {
  kind: 'auto_approved' | 'informative' | 'user_task'
  agentId?: string
  proposalId?: string
  proposalPayload?: unknown
  data?: unknown
}

mapAgentResultToContext(envelope, outputMapping): Record<string, any> | null
```

The mapper exposes these dotted source paths to authors: `kind`, `disposition` (= `kind`, normalized to `'informative'` for informative results), `agentId`, `proposalId`, `proposalPayload.*`, `data.*`. It returns `null` when no (or empty) mapping is supplied, signalling the caller to keep its legacy fixed-key payload — which guarantees backward compatibility.

Example:

```jsonc
{
  "activityType": "INVOKE_AGENT",
  "config": {
    "agentId": "deals_health_check",
    "input": { "dealId": "{{deal.id}}" },
    "onResult": { "autoApproveThreshold": 0.8 },
    "outputMapping": {
      "dealRisk": "proposalPayload.riskScore",
      "decision": "disposition"
    }
  }
}
```

→ writes `context.dealRisk` and `context.decision` instead of the default keys.

### Boundary preserved

The agent still produces only its schema-validated OUTCOME. `outputMapping` is an **engine-side, author-controlled** binding; it cannot be set or influenced by the agent at runtime. The propose-only contract is unchanged.

## Migration & Backward Compatibility

- **Contract surface:** additive only. `outputMapping` is a new **optional** field on the INVOKE_AGENT activity config (JSON inside the workflow definition). No type, signature, event-id, DI, ACL, API-route, or DB-schema change. No migration.
- Existing definitions (no `outputMapping`) behave identically: both context-write sites fall back to the prior fixed keys.
- The new job-payload field `WorkflowActivityJobInvokeAgent.outputMapping` is optional; in-flight jobs without it map to the legacy path.

## Files

- `packages/core/src/modules/workflows/data/validators.ts` — schema field.
- `packages/core/src/modules/workflows/lib/agent-result-mapping.ts` — shared mapper (new).
- `packages/core/src/modules/workflows/lib/activity-queue-types.ts` — job field.
- `packages/core/src/modules/workflows/lib/activity-executor.ts` — enqueue threading.
- `packages/core/src/modules/workflows/lib/activity-worker-handler.ts` — sequential path apply.
- `packages/core/src/modules/workflows/lib/step-handler.ts` — branch inline path apply.
- `packages/core/src/modules/workflows/components/NodeEditDialog.tsx` — visual editor.
- `packages/core/src/modules/workflows/i18n/{en,es,de,pl}.json` — labels/help.
- `packages/core/src/modules/workflows/lib/__tests__/agent-result-mapping.test.ts` — tests.

## Test Coverage

- Mapper: maps payload paths / disposition / proposalId into chosen (incl. nested) keys; normalizes informative disposition; skips unresolved paths; returns `null` for absent/empty mapping (legacy fallback).
- Schema: accepts config with `outputMapping`; remains valid without it; rejects non-string mapping values.
