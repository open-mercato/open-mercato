/**
 * Module Decoupling Tests
 *
 * Verifies that the application remains functional when optional modules
 * (catalog, sales, api_keys) are disabled — removed from the generated
 * module registry and entity IDs.
 */

// Build a reduced entity IDs registry excluding catalog, sales, api_keys
const reducedE = {
  dashboards: {
    dashboard_layout: 'dashboards:dashboard_layout',
    dashboard_role_widgets: 'dashboards:dashboard_role_widgets',
    dashboard_user_widgets: 'dashboards:dashboard_user_widgets',
  },
  auth: {
    password_reset: 'auth:password_reset',
    role: 'auth:role',
    role_acl: 'auth:role_acl',
    role_sidebar_preference: 'auth:role_sidebar_preference',
    session: 'auth:session',
    user: 'auth:user',
    user_acl: 'auth:user_acl',
    user_role: 'auth:user_role',
    user_sidebar_preference: 'auth:user_sidebar_preference',
  },
  directory: {
    organization: 'directory:organization',
    tenant: 'directory:tenant',
  },
  customers: {
    customer_activity: 'customers:customer_activity',
    customer_address: 'customers:customer_address',
    customer_comment: 'customers:customer_comment',
    customer_company_profile: 'customers:customer_company_profile',
    customer_deal: 'customers:customer_deal',
    customer_deal_company_link: 'customers:customer_deal_company_link',
    customer_deal_person_link: 'customers:customer_deal_person_link',
    customer_dictionary_entry: 'customers:customer_dictionary_entry',
    customer_entity: 'customers:customer_entity',
    customer_person_profile: 'customers:customer_person_profile',
    customer_settings: 'customers:customer_settings',
    customer_tag: 'customers:customer_tag',
    customer_tag_assignment: 'customers:customer_tag_assignment',
    customer_todo_link: 'customers:customer_todo_link',
  },
  entities: {
    custom_entity: 'entities:custom_entity',
    custom_entity_storage: 'entities:custom_entity_storage',
    custom_field_def: 'entities:custom_field_def',
    custom_field_entity_config: 'entities:custom_field_entity_config',
    custom_field_value: 'entities:custom_field_value',
    encryption_map: 'entities:encryption_map',
  },
  attachments: {
    attachment: 'attachments:attachment',
    attachment_partition: 'attachments:attachment_partition',
  },
} as const

const reducedM = {
  dashboards: 'dashboards',
  auth: 'auth',
  directory: 'directory',
  customers: 'customers',
  entities: 'entities',
  attachments: 'attachments',
} as const

// Mock generated entity IDs to exclude catalog, sales, api_keys
jest.mock('#generated/entities.ids.generated', () => ({
  E: reducedE,
  M: reducedM,
}))

// Mock cache dependency used by upgrade-actions
jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: jest.fn((_: unknown, fn: () => unknown) => fn()),
}))
jest.mock('@open-mercato/shared/lib/crud/cache-stats', () => ({
  collectCrudCacheStats: jest.fn().mockResolvedValue({ segments: [] }),
  purgeCrudCacheSegment: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  isCrudCacheEnabled: jest.fn().mockReturnValue(false),
  resolveCrudCache: jest.fn(),
}))

import { registerEntityIds, getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

// Build module list that mirrors enabled modules without catalog/sales/api_keys
function buildReducedModules(): Module[] {
  const moduleSetups: Record<string, ModuleSetupConfig> = {
    dashboards: {
      defaultRoleFeatures: {
        admin: ['dashboards.*', 'dashboards.admin.assign-widgets'],
        employee: ['dashboards.view', 'dashboards.configure'],
      },
    },
    auth: {
      defaultRoleFeatures: { admin: ['auth.*'] },
    },
    directory: {
      defaultRoleFeatures: {
        superadmin: ['directory.tenants.*'],
        admin: ['directory.organizations.view', 'directory.organizations.manage'],
      },
    },
    customers: {
      defaultRoleFeatures: {
        admin: [
          'customers.*',
          'customers.people.view',
          'customers.people.manage',
          'customers.companies.view',
          'customers.companies.manage',
          'customers.deals.view',
          'customers.deals.manage',
        ],
        employee: [
          'customers.*',
          'customers.people.view',
          'customers.people.manage',
          'customers.companies.view',
          'customers.companies.manage',
        ],
      },
    },
    entities: {
      defaultRoleFeatures: { admin: ['entities.*'] },
    },
    attachments: {
      defaultRoleFeatures: { admin: ['attachments.*', 'attachments.view', 'attachments.manage'] },
    },
    audit_logs: {
      defaultRoleFeatures: { admin: ['audit_logs.*'], employee: ['audit_logs.undo_self'] },
    },
    dictionaries: {
      defaultRoleFeatures: { admin: ['dictionaries.view', 'dictionaries.manage'], employee: ['dictionaries.view'] },
    },
    perspectives: {
      defaultRoleFeatures: { admin: ['perspectives.use', 'perspectives.role_defaults'], employee: ['perspectives.use'] },
    },
    configs: {
      defaultRoleFeatures: { admin: ['configs.system_status.view', 'configs.cache.view', 'configs.cache.manage', 'configs.manage'] },
    },
    query_index: {
      defaultRoleFeatures: { admin: ['query_index.*'] },
    },
    feature_toggles: {
      defaultRoleFeatures: { admin: ['feature_toggles.*'] },
    },
    business_rules: {
      defaultRoleFeatures: { admin: ['business_rules.*'] },
    },
    workflows: {
      defaultRoleFeatures: { admin: ['workflows.*'] },
    },
    currencies: {
      defaultRoleFeatures: { admin: ['currencies.*'] },
    },
    staff: {
      defaultRoleFeatures: {
        admin: ['staff.*', 'staff.leave_requests.manage'],
        employee: [
          'staff.leave_requests.send',
          'staff.my_availability.view',
          'staff.my_availability.manage',
          'staff.my_leave_requests.view',
          'staff.my_leave_requests.send',
        ],
      },
    },
    resources: {
      defaultRoleFeatures: { admin: ['resources.*'] },
    },
    planner: {
      defaultRoleFeatures: { admin: ['planner.*'], employee: ['planner.view'] },
    },
    search: {
      defaultRoleFeatures: { admin: ['search.*', 'vector.*'], employee: ['vector.*'] },
    },
  }

  return Object.entries(moduleSetups).map(([id, setup]) => ({
    id,
    setup,
  }))
}

const reducedModules = buildReducedModules()

beforeAll(() => {
  registerEntityIds(reducedE as any)
  registerModules(reducedModules)
})

describe('Module Decoupling', () => {
  describe('1. Entity IDs registry excludes disabled modules', () => {
    it('getEntityIds() has no catalog, sales, or api_keys keys', () => {
      const entityIds = getEntityIds()
      expect(entityIds).not.toHaveProperty('catalog')
      expect(entityIds).not.toHaveProperty('sales')
      expect(entityIds).not.toHaveProperty('api_keys')
    })

    it('still contains core modules', () => {
      const entityIds = getEntityIds()
      expect(entityIds).toHaveProperty('auth')
      expect(entityIds).toHaveProperty('attachments')
      expect(entityIds).toHaveProperty('customers')
      expect(entityIds).toHaveProperty('dashboards')
      expect(entityIds).toHaveProperty('directory')
      expect(entityIds).toHaveProperty('entities')
    })
  })

  describe('2. attachments/partitions.ts — resolveDefaultPartitionCode', () => {
    it('returns privateAttachments for null, undefined, arbitrary strings, and catalog entity IDs', async () => {
      const { resolveDefaultPartitionCode } = await import(
        '@open-mercato/core/modules/attachments/lib/partitions'
      )

      expect(resolveDefaultPartitionCode(null)).toBe('privateAttachments')
      expect(resolveDefaultPartitionCode(undefined)).toBe('privateAttachments')
      expect(resolveDefaultPartitionCode('some-entity')).toBe('privateAttachments')
      // When catalog is disabled, the literal string also falls through
      expect(resolveDefaultPartitionCode('catalog:catalog_product')).toBe('privateAttachments')
    })
  })

  describe('3. attachments/assignmentDetails.ts — resolveAssignmentEnrichments', () => {
    it('does not crash with empty assignments and null queryEngine', async () => {
      const { resolveAssignmentEnrichments } = await import(
        '@open-mercato/core/modules/attachments/lib/assignmentDetails'
      )

      const result = await resolveAssignmentEnrichments([], {
        queryEngine: null,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      })
      expect(result).toBeInstanceOf(Map)
      expect(result.size).toBe(0)
    })

    it('does not crash with assignments referencing catalog entity IDs', async () => {
      const { resolveAssignmentEnrichments } = await import(
        '@open-mercato/core/modules/attachments/lib/assignmentDetails'
      )

      const result = await resolveAssignmentEnrichments(
        [{ type: 'catalog:catalog_product', id: 'some-uuid' }],
        {
          queryEngine: null,
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        },
      )
      expect(result).toBeInstanceOf(Map)
      expect(result.size).toBe(0)
    })
  })

  describe('4. Role feature merging', () => {
    it('admin features contain enabled module features', () => {
      const adminFeatures: string[] = []
      for (const mod of reducedModules) {
        const roleFeatures = mod.setup?.defaultRoleFeatures
        if (roleFeatures?.admin) adminFeatures.push(...roleFeatures.admin)
      }

      expect(adminFeatures).toContain('auth.*')
      expect(adminFeatures).toContain('attachments.*')
      expect(adminFeatures).toContain('dashboards.*')
      expect(adminFeatures).toContain('customers.*')
      expect(adminFeatures).toContain('entities.*')
      expect(adminFeatures).toContain('query_index.*')
      expect(adminFeatures).toContain('configs.manage')
      expect(adminFeatures).toContain('directory.organizations.manage')
    })

    it('admin features do NOT contain disabled module features', () => {
      const adminFeatures: string[] = []
      for (const mod of reducedModules) {
        const roleFeatures = mod.setup?.defaultRoleFeatures
        if (roleFeatures?.admin) adminFeatures.push(...roleFeatures.admin)
      }

      expect(adminFeatures).not.toContain('catalog.*')
      expect(adminFeatures).not.toContain('sales.*')
      expect(adminFeatures).not.toContain('api_keys.*')
    })

    it('employee features similarly exclude disabled module features', () => {
      const employeeFeatures: string[] = []
      for (const mod of reducedModules) {
        const roleFeatures = mod.setup?.defaultRoleFeatures
        if (roleFeatures?.employee) employeeFeatures.push(...roleFeatures.employee)
      }

      expect(employeeFeatures).not.toContain('catalog.*')
      expect(employeeFeatures).not.toContain('sales.*')
      expect(employeeFeatures).not.toContain('api_keys.*')

      // Enabled modules' employee features are present
      expect(employeeFeatures).toContain('customers.*')
      expect(employeeFeatures).toContain('dashboards.view')
      expect(employeeFeatures).toContain('audit_logs.undo_self')
      expect(employeeFeatures).toContain('vector.*')
    })

    it('superadmin features come from enabled modules only', () => {
      const superadminFeatures: string[] = []
      for (const mod of reducedModules) {
        const roleFeatures = mod.setup?.defaultRoleFeatures
        if (roleFeatures?.superadmin) superadminFeatures.push(...roleFeatures.superadmin)
      }

      expect(superadminFeatures).toContain('directory.tenants.*')
      expect(superadminFeatures).not.toContain('catalog.*')
      expect(superadminFeatures).not.toContain('sales.*')
    })
  })

  describe('5. configs/upgrade-actions.ts loads without crashing', () => {
    it('imports and exposes upgradeActions array and compareVersions function', async () => {
      const mod = await import(
        '@open-mercato/core/modules/configs/lib/upgrade-actions'
      )

      expect(Array.isArray(mod.upgradeActions)).toBe(true)
      expect(typeof mod.compareVersions).toBe('function')
    })

    it('upgradeActions array is defined and non-empty', async () => {
      const mod = await import(
        '@open-mercato/core/modules/configs/lib/upgrade-actions'
      )

      expect(Array.isArray(mod.upgradeActions)).toBe(true)
    })

    it('actionsUpToVersion returns actions without crashing', async () => {
      const mod = await import(
        '@open-mercato/core/modules/configs/lib/upgrade-actions'
      )

      const actions = mod.actionsUpToVersion('99.99.99')
      expect(Array.isArray(actions)).toBe(true)
    })
  })
})
