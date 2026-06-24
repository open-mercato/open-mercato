import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedAgentOrchestratorExamples } from './lib/seeds'
import { seedDefaultEvalAssertions } from './lib/eval/defaultAssertions'

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
    ],
    operator: [
      'agent_orchestrator.agents.view',
      'agent_orchestrator.proposals.view',
      'agent_orchestrator.proposals.dispose',
      'agent_orchestrator.trace.view',
      'agent_orchestrator.trace.correct',
    ],
    engineer: [
      'agent_orchestrator.agents.view',
      'agent_orchestrator.agents.run',
      'agent_orchestrator.proposals.view',
      'agent_orchestrator.workflows.author',
      'agent_orchestrator.trace.view',
      'agent_orchestrator.eval.manage',
      'agent_orchestrator.eval.export',
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
