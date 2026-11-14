import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { registerAssistedSellingSchedules } from './lib/scheduling'

// Step 4.3's `admin: ['assisted_selling.*']` already covers every feature later Steps add via
// the wildcard. Step 5.3 (§6.9, D-R5-7/D-R5-34): "`employee` gets `assisted_selling.threads.
// view`, `.threads.participate` and `.messages.post`; `assisted_selling.proposals.author`...
// stay with `admin` or [are] granted by hand to the reps who sell — the least-privilege line."
// `messages.post` now exists (`acl.ts`, this Step's own `POST /threads/:id/messages`), so the
// employee grant gains it: a staff member can see, open and converse in threads, but
// authoring a priced proposal stays an admin-or-hand-granted capability. The thread-detail
// route/page additionally gates on `cart.proposals.view` (priced proposal data rendered
// alongside the thread) — the list route doesn't, so without this grant `employee` could see
// rows in the thread list but got refused opening any of them (#8405). Existing tenants need
// `yarn mercato auth sync-role-acls` (S20) to pick up this additive grant.

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['assisted_selling.*'],
    employee: ['assisted_selling.threads.view', 'assisted_selling.threads.participate', 'assisted_selling.messages.post', 'cart.proposals.view'],
  },

  // Step 6.1 (§5.10, S7 gap-fill). "Release 5 ships all of §5.10 together with the first
  // route that stores text about a buyer... the staff message route of Phase 1 and the
  // buyer routes of Phase 2 item 1 do not ship without the two sweepers." Both routes
  // already shipped (Steps 4.1/4.5) without them — this closes that gap. Organization-scoped
  // (both `AssistedSellingThread` and the `AssistedSellingStoreSettings` row each sweep joins
  // against are organization-scoped), same granularity `customer_groups`'s sibling
  // `credit-exposure-audit` schedule already uses. `seedDefaults` only runs for brand-new
  // tenants — an existing tenant needs the `assisted_selling.register-schedules` upgrade
  // action (`configs/lib/upgrade-actions.ts`, #8822) to pick these up.
  async seedDefaults({ tenantId, organizationId, container }) {
    await registerAssistedSellingSchedules(container, { tenantId, organizationId })
  },
}

export default setup
