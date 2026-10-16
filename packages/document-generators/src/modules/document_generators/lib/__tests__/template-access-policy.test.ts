import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'
import { TemplateAccessPolicy } from '../template-access-policy'
import { TemplateAccessDeniedError } from '../template-errors'

const auth = { sub: 'subject', tenantId: 'tenant', orgId: 'org' }

function template(id: string, requiredFeatures?: string[]): TemplateMeta {
  return { id, label: id, description: id, module: 'sales', resourceKind: 'sales.order', documentType: 'invoice', format: 'pdf', tags: [], requiredFeatures }
}

describe('TemplateAccessPolicy', () => {
  it('omits denied templates from catalogue but rejects a named denied template', async () => {
    const userHasAllFeatures = jest.fn(async (_user: string, features: string[]) => features.length === 1 && features[0] === 'sales.orders.view')
    const policy = new TemplateAccessPolicy({ auth, featureAuthorizer: { userHasAllFeatures } })
    const visible = template('visible', ['sales.orders.view'])
    const denied = template('denied', ['sales.quotes.view'])
    expect(await policy.filterAuthorizedTemplates({ templates: [visible, denied] })).toEqual([visible])
    await expect(policy.requireAccess(denied)).rejects.toMatchObject({ name: 'TemplateAccessDeniedError', requiredFeatures: denied.requiredFeatures })
    await expect(policy.requireAccess(visible)).resolves.toBeUndefined()
    expect(userHasAllFeatures).toHaveBeenCalledWith('subject', ['sales.orders.view'], { tenantId: 'tenant', organizationId: 'org' })
  })

  it('fails closed without a subject and allows only templates with no cross-module requirements', async () => {
    const userHasAllFeatures = jest.fn(async () => true)
    const policy = new TemplateAccessPolicy({ auth: null, featureAuthorizer: { userHasAllFeatures } })
    await expect(policy.requireAccess({ requiredFeatures: ['sales.*'] })).rejects.toBeInstanceOf(TemplateAccessDeniedError)
    await expect(policy.requireAccess({})).resolves.toBeUndefined()
    await expect(policy.requireAccess({ requiredFeatures: [] })).resolves.toBeUndefined()
    expect(userHasAllFeatures).not.toHaveBeenCalled()
  })

  it('deduplicates equivalent feature sets within each catalogue call but never across calls', async () => {
    const userHasAllFeatures = jest.fn(async () => true)
    const policy = new TemplateAccessPolicy({ auth, featureAuthorizer: { userHasAllFeatures } })
    const templates = [template('one', ['b.view', 'a.view']), template('two', ['a.view', 'b.view', 'a.view'])]
    expect(await policy.filterAuthorizedTemplates({ templates })).toEqual(templates)
    expect(userHasAllFeatures).toHaveBeenCalledTimes(1)
    userHasAllFeatures.mockResolvedValue(false)
    expect(await policy.filterAuthorizedTemplates({ templates })).toEqual([])
    expect(userHasAllFeatures).toHaveBeenCalledTimes(2)
  })

  it('delegates wildcard semantics to the realm authorizer and propagates authorization failures', async () => {
    const userHasAllFeatures = jest.fn(async () => true)
    const policy = new TemplateAccessPolicy({ auth, featureAuthorizer: { userHasAllFeatures } })
    await expect(policy.requireAccess({ requiredFeatures: ['sales.*'] })).resolves.toBeUndefined()
    expect(userHasAllFeatures).toHaveBeenCalledWith('subject', ['sales.*'], { tenantId: 'tenant', organizationId: 'org' })
    userHasAllFeatures.mockRejectedValue(new Error('RBAC unavailable'))
    await expect(policy.filterAuthorizedTemplates({ templates: [template('one', ['sales.*'])] })).rejects.toThrow('RBAC unavailable')
  })
})
