/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import { ensureRoles } from '@open-mercato/core/modules/auth/lib/setup-app'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { FeatureToggle } from '@open-mercato/core/modules/feature_toggles/data/entities'
import features from '../acl'
import setup from '../setup'
import {
  WMS_CUSTOM_ROLE_NAMES,
  WMS_MANAGE_FEATURES,
  WMS_OPERATOR_FEATURES,
  WMS_OPERATOR_ROLE,
  WMS_SUPERVISOR_FEATURES,
  WMS_SUPERVISOR_ROLE,
} from '../lib/roleFeatures'

jest.mock('@open-mercato/core/modules/auth/lib/setup-app', () => ({
  ensureRoles: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn().mockResolvedValue({ id: 'existing-toggle' }),
}))

const mockEnsureRoles = ensureRoles as jest.MockedFunction<typeof ensureRoles>
const mockFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

const ACL_FEATURE_IDS = features.map((feature) => feature.id)

function createEm(registeredEntities: unknown[] = [FeatureToggle]) {
  return {
    persist: jest.fn(),
    create: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    getMetadata: () => ({ find: (entity: unknown) => (registeredEntities.includes(entity) ? { className: 'FeatureToggle' } : undefined) }),
  }
}

describe('wms setup seedDefaults', () => {
  beforeEach(() => {
    mockEnsureRoles.mockClear()
    mockFindOneWithDecryption.mockClear()
    mockFindOneWithDecryption.mockResolvedValue({ id: 'existing-toggle' } as never)
  })

  it('calls ensureRoles with operator and supervisor for the tenant', async () => {
    const em = createEm() as unknown as EntityManager
    const tenantId = 'tenant-abc'

    await setup.seedDefaults?.({ em, tenantId, organizationId: 'org-1', container: {} as never })

    expect(mockEnsureRoles).toHaveBeenCalledTimes(1)
    expect(mockEnsureRoles).toHaveBeenCalledWith(em, {
      tenantId,
      roleNames: [...WMS_CUSTOM_ROLE_NAMES],
    })
    expect(mockEnsureRoles.mock.calls[0]?.[1]?.roleNames).toEqual(['operator', 'supervisor'])
  })

  it('re-invokes ensureRoles on each seedDefaults run (ensureRoles handles idempotency)', async () => {
    const em = createEm() as unknown as EntityManager
    const tenantId = 'tenant-repeat'
    const ctx = { em, tenantId, organizationId: 'org-1', container: {} as never }

    await setup.seedDefaults?.(ctx)
    await setup.seedDefaults?.(ctx)

    expect(mockEnsureRoles).toHaveBeenCalledTimes(2)
    expect(mockEnsureRoles.mock.calls[1]?.[1]).toEqual({
      tenantId,
      roleNames: ['operator', 'supervisor'],
    })
  })
})

describe('wms setup seedDefaults without the feature_toggles module (#9216)', () => {
  beforeEach(() => {
    mockEnsureRoles.mockClear()
    mockFindOneWithDecryption.mockClear()
    mockFindOneWithDecryption.mockResolvedValue(null)
  })

  it('skips the integration toggle seed and still seeds the WMS roles', async () => {
    const em = createEm([])
    const tenantId = 'tenant-no-toggles'

    await setup.seedDefaults?.({ em: em as unknown as EntityManager, tenantId, organizationId: 'org-1', container: {} as never })

    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(mockEnsureRoles).toHaveBeenCalledWith(em, { tenantId, roleNames: ['operator', 'supervisor'] })
  })

  it('seeds the missing integration toggles when the module is enabled', async () => {
    const em = createEm()

    await setup.seedDefaults?.({ em: em as unknown as EntityManager, tenantId: 'tenant-toggles', organizationId: 'org-1', container: {} as never })

    expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(3)
    expect(em.create).toHaveBeenCalledTimes(3)
    expect(em.create.mock.calls.every(([entity]) => entity === FeatureToggle)).toBe(true)
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(mockEnsureRoles).toHaveBeenCalledTimes(1)
  })
})

describe('wms setup role mappings', () => {
  it('declares every acl.ts feature id', () => {
    expect(ACL_FEATURE_IDS).toEqual([
      'wms.view',
      'wms.manage_warehouses',
      'wms.manage_zones',
      'wms.manage_locations',
      'wms.manage_inventory',
      'wms.manage_reservations',
      'wms.adjust_inventory',
      'wms.receive_inventory',
      'wms.manage_asn',
      'wms.manage_putaway',
      'wms.cycle_count',
      'wms.import',
    ])
  })

  it('exports operator and supervisor defaultRoleFeatures', () => {
    expect(setup.defaultRoleFeatures?.[WMS_OPERATOR_ROLE]).toEqual([...WMS_OPERATOR_FEATURES])
    expect(setup.defaultRoleFeatures?.[WMS_SUPERVISOR_ROLE]).toEqual([...WMS_SUPERVISOR_FEATURES])
  })

  it('grants supervisor all manage_* features plus import on top of operator', () => {
    const operatorFeatures = setup.defaultRoleFeatures?.[WMS_OPERATOR_ROLE] ?? []
    const supervisorFeatures = setup.defaultRoleFeatures?.[WMS_SUPERVISOR_ROLE] ?? []

    for (const feature of operatorFeatures) {
      expect(supervisorFeatures).toContain(feature)
    }
    for (const feature of WMS_MANAGE_FEATURES) {
      expect(supervisorFeatures).toContain(feature)
    }
    expect(supervisorFeatures).toContain('wms.import')
  })

  it('restricts operator to floor-staff features and reserves manage_* for supervisor (#4102)', () => {
    const operatorFeatures = setup.defaultRoleFeatures?.[WMS_OPERATOR_ROLE] ?? []

    expect(operatorFeatures).toEqual([
      'wms.view',
      'wms.adjust_inventory',
      'wms.receive_inventory',
      'wms.cycle_count',
    ])
    expect(operatorFeatures).not.toContain('wms.manage_warehouses')
    expect(operatorFeatures).not.toContain('wms.manage_locations')
    for (const feature of WMS_MANAGE_FEATURES) {
      expect(operatorFeatures).not.toContain(feature)
    }
  })

  it('maps only known acl feature ids for custom roles', () => {
    for (const roleName of WMS_CUSTOM_ROLE_NAMES) {
      const roleFeatures = setup.defaultRoleFeatures?.[roleName] ?? []
      for (const feature of roleFeatures) {
        expect(ACL_FEATURE_IDS).toContain(feature)
      }
    }
  })

  it('keeps built-in admin and employee grants', () => {
    expect(setup.defaultRoleFeatures?.admin).toEqual(['wms.*'])
    expect(setup.defaultRoleFeatures?.employee).toEqual(['wms.view'])
  })
})
