export {}

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

type UpdateCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<{ priceKindId: string }>
}

const tenantId = '33333333-3333-4333-8333-333333333333'
const organizationId = '22222222-2222-4222-8222-222222222222'
const priceKindId = '11111111-1111-4111-8111-111111111111'

function loadUpdateCommand(): UpdateCommand {
  let command: UpdateCommand | undefined
  jest.isolateModules(() => {
    require('../priceKinds')
    command = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'catalog.priceKinds.update')?.[0]
  })
  if (!command) throw new Error('catalog.priceKinds.update not registered')
  return command
}

function buildContext(record: Record<string, unknown>) {
  const em = {
    findOne: jest.fn().mockResolvedValue(record),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  const forkable = { fork: () => em }
  return {
    em,
    ctx: {
      container: { resolve: (key: string) => (key === 'em' ? forkable : undefined) },
      auth: { sub: 'user-1', tenantId, orgId: organizationId },
      organizationScope: null,
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
    },
  }
}

function buildRecord() {
  return {
    id: priceKindId,
    tenantId,
    organizationId,
    code: 'gross',
    title: 'Gross',
    displayMode: 'including-tax',
    currencyCode: 'EUR',
    isPromotion: false,
    isActive: true,
  }
}

describe('catalog.priceKinds.update', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('keeps the stored displayMode when a rename and isActive toggle omit it', async () => {
    const command = loadUpdateCommand()
    const record = buildRecord()
    const { em, ctx } = buildContext(record)

    await command.execute({ id: priceKindId, title: 'Gross renamed', isActive: false }, ctx)

    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(record.title).toBe('Gross renamed')
    expect(record.isActive).toBe(false)
    expect(record.displayMode).toBe('including-tax')
  })

  it('touches only the sent field on a single-field update', async () => {
    const command = loadUpdateCommand()
    const record = buildRecord()
    const { ctx } = buildContext(record)

    await command.execute({ id: priceKindId, isPromotion: true }, ctx)

    expect(record).toEqual({ ...buildRecord(), isPromotion: true })
  })

  it('applies an explicitly sent displayMode', async () => {
    const command = loadUpdateCommand()
    const record = buildRecord()
    const { ctx } = buildContext(record)

    await command.execute({ id: priceKindId, displayMode: 'excluding-tax' }, ctx)

    expect(record.displayMode).toBe('excluding-tax')
    expect(record.title).toBe('Gross')
  })
})
