import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { TemplateEntry } from '@open-mercato/shared/modules/document-generators'
import { templateRegistry } from '../../../lib/template-registry'
import {
  filterTemplatesByAccess,
  requireTemplateAccess,
  TemplateAccessDeniedError,
} from '../template-access'

const auth = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  orgId: 'organization-1',
} as AuthContext

function makeEntry(id: string, requiredFeatures?: string[]): TemplateEntry {
  return {
    id,
    label: id,
    description: id,
    module: 'example',
    resourceKind: 'example.record',
    documentType: 'report',
    format: 'pdf',
    tags: [],
    requiredFeatures,
    fromRecord: () => ({}),
    filename: () => `${id}.pdf`,
    resourceId: () => 'record-1',
    load: async () => ({ type: 'test' }),
  }
}

function makeContainer(userHasAllFeatures: jest.Mock): AppContainer {
  return {
    resolve: jest.fn((name: string) => {
      if (name === 'rbacService') return { userHasAllFeatures }
      throw new Error(`Unknown service: ${name}`)
    }),
  } as unknown as AppContainer
}

beforeAll(() => {
  templateRegistry.register([
    makeEntry('template-access.public'),
    makeEntry('template-access.allowed', ['sales.orders.view']),
    makeEntry('template-access.denied', ['sales.quotes.view']),
  ])
})

describe('template access', () => {
  it('checks required features in the authenticated tenant and organization', async () => {
    const userHasAllFeatures = jest.fn().mockResolvedValue(true)

    await expect(requireTemplateAccess('template-access.allowed', {
      container: makeContainer(userHasAllFeatures),
      auth,
    })).resolves.toBeUndefined()

    expect(userHasAllFeatures).toHaveBeenCalledWith('user-1', ['sales.orders.view'], {
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })
  })

  it('rejects access before a protected template can be loaded', async () => {
    const userHasAllFeatures = jest.fn().mockResolvedValue(false)

    await expect(requireTemplateAccess('template-access.denied', {
      container: makeContainer(userHasAllFeatures),
      auth,
    })).rejects.toEqual(new TemplateAccessDeniedError(['sales.quotes.view']))
  })

  it('filters protected templates while retaining templates without source requirements', async () => {
    const userHasAllFeatures = jest.fn(async (_userId: string, features: string[]) => (
      features.includes('sales.orders.view')
    ))
    const templates = templateRegistry.listTemplates()

    const result = await filterTemplatesByAccess(templates, {
      container: makeContainer(userHasAllFeatures),
      auth,
    })

    expect(result.map((template) => template.id)).toEqual([
      'template-access.public',
      'template-access.allowed',
    ])
  })
})
