import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { DocumentTemplate } from '../data/entities'

const mockFindOneWithDecryption = jest.fn()
const mockResolveDocumentsCommandFeatures = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return {
    ...actual,
    resolveDocumentsCommandActor: () => USER_ID,
    resolveDocumentsCommandFeatures: (...args: unknown[]) => mockResolveDocumentsCommandFeatures(...args),
    resolveDocumentsCommandScope: () => ({ tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }),
  }
})

import { createTemplateCommand, type TemplateCreateCommandInput } from '../commands/templates'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const TEMPLATE_ID = '44444444-4444-4444-8444-444444444444'

describe('document template command identity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindOneWithDecryption.mockResolvedValue(null)
    mockResolveDocumentsCommandFeatures.mockResolvedValue(['documents.templates.manage'])
  })

  it('persists the caller-stable template id used by undo and redo', async () => {
    const em = {
      begin: jest.fn(),
      flush: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => (
        Object.assign(new DocumentTemplate(), data)
      )),
      persist: jest.fn(),
    } as unknown as EntityManager
    const input: TemplateCreateCommandInput = {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      templateId: TEMPLATE_ID,
      actorUserId: USER_ID,
      template: { name: 'Review', bodyHtml: '<p>Review</p>' },
    }
    const ctx = {
      transactionalEm: em,
      container: { resolve: jest.fn() },
      auth: { userId: USER_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_ID },
      selectedOrganizationId: ORGANIZATION_ID,
    } as unknown as CommandRuntimeContext

    const result = await createTemplateCommand.execute(input, ctx)

    expect(result.id).toBe(TEMPLATE_ID)
    expect(em.create).toHaveBeenCalledWith(DocumentTemplate, expect.objectContaining({
      id: TEMPLATE_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    }))
    expect(em.persist).toHaveBeenCalledWith(expect.objectContaining({ id: TEMPLATE_ID }))
  })
})
