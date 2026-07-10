import type { EntityManager } from '@mikro-orm/postgresql'
import { WarrantyClaim, WarrantyClaimLine, WarrantyVendorPolicy } from '../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CLAIM_ID = '33333333-3333-4333-8333-333333333333'
const LINE_ID = '44444444-4444-4444-8444-444444444444'
const POLICY_ID = '55555555-5555-4555-8555-555555555555'

const mockFindOneWithDecryption = jest.fn<Promise<unknown>, [unknown, unknown, unknown, unknown?, unknown?]>()
const mockFindWithDecryption = jest.fn<Promise<unknown[]>, [unknown, unknown, unknown, unknown?, unknown?]>()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: [unknown, unknown, unknown, unknown?, unknown?]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: [unknown, unknown, unknown, unknown?, unknown?]) => mockFindWithDecryption(...args),
}))

import handleAutoVendorRecovery from '../subscribers/auto-vendor-recovery'

type CommandExecuteResult = {
  result: { claimId: string }
  logEntry: null
}

type TestContext = {
  resolve: <T = unknown>(name: string) => T
  tenantId: string
  organizationId: string
}

function entityName(entity: unknown): string {
  return typeof entity === 'function' && 'name' in entity ? String(entity.name) : ''
}

function makeEntityManager(): EntityManager {
  const holder: { fork: jest.Mock } = {
    fork: jest.fn(),
  }
  holder.fork.mockReturnValue(holder)
  return holder as unknown as EntityManager
}

function makeClaim(reasonCode = 'defective'): WarrantyClaim {
  return {
    id: CLAIM_ID,
    claimType: 'warranty',
    status: 'resolved',
    reasonCode,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
  } as unknown as WarrantyClaim
}

function makeLine(overrides: Partial<WarrantyClaimLine> = {}): WarrantyClaimLine {
  return {
    id: LINE_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    lineStatus: 'resolved',
    vendorName: 'Acme Supply',
    vendorClaimLineId: null,
    faultCode: 'defective',
    creditAmount: '100.00',
    restockingFee: '0',
    coreCreditAmount: '0',
    ...overrides,
  } as unknown as WarrantyClaimLine
}

function makePolicy(overrides: Partial<WarrantyVendorPolicy> = {}): WarrantyVendorPolicy {
  return {
    id: POLICY_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    vendorName: 'Acme Supply',
    vendorRef: 'SUP-ACME',
    claimableReasonCodes: ['defective'],
    recoveryRatePct: '50.00',
    autoGenerateRecovery: true,
    isActive: true,
    ...overrides,
  } as unknown as WarrantyVendorPolicy
}

function makeContext(commandExecute: jest.Mock<Promise<CommandExecuteResult>, [string, unknown]>): TestContext {
  const em = makeEntityManager()
  const commandBus = { execute: commandExecute }
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    resolve: <T = unknown>(name: string): T => {
      if (name === 'em') return em as T
      if (name === 'commandBus') return commandBus as T
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }
}

function mockDecryptedReads(claim: WarrantyClaim, lines: WarrantyClaimLine[], policies: WarrantyVendorPolicy[]): void {
  mockFindOneWithDecryption.mockResolvedValue(claim)
  mockFindWithDecryption.mockImplementation(async (_em, entity) => {
    const name = entityName(entity)
    if (name === 'WarrantyClaimLine') return lines
    if (name === 'WarrantyVendorPolicy') return policies
    return []
  })
}

function statusChangedPayload() {
  return {
    claimId: CLAIM_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    toStatus: 'resolved',
    claimType: 'warranty',
  }
}

describe('warranty vendor policy recovery', () => {
  beforeEach(() => {
    mockFindOneWithDecryption.mockReset()
    mockFindWithDecryption.mockReset()
  })

  test('auto-generates one vendor recovery request for a resolved matching line', async () => {
    const commandExecute = jest.fn<Promise<CommandExecuteResult>, [string, unknown]>()
      .mockResolvedValue({ result: { claimId: '66666666-6666-4666-8666-666666666666' }, logEntry: null })
    mockDecryptedReads(makeClaim(), [makeLine()], [makePolicy()])

    await handleAutoVendorRecovery(statusChangedPayload(), makeContext(commandExecute))

    expect(commandExecute).toHaveBeenCalledTimes(1)
    expect(commandExecute).toHaveBeenCalledWith(
      'warranty_claims.claim.create_vendor_recovery',
      expect.objectContaining({
        input: {
          claimId: CLAIM_ID,
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          lineIds: [LINE_ID],
          vendorName: 'Acme Supply',
          vendorRef: 'SUP-ACME',
        },
      }),
    )
  })

  test('does not generate a second request when the line already has a vendor recovery link', async () => {
    const commandExecute = jest.fn<Promise<CommandExecuteResult>, [string, unknown]>()
      .mockResolvedValue({ result: { claimId: '66666666-6666-4666-8666-666666666666' }, logEntry: null })
    mockDecryptedReads(makeClaim(), [makeLine()], [makePolicy()])

    await handleAutoVendorRecovery(statusChangedPayload(), makeContext(commandExecute))

    mockDecryptedReads(makeClaim(), [makeLine({ vendorClaimLineId: '77777777-7777-4777-8777-777777777777' })], [makePolicy()])
    await handleAutoVendorRecovery(statusChangedPayload(), makeContext(commandExecute))

    expect(commandExecute).toHaveBeenCalledTimes(1)
  })

  test('skips nonmatching reasons and inactive policies', async () => {
    const commandExecute = jest.fn<Promise<CommandExecuteResult>, [string, unknown]>()
      .mockResolvedValue({ result: { claimId: '66666666-6666-4666-8666-666666666666' }, logEntry: null })
    const context = makeContext(commandExecute)

    mockDecryptedReads(makeClaim('customer_changed_mind'), [makeLine()], [makePolicy()])
    await handleAutoVendorRecovery(statusChangedPayload(), context)

    mockDecryptedReads(makeClaim(), [makeLine()], [makePolicy({ isActive: false })])
    await handleAutoVendorRecovery(statusChangedPayload(), context)

    expect(commandExecute).not.toHaveBeenCalled()
  })
})
