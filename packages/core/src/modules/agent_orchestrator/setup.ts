import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedAgentOrchestratorExamples } from './lib/seeds'

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
    ],
    operator: [
      'agent_orchestrator.agents.view',
      'agent_orchestrator.proposals.view',
      'agent_orchestrator.proposals.dispose',
    ],
    engineer: [
      'agent_orchestrator.agents.view',
      'agent_orchestrator.agents.run',
      'agent_orchestrator.proposals.view',
      'agent_orchestrator.workflows.author',
    ],
  },

  // No-op by design. The auto-approve gate (area 03 DispositionService) reads the
  // threshold ONLY from the INVOKE_AGENT node config (`onResult.autoApproveThreshold`,
  // 0.8 on the demo node) — there is no tenant config row to seed. The shared
  // configs store (`module_configs`) is keyed by (moduleId, name) without
  // tenant_id/organization_id, so seeding a threshold there would create a
  // GLOBAL, cross-tenant row, violating the tenant-scoping rule. Keeping the
  // threshold in the node config is the deliberate MVP simplification
  // (mvp/05-seed-and-demo.md §seedDefaults). A tenant-wide fallback config is a
  // post-hackathon overlay (it needs its own tenant-scoped entity).
  seedDefaults: async () => {
    /* intentionally empty — threshold is per-node config (see comment above) */
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
