import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  createSalesDocumentWorkflowPolicy,
  enforceSalesDocumentWorkflowPolicy,
  withSalesDocumentWorkflowTransaction,
} from '../documentWorkflowPolicy'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key }),
}))

const scope = { tenantId: 'tenant-one', organizationId: 'organization-one', status: 'confirmed' }
const previousFlag = process.env.OM_SALES_DOCUMENT_WORKFLOW_GUARDS

function context(service: unknown = createSalesDocumentWorkflowPolicy()) {
  const resolve = jest.fn().mockReturnValue(service)
  return { resolve, ctx: { container: { resolve } } as unknown as CommandRuntimeContext }
}

beforeEach(() => { process.env.OM_SALES_DOCUMENT_WORKFLOW_GUARDS = 'on' })
afterEach(() => {
  if (previousFlag === undefined) delete process.env.OM_SALES_DOCUMENT_WORKFLOW_GUARDS
  else process.env.OM_SALES_DOCUMENT_WORKFLOW_GUARDS = previousFlag
})

describe('sales document workflow policy', () => {
  it.each([undefined, 'off', 'false'])('retains legacy behavior without policy resolution when %s', async (flag) => {
    if (flag === undefined) delete process.env.OM_SALES_DOCUMENT_WORKFLOW_GUARDS
    else process.env.OM_SALES_DOCUMENT_WORKFLOW_GUARDS = flag
    const { ctx, resolve } = context(undefined)
    await expect(enforceSalesDocumentWorkflowPolicy(ctx, { ...scope, status: 'draft' }, 'invoice')).resolves.toBeNull()
    expect(resolve).not.toHaveBeenCalled()
  })

  it.each(['return', 'shipment', 'invoice'] as const)('refuses %s on a draft before mutation', async (action) => {
    const { ctx } = context()
    await expect(enforceSalesDocumentWorkflowPolicy(ctx, { ...scope, status: 'draft' }, action)).rejects.toMatchObject({
      status: 409,
      body: { code: 'sales_document_workflow_restricted', action, error: 'sales.workflow.actionNotAllowed' },
    })
  })

  it.each(['return', 'shipment', 'invoice'] as const)('allows %s after confirmation', async (action) => {
    const { ctx } = context()
    await expect(enforceSalesDocumentWorkflowPolicy(ctx, scope, action)).resolves.toMatchObject({
      returnableShipmentStatuses: ['shipped', 'in_transit', 'delivered'],
    })
  })

  it.each(['cancelled', 'canceled', null, 'tenant-custom'])('refuses an unmapped order state %s', async (status) => {
    const { ctx } = context()
    await expect(enforceSalesDocumentWorkflowPolicy(ctx, { ...scope, status }, 'return')).rejects.toMatchObject({ status: 409 })
  })

  it('resolves custom rules with the exact order scope and normalizes codes', async () => {
    const getPolicy = jest.fn().mockResolvedValue({
      allowedOrderStatuses: { return: [], shipment: ['ready_to_dispatch'], invoice: [] },
      returnableShipmentStatuses: ['received_by_customer'],
    })
    const { ctx } = context({ getPolicy })
    const order = { ...scope, status: ' Ready-to-Dispatch ' }
    await expect(enforceSalesDocumentWorkflowPolicy(ctx, order, 'shipment')).resolves.toBeTruthy()
    expect(getPolicy).toHaveBeenCalledWith(order)
    await expect(enforceSalesDocumentWorkflowPolicy(ctx, order, 'invoice')).rejects.toMatchObject({ status: 409 })
  })

  it.each([{}, { getPolicy: () => ({ allowedOrderStatuses: {} }) }])('fails closed for unavailable or invalid policy %p', async (service) => {
    const { ctx } = context(service)
    await expect(enforceSalesDocumentWorkflowPolicy(ctx, scope, 'invoice')).rejects.toThrow('[internal]')
  })

  it('uses one write transaction when enabled and the existing manager when disabled', async () => {
    const transaction = {} as EntityManager
    const transactional = jest.fn(async (operation: (manager: EntityManager) => Promise<string>) => operation(transaction))
    const manager = { transactional } as unknown as EntityManager
    const operation = jest.fn(async () => 'created')
    await expect(withSalesDocumentWorkflowTransaction(manager, operation)).resolves.toBe('created')
    expect(operation).toHaveBeenLastCalledWith(transaction)
    process.env.OM_SALES_DOCUMENT_WORKFLOW_GUARDS = 'off'
    await expect(withSalesDocumentWorkflowTransaction(manager, operation)).resolves.toBe('created')
    expect(operation).toHaveBeenLastCalledWith(manager)
    expect(transactional).toHaveBeenCalledTimes(1)
  })
})
