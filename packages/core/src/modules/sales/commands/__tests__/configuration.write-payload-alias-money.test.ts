import { asValue, createContainer } from 'awilix'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { shippingMethodUpdateSchema } from '../../data/validators'
import { withExactShippingMethodInput } from '../../lib/exactAmountFields'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

const tenantId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const organizationId = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const precise = '1234567890123456.1234'
const translate = (key: string, fallback?: string) => fallback ?? key

function harness() {
  const record = { id, tenantId, organizationId, name: 'Courier', code: 'courier', baseRateNet: '10', baseRateGross: '12.3', metadata: null }
  const flush = jest.fn(async () => undefined)
  const em = { fork: () => em, findOne: jest.fn(async () => record), flush }
  const container = createContainer()
  container.register({ em: asValue(em) })
  const ctx: CommandRuntimeContext = {
    container,
    auth: { tenantId, orgId: organizationId, sub: 'alias-test' },
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  }
  const handler = commandRegistry.get<unknown, unknown>('sales.shipping-methods.update')!
  const execute = async (raw: Record<string, unknown>) => {
    const parsed = parseScopedCommandInput(shippingMethodUpdateSchema, raw, ctx, translate)
    const mapped = withExactShippingMethodInput(parsed, raw)
    await handler.execute(mapped, ctx)
    return mapped
  }
  return { record, em, execute }
}

describe('shipping write payload aliases through the actual update command', () => {
  beforeAll(async () => {
    await import('../configuration')
  })

  it.each(['baseRateNet', 'base_rate_net'])('stores every digit of %s at the flush boundary', async (field) => {
    const { record, em, execute } = harness()
    const mapped = await execute({ id, [field]: precise })
    expect(typeof mapped.baseRateNet).toBe('number')
    expect(mapped).toHaveProperty('baseRateNetExact', precise)
    expect(record.baseRateNet).toBe(precise)
    expect(record.baseRateGross).toBe('12.3')
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(em.findOne).toHaveBeenCalledWith(expect.anything(), { id, deletedAt: null })
  })

  it('rejects the null alias before loading or flushing a record', async () => {
    const { record, em, execute } = harness()
    await expect(execute({ id, base_rate_net: null })).rejects.toMatchObject({ status: 400, body: { fields: ['base_rate_net'] } })
    expect(record.baseRateNet).toBe('10')
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('preserves the previously accepted canonical null coercion', async () => {
    const { record, em, execute } = harness()
    await execute({ id, baseRateNet: null })
    expect(record.baseRateNet).toBe('0')
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('rejects conflicting spellings before loading or flushing a record', async () => {
    const { em, execute } = harness()
    await expect(execute({ id, baseRateNet: precise, base_rate_net: '12' })).rejects.toMatchObject({ status: 400 })
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })
})
