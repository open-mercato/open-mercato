import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * Default role grants (spec § Access Control). The module-specific roles
 * mirror the manufacturing personas: technolog (technology), planista
 * (orders + MRP), kierownik (reports oversight), magazynier-lite (stock),
 * operator (shop-floor surface ONLY — spec decision e).
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['production.*'],
    employee: [
      'production.technology.view',
      'production.orders.view',
      'production.reports.view',
    ],
    technolog: [
      'production.technology.view',
      'production.technology.manage',
      'production.orders.view',
    ],
    planista: [
      'production.technology.view',
      'production.stock.view',
      'production.orders.view',
      'production.orders.manage',
      'production.reports.view',
      'production.mrp.view',
      'production.mrp.manage',
    ],
    kierownik: [
      'production.technology.view',
      'production.stock.view',
      'production.orders.view',
      'production.reports.view',
      'production.reports.manage',
      'production.mrp.view',
    ],
    'magazynier-lite': [
      'production.stock.view',
      'production.stock.manage',
      'production.orders.view',
    ],
    operator: [
      'production.operator.view',
      'production.operator.report',
    ],
  },
}

export default setup
