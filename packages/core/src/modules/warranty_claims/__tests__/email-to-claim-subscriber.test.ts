import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'

const createOrGetClaimFromInboundMessageMock = jest.fn<Promise<unknown>, [unknown]>()

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
  em?: EntityManager
} = {}) {
  const em = options.em ?? makeEntityManager()
  const includeModuleConfigService = options.includeModuleConfigService ?? true
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    resolve: <T = unknown>(name: string): T => {
      if (name === 'em') return em as T
      if (name === 'moduleConfigService' && includeModuleConfigService && options.moduleConfigService) {
        return options.moduleConfigService as T
      }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }
}

describe('warranty claim email-to-claim subscriber opt-in gate', () => {
  const originalEnv = process.env.OM_WARRANTY_EMAIL_INTAKE

  beforeEach(() => {
    createOrGetClaimFromInboundMessageMock.mockReset()
    createOrGetClaimFromInboundMessageMock.mockResolvedValue({ claimId: 'claim-1', created: true })
    delete process.env.OM_WARRANTY_EMAIL_INTAKE
  })

  afterAll(() => {
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
