import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

// All nine cart.* ACL features (§10.3, §6a.4) gate staff/admin surfaces only — admin cart
// inspection, settings, proposal authoring, and non-storefront channel creation. A buyer's
// own cart access is token-based (X-Cart-Token, §8.3), never ACL-gated, so there is no
// defaultCustomerRoleFeatures entry here.
//
// The four `cart.channel.*` features (§6a.4) gate a privileged capability — creating a
// cart outside the public storefront path, on behalf of a POS terminal, a pay-link flow,
// an AI agent, or a trusted API caller. `superadmin`/`admin` get them via the existing
// `cart.*` wildcard (same as every other cart.* feature). `employee` deliberately does NOT
// get any of them by default: an ordinary staff member viewing carts (`cart.carts.view`)
// has no business minting a `pos`/`pay_link`/`agent`/`api` cart — that is an integration
// credential, not a day-to-day staff action, and over-granting it would let any employee
// account sidestep §6a's storefront assortment-visibility enforcement by channel choice
// alone. Grant `cart.channel.<x>` per-role or per-integration-user explicitly instead.
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['cart.*'],
    admin: ['cart.*'],
    employee: ['cart.carts.view'],
  },
}

export default setup
