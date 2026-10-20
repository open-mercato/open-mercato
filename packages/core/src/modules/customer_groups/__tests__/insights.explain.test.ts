import fs from 'node:fs'
import path from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ExplainLoadContext, ExplainScope } from '@open-mercato/shared/modules/insights/explain'

const findOneWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

import explainConfig, { CUSTOMER_GROUP_EXPLAIN_RESOURCE_KIND } from '../insights.explain'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const GROUP_ID = '44444444-4444-4444-8444-444444444444'
const LOCALES = ['en', 'pl', 'de', 'es', 'ko'] as const

function buildContext(scope: Partial<ExplainScope> = {}): ExplainLoadContext {
  return {
    em: {} as EntityManager,
    resolve: () => undefined,
    scope: { tenantId: TENANT_ID, organizationIds: null, ...scope },
    userId: null,
    locale: 'en',
  }
}

function getResource() {
  const resource = explainConfig.resources?.[0]
  if (!resource) throw new Error('[internal] missing customer group resource')
  return resource
}

describe('customer_groups insights.explain', () => {
  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
  })

  it('declares a no-history resource because group CRUD bypasses the command bus', () => {
    expect(explainConfig.version).toBe(1)
    const resource = getResource()
    expect(resource.resourceKind).toBe(CUSTOMER_GROUP_EXPLAIN_RESOURCE_KIND)
    expect(resource.resourceKind).toBe('customer_groups.group')
    expect(resource.logResourceKinds).toEqual([])
    expect(resource.noHistory).toEqual({ reasonKey: 'customer_groups.insights.noHistory' })
    expect(resource.requiredFeatures).toEqual(['customer_groups.groups.view'])
    expect(resource.fields.map((field) => [field.key, field.currentPath, field.snapshotPaths, field.changeKeys])).toEqual([
      ['name', 'name', [], []],
      ['isActive', 'isActive', [], []],
    ])
    expect(resource.recordHref?.(GROUP_ID)).toBe(`/backend/customer-groups/${GROUP_ID}/edit`)
  })

  it('declares every referenced label key in all locales', () => {
    const resource = getResource()
    const keys = [resource.labelKey, resource.noHistory?.reasonKey ?? '', ...resource.fields.map((field) => field.labelKey)]
    for (const locale of LOCALES) {
      const dictionary = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', `${locale}.json`), 'utf8')) as Record<string, string>
      for (const key of keys) expect({ locale, key, present: typeof dictionary[key] === 'string' }).toEqual({ locale, key, present: true })
    }
  })

  it('reads tenant-wide for an unrestricted scope', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce({
      id: GROUP_ID,
      organizationId: null,
      name: 'Wholesale',
      isActive: true,
      updatedAt: new Date('2026-10-08T09:00:00.000Z'),
    })
    const current = await getResource().loadCurrent(buildContext(), GROUP_ID)
    const [, , where, , scope] = findOneWithDecryptionMock.mock.calls[0]
    expect(where).toEqual({ id: GROUP_ID, tenantId: TENANT_ID, deletedAt: null })
    expect(scope).toEqual({ tenantId: TENANT_ID, organizationId: null })
    expect(current).toEqual({
      id: GROUP_ID,
      organizationId: null,
      updatedAt: '2026-10-08T09:00:00.000Z',
      name: 'Wholesale',
      isActive: true,
    })
  })

  it('keeps tenant-shared groups visible to organization-scoped viewers', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(null)
    await expect(getResource().loadCurrent(buildContext({ organizationIds: [ORG_A] }), GROUP_ID)).resolves.toBeNull()
    const [, , where] = findOneWithDecryptionMock.mock.calls[0]
    expect(where).toEqual({
      id: GROUP_ID,
      tenantId: TENANT_ID,
      deletedAt: null,
      $or: [{ organizationId: null }, { organizationId: { $in: [ORG_A] } }],
    })
  })

  it('denies an empty organization scope and invalid ids without querying', async () => {
    await expect(getResource().loadCurrent(buildContext({ organizationIds: [] }), GROUP_ID)).resolves.toBeNull()
    await expect(getResource().loadCurrent(buildContext(), 'group-1')).resolves.toBeNull()
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
  })
})
