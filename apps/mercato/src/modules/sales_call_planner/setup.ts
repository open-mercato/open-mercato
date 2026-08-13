import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedDealBriefingWorkflow } from './lib/seeds'

export const setup: ModuleSetupConfig = {
  /**
   * Personas.
   *
   * `superadmin` / `admin` take the wildcard, per the module convention.
   *
   * `employee` is the sales-facing persona in a stock tenant — it is the role
   * `customers/setup.ts` grants the deals, activities and interactions features
   * to, so it is the role that owns the company page this button lives on.
   * Granting it here means a salesperson can START the briefing; it does NOT
   * mean they can place calls. The outbound contact stays behind the default-off
   * `agent_orchestrator.external_agents.invoke` grant, which no persona list in
   * this repo hands out, so on an un-opted-in tenant the voice step fails down
   * the workflow's `error` route before anything dials. That is the intended
   * fail-closed default: the button is discoverable, the phone call is opt-in.
   *
   * `operator` / `engineer` are deliberately absent — they are not default roles
   * (auth's `DEFAULT_ROLE_NAMES` is superadmin/admin/employee) and neither owns
   * the CRM surface this feature acts on.
   *
   * Existing tenants pick this up only after `yarn mercato auth sync-role-acls`.
   */
  defaultRoleFeatures: {
    superadmin: ['sales_call_planner.*'],
    admin: ['sales_call_planner.*'],
    employee: ['sales_call_planner.brief.run'],
  },

  /**
   * `seedDefaults`, not `seedExamples`: the definition IS the feature. The
   * button B6 puts on the company page can only 404 without it, so a tenant
   * initialised with `--no-examples` must still get it — unlike
   * `agent_orchestrator`'s demo workflows, which are illustrations a real
   * deployment can do without.
   *
   * Idempotent and version-aware; see `lib/seeds.ts` for why it creates rather
   * than upserts. Nothing else belongs in this hook — the role grants above are
   * declarative and the ACL feature needs no seeding.
   *
   * Two operator steps still gate a run END TO END, and neither can be seeded
   * from here without handing this module a decision that belongs to the
   * tenant: the `sales_call_planner.ensure_task` command must be enabled in
   * Settings → Workflows → Commands, and an ElevenLabs call profile named
   * `sales_chief_call` must exist. Both fail visibly down a wired failure route
   * rather than silently.
   */
  async seedDefaults(ctx) {
    await seedDealBriefingWorkflow(ctx.em, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  },
}

export default setup
