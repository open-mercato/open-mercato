import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { resolveOrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { canReadRecordLockTarget } from '../lib/recordReadAccess'

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScope: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

const tenantId = '60000000-0000-4000-8000-000000000001'
const organizationId = '70000000-0000-4000-8000-000000000001'
const userId = '40000000-0000-4000-8000-000000000001'
const resourceId = '20000000-0000-4000-8000-000000000001'
const target = { tenantId, organizationId, userId, resourceId, resourceKind: 'customers.person' }

function fixture(features: string[]) {
  const findMetadata = jest.fn().mockReturnValue({ class: 'CustomerEntity', properties: { deletedAt: {} } })
  const readEm = { getMetadata: () => ({ getByClassName: findMetadata }) }
  const em = { fork: () => readEm } as unknown as EntityManager
  const rbac = {
    loadAclWithEntityManager: jest.fn().mockResolvedValue({ features, organizations: [organizationId], isSuperAdmin: false }),
  }
  jest.mocked(resolveOrganizationScope).mockResolvedValue({
    tenantId,
    selectedId: organizationId,
    filterIds: [organizationId],
    allowedIds: [organizationId],
  })
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity) => (
    entity === User ? { id: userId, organizationId } : { id: resourceId }
  ) as never)
  return { em, readEm, rbac, findMetadata }
}

beforeEach(() => jest.resetAllMocks())

test.each([
  ['record_locks.view', 'customers.people.view'],
  ['record_locks.view', 'customers.*'],
  ['*'],
])('permits a scoped reader with grants %j', async (...features) => {
  const { em, readEm, rbac } = fixture(features)

  await expect(canReadRecordLockTarget(em, rbac, target)).resolves.toBe(true)

  expect(rbac.loadAclWithEntityManager).toHaveBeenCalledWith(readEm, userId, { tenantId, organizationId })
  expect(findOneWithDecryption).toHaveBeenLastCalledWith(
    readEm,
    'CustomerEntity',
    { id: resourceId, tenantId, organizationId, kind: 'person', deletedAt: null },
    { fields: ['id'] },
    { tenantId, organizationId },
  )
})

test('requires the target read grant before checking if a person exists', async () => {
  const { em, rbac } = fixture(['record_locks.view', 'customers.companies.view'])

  await expect(canReadRecordLockTarget(em, rbac, target)).resolves.toBe(false)

  expect(findOneWithDecryption).toHaveBeenCalledTimes(1)
  expect(findOneWithDecryption).toHaveBeenCalledWith(
    expect.anything(), User, { id: userId, tenantId, deletedAt: null, isConfirmed: true },
    expect.anything(), { tenantId, organizationId },
  )
})

test.each(['catalog.price.kind', 'catalog.price_kind', 'catalog.priceKind'])(
  'uses the catalog price-kind read grant for %s',
  async (resourceKind) => {
    const { em, readEm, rbac, findMetadata } = fixture(['record_locks.view', 'catalog.settings.manage'])
    findMetadata.mockReturnValue({ class: 'CatalogPriceKind', properties: { deletedAt: {} } })

    await expect(canReadRecordLockTarget(em, rbac, { ...target, resourceKind })).resolves.toBe(true)
    expect(findOneWithDecryption).toHaveBeenLastCalledWith(
      readEm,
      'CatalogPriceKind',
      { id: resourceId, tenantId, deletedAt: null },
      { fields: ['id'] },
      { tenantId, organizationId },
    )
  },
)

test('rejects an empty organization scope even with the read feature', async () => {
  const { em, rbac } = fixture(['*'])
  jest.mocked(resolveOrganizationScope).mockResolvedValue({
    tenantId, selectedId: null, allowedIds: [], filterIds: [],
  })

  await expect(canReadRecordLockTarget(em, rbac, target)).resolves.toBe(false)
  expect(findOneWithDecryption).toHaveBeenCalledTimes(1)
})

test('rejects unavailable targets and tenant principals through the same decision', async () => {
  const { em, rbac, findMetadata } = fixture(['*'])
  jest.mocked(findOneWithDecryption).mockResolvedValueOnce({ id: userId, organizationId }).mockResolvedValueOnce(null)
  await expect(canReadRecordLockTarget(em, rbac, target)).resolves.toBe(false)

  jest.mocked(findOneWithDecryption).mockResolvedValueOnce(null)
  await expect(canReadRecordLockTarget(em, rbac, target)).resolves.toBe(false)

  findMetadata.mockReturnValue(undefined)
  await expect(canReadRecordLockTarget(em, rbac, target)).resolves.toBe(false)
  await expect(canReadRecordLockTarget(em, rbac, { ...target, resourceKind: 'unknown.record' })).resolves.toBe(false)
})
