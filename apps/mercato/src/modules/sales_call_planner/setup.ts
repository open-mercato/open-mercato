import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

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

  async seedDefaults() {
    // Tracker task B5 seeds the deal-briefing workflow definition from here:
    // add `await seedDealBriefingWorkflow(ctx)` (idempotent upsert by
    // definition slug, mirroring agent_orchestrator's `lib/seeds.ts`) and take
    // the `{ em, tenantId, organizationId, container }` context back as this
    // hook's parameter. Nothing else belongs in this hook — the role grants
    // above are declarative and the ACL feature needs no seeding.
  },
}

export default setup
