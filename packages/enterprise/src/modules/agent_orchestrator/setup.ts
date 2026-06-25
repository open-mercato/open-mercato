import { createHash } from 'node:crypto'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedAgentOrchestratorExamples } from './lib/seeds'
import { seedDefaultEvalAssertions } from './lib/eval/defaultAssertions'
import { syncGroundingSets } from './lib/guardrails/syncGroundingSets'
import { AGENT_ORCHESTRATOR_METRIC_ROLLUP_QUEUE } from './lib/queue'

/** Mirrors the @open-mercato/scheduler ScheduleRegistration field names. */
type SchedulerServiceLike = {
  register: (registration: {
    id: string
    name: string
    scopeType: 'system' | 'organization' | 'tenant'
    organizationId?: string
    tenantId?: string
    scheduleType: 'cron' | 'interval'
    scheduleValue: string
    timezone?: string
    targetType: 'queue' | 'command'
    targetQueue?: string
    targetPayload?: unknown
    sourceType?: 'user' | 'module'
    sourceModule?: string
    isEnabled?: boolean
    description?: string
  }) => Promise<void>
}

/**
 * `scheduled_jobs.id` is a uuid column, so a module-owned schedule's stable
 * registration key must be hashed into a uuid — this keeps register() an
 * idempotent upsert across seedDefaults re-runs.
 */
function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export const setup: ModuleSetupConfig = {
  // Mirrors the frozen ACL feature set (mvp/00-overview.md §ACL features):
  //   agents.view · agents.run · proposals.view · proposals.dispose · workflows.author
  // Every concrete feature appears under at least one role (the wildcard
  // `agent_orchestrator.*` is the contract per packages/core/AGENTS.md § ACL).
  //
  // Persona mapping:
  //   superadmin / admin — full wildcard.
  //   operator — works the My caseload queue and disposes proposals; cannot run
  //              the playground or author workflows.
  //   engineer — runs the Playground, authors the INVOKE_AGENT builder node, and
  //              reads proposals; does NOT dispose (HITL stays with the operator).
  //
  // NOTE: the standard default roles created by auth setup are superadmin/admin/
  // employee (see auth/lib/setup-app.ts DEFAULT_ROLE_NAMES). `operator` and
  // `engineer` are NOT default roles, so those grants are picked up by
  // ensureDefaultRoleAcls' custom-role branch only when a deployment actually
  // creates those roles (the demo runbook step 0 creates them); listing them is
  // a safe no-op otherwise. `employee` mirrors the operator caseload grants so a
  // stock tenant still gets a usable disposition persona out of the box.
  defaultRoleFeatures: {
    superadmin: ['agent_orchestrator.*'],
    admin: ['agent_orchestrator.*'],
    employee: [
      'agent_orchestrator.agents.view',
      'agent_orchestrator.proposals.view',
      'agent_orchestrator.proposals.dispose',
      'agent_orchestrator.trace.view',
      'agent_orchestrator.trace.correct',
      'agent_orchestrator.guardrail.read',
      'agent_orchestrator.context.read',
      'agent_orchestrator.identity.read',
    ],
    operator: [
      'agent_orchestrator.agents.view',
      'agent_orchestrator.proposals.view',
      'agent_orchestrator.proposals.dispose',
      'agent_orchestrator.trace.view',
      'agent_orchestrator.trace.correct',
      'agent_orchestrator.guardrail.read',
      'agent_orchestrator.context.read',
      'agent_orchestrator.identity.read',
    ],
    engineer: [
      'agent_orchestrator.agents.view',
      'agent_orchestrator.agents.run',
      'agent_orchestrator.proposals.view',
      'agent_orchestrator.workflows.author',
      'agent_orchestrator.trace.view',
      'agent_orchestrator.eval.manage',
      'agent_orchestrator.eval.export',
      'agent_orchestrator.guardrail.read',
      'agent_orchestrator.guardrail.manage',
      'agent_orchestrator.context.read',
      'agent_orchestrator.identity.read',
      'agent_orchestrator.identity.manage',
    ],
  },

  // The auto-approve threshold is NOT seeded here (it lives in the INVOKE_AGENT
  // node config; the shared `module_configs` store is global, not tenant-scoped,
  // so a threshold row there would leak across tenants — see area 03).
  //
  // The trace-eval overlay DOES seed default deterministic eval assertions: these
  // are real per-(tenant, organization) `agent_eval_assertions` rows (properly
  // tenant-scoped, unlike module_configs), so a stock tenant evaluates runs out
  // of the box. Idempotent — re-running creates nothing new.
  seedDefaults: async (ctx) => {
    await seedDefaultEvalAssertions(ctx.em, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })

    // Wave 3, Phase 4: sync the per-capability grounding guardrail SETS to
    // `agent_guardrail_sets`, content-hash idempotent (re-run with no body change
    // writes nothing; editing a body produces a new append-only version). The
    // synced `version` is recorded on every grounding AgentGuardrailCheck.
    await syncGroundingSets(ctx.em, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })

    // F2: register the per-org metric-rollup interval job. Best-effort + guarded
    // — a deployment without the scheduler module is a safe no-op, and a
    // scheduler failure must not abort tenant init for every other module. The
    // schedule id is a deterministic uuid so re-runs upsert idempotently.
    const cradle = ctx.container as { hasRegistration?: (name: string) => boolean }
    if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) {
      return
    }
    try {
      const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
      const schedulerService = ctx.container.resolve('schedulerService') as SchedulerServiceLike
      await schedulerService.register({
        id: stableScheduleUuid(`agent_orchestrator:metric-rollup:${ctx.organizationId}`),
        name: 'Agent metric rollup',
        description: 'Precomputes per-agent KPI windows into append-only rollup rows every 300s.',
        scopeType: 'organization',
        organizationId: ctx.organizationId,
        tenantId: ctx.tenantId,
        scheduleType: 'interval',
        scheduleValue: '300s',
        timezone: 'UTC',
        targetType: 'queue',
        targetQueue: AGENT_ORCHESTRATOR_METRIC_ROLLUP_QUEUE,
        targetPayload: { scope },
        sourceType: 'module',
        sourceModule: 'agent_orchestrator',
        isEnabled: true,
      })
    } catch (error) {
      console.warn(
        '[internal] agent_orchestrator: failed to register metric-rollup schedule',
        error instanceof Error ? error.message : error,
      )
    }
  },

  // Gated demo seed (skipped with --no-examples). Idempotent + tenant-scoped:
  // lands the demo workflow definition and 2 demo deals (via the audited
  // customers command path), and verifies the code-defined `deals.health_check`
  // agent resolves. Re-running creates nothing new.
  seedExamples: async (ctx) => {
    await seedAgentOrchestratorExamples(ctx.em, ctx.container, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  },
}

export default setup
