import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { QueryOptions, QueryResult } from '@open-mercato/shared/lib/query/types'
import { getEntityIds, registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'

const createOrGetClaimFromInboundMessageMock = jest.fn<Promise<unknown>, [unknown]>()
const queryEmailMock = jest.fn<Promise<QueryResult<Record<string, unknown>>>, [EntityId, QueryOptions?]>()

function makeEmitterPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    emailId: '33333333-3333-4333-8333-333333333333',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    forwardedByAddress: 'buyer@example.com',
    subject: 'Warranty request',
    ...overrides,
  }
}

jest.mock('../lib/emailIntake', () => ({
  createOrGetClaimFromInboundMessage: (input: unknown) => createOrGetClaimFromInboundMessageMock(input),
}))

import handle from '../subscribers/email-to-claim'

type ModuleConfigGetValue = ModuleConfigService['getValue']
type ModuleConfigGetValueArgs = Parameters<ModuleConfigGetValue>

function makePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    messageId: 'email-1',
    senderEmail: 'buyer@example.com',
    senderName: 'Buyer Name',
    subject: 'Warranty request',
    body: 'Pump does not power on.',
    ...overrides,
  }
}

function makeEntityManager(): EntityManager {
  return {
    fork: jest.fn(() => ({})),
  } as unknown as EntityManager
}

function makeConfigService(value: unknown): Pick<ModuleConfigService, 'getValue'> {
  return {
    getValue: jest.fn<ReturnType<ModuleConfigGetValue>, ModuleConfigGetValueArgs>(async () => value),
  }
}

function makeContext(options: {
  moduleConfigService?: Pick<ModuleConfigService, 'getValue'>
  includeModuleConfigService?: boolean
  includeQueryEngine?: boolean
  em?: EntityManager
  tenantId?: string | null
  organizationId?: string | null
} = {}) {
  const em = options.em ?? makeEntityManager()
  const includeModuleConfigService = options.includeModuleConfigService ?? true
  return {
    tenantId: options.tenantId === undefined ? TENANT_ID : options.tenantId,
    organizationId: options.organizationId === undefined ? ORG_ID : options.organizationId,
    resolve: <T = unknown>(name: string): T => {
      if (name === 'em') return em as T
      if (name === 'queryEngine' && options.includeQueryEngine !== false) return { query: queryEmailMock } as T
      if (name === 'moduleConfigService' && includeModuleConfigService && options.moduleConfigService) {
        return options.moduleConfigService as T
      }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }
}

describe('warranty claim email-to-claim subscriber opt-in gate', () => {
  const originalEnv = process.env.OM_WARRANTY_EMAIL_INTAKE
  const originalEntityIds = getEntityIds(false)

  beforeEach(() => {
    createOrGetClaimFromInboundMessageMock.mockReset()
    createOrGetClaimFromInboundMessageMock.mockResolvedValue({ claimId: 'claim-1', created: true })
    queryEmailMock.mockReset()
    queryEmailMock.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 1 })
    registerEntityIds({ inbox_ops: { inbox_email: 'inbox_ops:inbox_email' } })
    delete process.env.OM_WARRANTY_EMAIL_INTAKE
  })

  afterAll(() => {
    registerEntityIds(originalEntityIds)
    if (originalEnv === undefined) delete process.env.OM_WARRANTY_EMAIL_INTAKE
    else process.env.OM_WARRANTY_EMAIL_INTAKE = originalEnv
  })

  test('no-ops when tenant config is absent', async () => {
    const moduleConfigService = makeConfigService(null)

    await handle(makePayload(), makeContext({ moduleConfigService }))

    expect(moduleConfigService.getValue).toHaveBeenCalledWith('warranty_claims', 'emailIntakeEnabled', {
      defaultValue: null,
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
    })
    expect(createOrGetClaimFromInboundMessageMock).not.toHaveBeenCalled()
  })

  test('creates a claim when tenant config explicitly enables intake', async () => {
    const moduleConfigService = makeConfigService(true)

    await handle(makePayload(), makeContext({ moduleConfigService }))

    expect(createOrGetClaimFromInboundMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      contactEmail: 'buyer@example.com',
      customerName: 'Buyer Name',
      subject: 'Warranty request',
      body: 'Pump does not power on.',
      intakeMessageRef: 'email-1',
    }))
    expect(queryEmailMock).not.toHaveBeenCalled()
  })

  test('hydrates the real emitter payload through a bounded query in the trusted scope', async () => {
    queryEmailMock.mockResolvedValue({
      items: [{ cleaned_text: '  Pump stopped after ten minutes.  ', raw_text: 'Raw email with quoted history' }],
      total: 1,
      page: 1,
      pageSize: 1,
    })

    await handle(makeEmitterPayload({ tenantId: 'hostile-tenant', organizationId: 'hostile-org' }), makeContext({ moduleConfigService: makeConfigService(true) }))

    expect(queryEmailMock).toHaveBeenCalledWith('inbox_ops:inbox_email', {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      filters: {
        id: '33333333-3333-4333-8333-333333333333',
        tenant_id: TENANT_ID,
        organization_id: ORG_ID,
        deleted_at: null,
      },
      fields: ['id', 'cleaned_text', 'raw_text', 'tenant_id', 'organization_id'],
      page: { page: 1, pageSize: 1 },
    })
    expect(createOrGetClaimFromInboundMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      body: 'Pump stopped after ten minutes.',
      intakeMessageRef: '33333333-3333-4333-8333-333333333333',
      contactEmail: 'buyer@example.com',
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
    }))
  })

  test('falls back to raw text and bounds the copied email body', async () => {
    queryEmailMock.mockResolvedValue({
      items: [{ cleaned_text: '  ', raw_text: 'Failure description. '.repeat(500) }],
      total: 1,
      page: 1,
      pageSize: 1,
    })

    await handle(makeEmitterPayload(), makeContext({ moduleConfigService: makeConfigService(true) }))

    expect(createOrGetClaimFromInboundMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      body: 'Failure description. '.repeat(500).slice(0, 8000),
    }))
  })

  test('does not copy ciphertext when the query engine cannot decrypt the email', async () => {
    const encrypted = 'tO7TyMk5X1EdR4K1:jtiaFLv2DE/ITjAAuEE=:RqYjgUkWp75s5n3aBf5Ixg==:v1'
    queryEmailMock.mockResolvedValue({
      items: [{ cleaned_text: encrypted, raw_text: encrypted }],
      total: 1,
      page: 1,
      pageSize: 1,
    })

    await handle(makeEmitterPayload(), makeContext({ moduleConfigService: makeConfigService(true) }))

    expect(createOrGetClaimFromInboundMessageMock).toHaveBeenCalledWith(expect.objectContaining({ body: null }))
  })

  test('preserves intake when the stored email is outside the scope or missing', async () => {
    await handle(makeEmitterPayload(), makeContext({ moduleConfigService: makeConfigService(true) }))

    expect(createOrGetClaimFromInboundMessageMock).toHaveBeenCalledWith(expect.objectContaining({ body: null }))
  })

  test('preserves intake when InboxOps is not registered', async () => {
    registerEntityIds({})

    await handle(makeEmitterPayload(), makeContext({ moduleConfigService: makeConfigService(true) }))

    expect(queryEmailMock).not.toHaveBeenCalled()
    expect(createOrGetClaimFromInboundMessageMock).toHaveBeenCalledWith(expect.objectContaining({ body: null }))
  })

  test('preserves intake when the optional query service is unavailable', async () => {
    await handle(makeEmitterPayload(), makeContext({ moduleConfigService: makeConfigService(true), includeQueryEngine: false }))

    expect(queryEmailMock).not.toHaveBeenCalled()
    expect(createOrGetClaimFromInboundMessageMock).toHaveBeenCalledWith(expect.objectContaining({ body: null }))
  })

  test('preserves intake when the optional email lookup fails', async () => {
    queryEmailMock.mockRejectedValue(new Error('[internal] query unavailable'))

    await handle(makeEmitterPayload(), makeContext({ moduleConfigService: makeConfigService(true) }))

    expect(createOrGetClaimFromInboundMessageMock).toHaveBeenCalledWith(expect.objectContaining({ body: null }))
  })

  test('uses trusted subscriber scope when payload scope is hostile', async () => {
    const moduleConfigService = makeConfigService(true)

    await handle(makePayload({ tenantId: 'hostile-tenant', organizationId: 'hostile-org' }), makeContext({ moduleConfigService }))

    expect(moduleConfigService.getValue).toHaveBeenCalledWith('warranty_claims', 'emailIntakeEnabled', {
      defaultValue: null,
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
    })
    expect(createOrGetClaimFromInboundMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
    }))
  })

  test('propagates claim creation failures to persistent delivery', async () => {
    const failure = new Error('Temporary database failure')
    createOrGetClaimFromInboundMessageMock.mockRejectedValueOnce(failure)

    await expect(handle(makePayload(), makeContext({ moduleConfigService: makeConfigService(true) })))
      .rejects.toBe(failure)
  })

  test('propagates entity manager failures to persistent delivery', async () => {
    const failure = new Error('Temporary connection failure')
    const em = makeEntityManager()
    jest.spyOn(em, 'fork').mockImplementationOnce(() => { throw failure })

    await expect(handle(makePayload(), makeContext({ moduleConfigService: makeConfigService(true), em })))
      .rejects.toBe(failure)
    expect(createOrGetClaimFromInboundMessageMock).not.toHaveBeenCalled()
  })

  test.each([
    { messageId: null },
    { senderEmail: '  ' },
  ])('no-ops for incomplete email input %j', async (overrides) => {
    await expect(handle(makePayload(overrides), makeContext({ moduleConfigService: makeConfigService(true) })))
      .resolves.toBeUndefined()
    expect(createOrGetClaimFromInboundMessageMock).not.toHaveBeenCalled()
  })

  test('fails closed when trusted subscriber scope is absent even if payload carries scope', async () => {
    const moduleConfigService = makeConfigService(true)

    await handle(makePayload(), makeContext({ moduleConfigService, tenantId: null, organizationId: null }))

    expect(moduleConfigService.getValue).not.toHaveBeenCalled()
    expect(createOrGetClaimFromInboundMessageMock).not.toHaveBeenCalled()
  })

  test('falls back to the env opt-in only when the config service is unavailable', async () => {
    await handle(makePayload(), makeContext({ includeModuleConfigService: false }))
    expect(createOrGetClaimFromInboundMessageMock).not.toHaveBeenCalled()

    process.env.OM_WARRANTY_EMAIL_INTAKE = '1'
    await handle(makePayload({ messageId: 'email-2' }), makeContext({ includeModuleConfigService: false }))

    expect(createOrGetClaimFromInboundMessageMock).toHaveBeenCalledTimes(1)
    expect(createOrGetClaimFromInboundMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      intakeMessageRef: 'email-2',
    }))
  })
})
