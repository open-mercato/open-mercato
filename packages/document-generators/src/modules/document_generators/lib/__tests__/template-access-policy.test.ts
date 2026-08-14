import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'
import {
  TemplateAccessDeniedError,
  TemplateAccessPolicy,
} from '../template-access-policy'

const auth = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  orgId: 'organization-1',
} as AuthContext

function makeTemplate(id: string, requiredFeatures?: string[]): TemplateMeta {
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
  }
}

describe('TemplateAccessPolicy', () => {
  it('checks required features in the authenticated tenant and organization', async () => {
    const userHasAllFeatures = jest.fn().mockResolvedValue(true)
    const policy = new TemplateAccessPolicy({
      featureAuthorizer: { userHasAllFeatures },
      auth,
    })

    await expect(policy.requireAccess({
      requiredFeatures: ['sales.orders.view'],
    })).resolves.toBeUndefined()

    expect(userHasAllFeatures).toHaveBeenCalledWith('user-1', ['sales.orders.view'], {
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })
  })

  it('rejects a protected template when the caller lacks a required feature', async () => {
    const userHasAllFeatures = jest.fn().mockResolvedValue(false)
    const policy = new TemplateAccessPolicy({
      featureAuthorizer: { userHasAllFeatures },
      auth,
    })

    await expect(policy.requireAccess({
      requiredFeatures: ['sales.quotes.view'],
    })).rejects.toEqual(new TemplateAccessDeniedError(['sales.quotes.view']))
  })

  it('filters protected templates and reuses checks for identical requirements', async () => {
    const userHasAllFeatures = jest.fn(async (_userId: string, features: string[]) => (
      features.includes('sales.orders.view')
    ))
    const policy = new TemplateAccessPolicy({
      featureAuthorizer: { userHasAllFeatures },
      auth,
    })
    const templates = [
      makeTemplate('public'),
      makeTemplate('order-pdf', ['sales.orders.view']),
      makeTemplate('order-markdown', ['sales.orders.view']),
      makeTemplate('quote-pdf', ['sales.quotes.view']),
    ]

    const result = await policy.filterAuthorizedTemplates({ templates })

    expect(result.map((template) => template.id)).toEqual([
      'public',
      'order-pdf',
      'order-markdown',
    ])
    expect(userHasAllFeatures).toHaveBeenCalledTimes(2)
  })
})
