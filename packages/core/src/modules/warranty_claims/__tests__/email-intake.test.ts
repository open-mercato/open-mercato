import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { WarrantyClaim } from '../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CLAIM_ID = '33333333-3333-4333-8333-333333333333'

const mockFindOneWithDecryption = jest.fn<Promise<WarrantyClaim | null>, [unknown, unknown, unknown, unknown?, unknown?]>()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: [unknown, unknown, unknown, unknown?, unknown?]) => mockFindOneWithDecryption(...args),
}))

import { createOrGetClaimFromInboundMessage } from '../lib/emailIntake'

type CommandExecuteArgs = {
  input: unknown
  ctx: unknown
}

type CommandExecuteResult = {
  result: { claimId: string }
}

function makeEntityManager(): EntityManager {
  return {} as EntityManager
}

function makeClaim(id = CLAIM_ID): WarrantyClaim {
  return { id, tenantId: TENANT_ID, organizationId: ORG_ID } as WarrantyClaim
}

function makeContainer(
  execute: jest.Mock<Promise<CommandExecuteResult>, [string, CommandExecuteArgs]>,
): AwilixContainer {
  const commandBus = { execute }
  return {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'commandBus') return commandBus as T
      throw new Error(`Unexpected dependency: ${name}`)
    },
  } as unknown as AwilixContainer
}

function baseArgs(
  execute: jest.Mock<Promise<CommandExecuteResult>, [string, CommandExecuteArgs]>,
  overrides: Partial<Parameters<typeof createOrGetClaimFromInboundMessage>[0]> = {},
): Parameters<typeof createOrGetClaimFromInboundMessage>[0] {
  return {
    em: makeEntityManager(),
    container: makeContainer(execute),
    scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
    contactEmail: 'buyer@example.com',
    customerName: 'Buyer Name',
    subject: 'Warranty request',
    body: 'Pump does not power on.',
    intakeMessageRef: 'email-1',
    ...overrides,
  }
}

describe('email warranty claim intake', () => {
  beforeEach(() => {
    mockFindOneWithDecryption.mockReset()
  })

  test('first inbound message creates an unlinked api claim with contact snapshot and intake ref', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)
    const execute = jest.fn<Promise<CommandExecuteResult>, [string, CommandExecuteArgs]>()
      .mockResolvedValue({ result: { claimId: CLAIM_ID } })

    await expect(createOrGetClaimFromInboundMessage(baseArgs(execute))).resolves.toEqual({
      claimId: CLAIM_ID,
      created: true,
    })

    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      WarrantyClaim,
      {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        intakeMessageRef: 'email-1',
        deletedAt: null,
      },
      {},
      { tenantId: TENANT_ID, organizationId: ORG_ID },
    )
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(
      'warranty_claims.claim.create',
      expect.objectContaining({
        input: expect.objectContaining({
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          claimType: 'warranty',
          channel: 'api',
          customerId: null,
          customerName: 'Buyer Name',
          contactEmail: 'buyer@example.com',
          intakeMessageRef: 'email-1',
          notes: 'Subject: Warranty request\n\nPump does not power on.',
        }),
      }),
    )
  })

  test('redelivery with the same intake message ref returns the existing claim without a second create', async () => {
    let storedClaim: WarrantyClaim | null = null
    mockFindOneWithDecryption.mockImplementation(async () => storedClaim)
    const execute = jest.fn<Promise<CommandExecuteResult>, [string, CommandExecuteArgs]>()
      .mockImplementation(async () => {
        storedClaim = makeClaim()
        return { result: { claimId: CLAIM_ID } }
      })

    await expect(createOrGetClaimFromInboundMessage(baseArgs(execute))).resolves.toEqual({
      claimId: CLAIM_ID,
      created: true,
    })
    await expect(createOrGetClaimFromInboundMessage(baseArgs(execute))).resolves.toEqual({
      claimId: CLAIM_ID,
      created: false,
    })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(2)
  })

  test('concurrent duplicate unique violation resolves to the winning claim', async () => {
    mockFindOneWithDecryption
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeClaim())
    const execute = jest.fn<Promise<CommandExecuteResult>, [string, CommandExecuteArgs]>()
      .mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }))

    await expect(createOrGetClaimFromInboundMessage(baseArgs(execute))).resolves.toEqual({
      claimId: CLAIM_ID,
      created: false,
    })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(2)
  })

  test('missing contact email or intake message ref fails before create', async () => {
    const execute = jest.fn<Promise<CommandExecuteResult>, [string, CommandExecuteArgs]>()
      .mockResolvedValue({ result: { claimId: CLAIM_ID } })

    await expect(createOrGetClaimFromInboundMessage(baseArgs(execute, { contactEmail: '  ' })))
      .rejects.toThrow('[internal] contactEmail is required')
    await expect(createOrGetClaimFromInboundMessage(baseArgs(execute, { intakeMessageRef: '  ' })))
      .rejects.toThrow('[internal] intakeMessageRef is required')

    expect(execute).not.toHaveBeenCalled()
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })
})
