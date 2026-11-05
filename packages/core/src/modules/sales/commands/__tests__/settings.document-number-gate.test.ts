/** @jest-environment node */

import { asValue, createContainer, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string, fallback?: string) => fallback ?? key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

type SaveInput = {
  tenantId: string
  organizationId: string
  orderNumberFormat: string
  quoteNumberFormat: string
  orderNextNumber?: number
  quoteNextNumber?: number
}

type SaveResult = { nextOrderNumber: number; nextQuoteNumber: number }

const tenantId = '00000000-0000-4000-8000-000000000000'
const organizationId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'

function buildHarness(options: { canEditNumbers: boolean; withUser?: boolean }) {
  const settingsRecord = {
    id: '33333333-3333-4333-8333-333333333333',
    orderNumberFormat: 'ORDER-{seq:5}',
    quoteNumberFormat: 'QUOTE-{seq:5}',
    orderCustomerEditableStatuses: null,
    orderAddressEditableStatuses: null,
    updatedAt: new Date(0),
  }
  const forkedEm = {
    findOne: jest.fn().mockResolvedValue(settingsRecord),
    create: jest.fn(),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  const em = { fork: () => forkedEm }
  const sequences = { order: 11560, quote: 42, return: 1 }
  const generator = {
    peekSequences: jest.fn(async () => ({ ...sequences })),
    setNextSequence: jest.fn(async (kind: 'order' | 'quote', _scope: unknown, next: number) => {
      sequences[kind] = next
    }),
  }
  const rbacService = {
    userHasAllFeatures: jest.fn().mockResolvedValue(options.canEditNumbers),
  }
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(em),
    salesDocumentNumberGenerator: asValue(generator),
    rbacService: asValue(rbacService),
  })
  const ctx: CommandRuntimeContext = {
    container,
    auth:
      options.withUser === false
        ? null
        : ({ sub: userId, tenantId, orgId: organizationId } as CommandRuntimeContext['auth']),
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  }
  return { ctx, forkedEm, generator, rbacService }
}

function buildInput(overrides: Partial<SaveInput> = {}): SaveInput {
  return {
    tenantId,
    organizationId,
    orderNumberFormat: 'ORDER-{seq:5}',
    quoteNumberFormat: 'QUOTE-{seq:5}',
    ...overrides,
  }
}

async function execute(ctx: CommandRuntimeContext, input: SaveInput): Promise<SaveResult> {
  const handler = commandRegistry.get<SaveInput, SaveResult>('sales.settings.save')
  if (!handler) throw new Error('sales.settings.save is not registered')
  return handler.execute(input, ctx)
}

describe('sales.settings.save document-number counter gate (#6367)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../settings')
  })

  it('refuses to rewind the order counter without sales.documents.number.edit and writes nothing', async () => {
    const { ctx, forkedEm, generator, rbacService } = buildHarness({ canEditNumbers: false })

    let caught: unknown
    try {
      await execute(ctx, buildInput({ orderNextNumber: 7, quoteNextNumber: 42 }))
    } catch (error) {
      caught = error
    }

    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as { status?: number }).status).toBe(403)
    expect(rbacService.userHasAllFeatures).toHaveBeenCalledWith(userId, ['sales.documents.number.edit'], {
      tenantId,
      organizationId,
    })
    expect(generator.setNextSequence).not.toHaveBeenCalled()
    expect(forkedEm.flush).not.toHaveBeenCalled()
  })

  it('refuses to move the quote counter forward without sales.documents.number.edit', async () => {
    const { ctx, generator } = buildHarness({ canEditNumbers: false })

    await expect(execute(ctx, buildInput({ orderNextNumber: 11560, quoteNextNumber: 500 }))).rejects.toMatchObject({
      status: 403,
    })
    expect(generator.setNextSequence).not.toHaveBeenCalled()
  })

  it('lets a settings manager save formats when the echoed counters are unchanged', async () => {
    const { ctx, forkedEm, generator, rbacService } = buildHarness({ canEditNumbers: false })

    const result = await execute(
      ctx,
      buildInput({ orderNumberFormat: 'SO-{seq:6}', orderNextNumber: 11560, quoteNextNumber: 42 }),
    )

    expect(rbacService.userHasAllFeatures).not.toHaveBeenCalled()
    expect(generator.setNextSequence).not.toHaveBeenCalled()
    expect(forkedEm.flush).toHaveBeenCalled()
    expect(result.nextOrderNumber).toBe(11560)
    expect(result.nextQuoteNumber).toBe(42)
  })

  it('repositions the counter for a caller holding sales.documents.number.edit', async () => {
    const { ctx, generator } = buildHarness({ canEditNumbers: true })

    const result = await execute(ctx, buildInput({ orderNextNumber: 20000, quoteNextNumber: 42 }))

    expect(generator.setNextSequence).toHaveBeenCalledTimes(1)
    expect(generator.setNextSequence).toHaveBeenCalledWith('order', expect.objectContaining({ organizationId }), 20000)
    expect(result.nextOrderNumber).toBe(20000)
  })

  it('keeps system callers without a user principal able to reposition the counter', async () => {
    const { ctx, generator, rbacService } = buildHarness({ canEditNumbers: false, withUser: false })

    await execute(ctx, buildInput({ quoteNextNumber: 100 }))

    expect(rbacService.userHasAllFeatures).not.toHaveBeenCalled()
    expect(generator.setNextSequence).toHaveBeenCalledWith('quote', expect.objectContaining({ organizationId }), 100)
  })
})
