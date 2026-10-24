import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    // `.inspect_payloads` is superadmin-only and deliberately excluded from `admin`
    // (#3105 — Tier 2 reads raw, potentially cross-tenant job payloads).
    superadmin: [
      'configs.system_status.view',
      'configs.cache.view',
      'configs.cache.manage',
      'configs.manage',
      'configs.queues_status.view',
      'configs.queues_status.inspect_payloads',
    ],
    admin: [
      'configs.system_status.view',
      'configs.cache.view',
      'configs.cache.manage',
      'configs.manage',
      'configs.queues_status.view',
    ],
  },
}

export default setup
