/** @jest-environment node */

/**
 * `sales.orders.update` is the one workflow-safe command that is ON for a
 * tenant which never opened the settings page (the `defaultEnabled` grandfather
 * clause), so it is the command whose `outputSchema` an `UPDATE_ENTITY`
 * activity surfaces to a workflow author out of the box.
 * These tests pin the declared shapes and then prove the payoff end to end:
 * that the shipped `sales.order-approval` definition's ledger advertises the
 * real typed order keys at the steps downstream of each update activity.
 */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { computeContextLedger, type LedgerWorkflowDefinition } from '@open-mercato/core/modules/workflows/lib/context-ledger'
import { resolveServerOutputContract } from '@open-mercato/core/modules/workflows/lib/server-output-contract'
import { listWorkflowSafeCommands } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'
import '../documents'
import workflowsConfig from '../../workflows'

const validOrder = {
  id: '3f7a1c52-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
  organizationId: 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e',
  tenantId: 'c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e6f',
  orderNumber: 'ORD-1001',
  channelId: null,
  customerEntityId: null,
  currencyCode: 'EUR',
  status: 'pending_approval',
  statusEntryId: null,
  fulfillmentStatus: null,
  paymentStatus: null,
  subtotalNetAmount: '100.0000',
  subtotalGrossAmount: '123.0000',
  discountTotalAmount: '0.0000',
  taxTotalAmount: '23.0000',
  grandTotalNetAmount: '100.0000',
  grandTotalGrossAmount: '123.0000',
  paidTotalAmount: '0.0000',
  outstandingAmount: '123.0000',
  lineItemCount: 2,
  placedAt: null,
  dueAt: null,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-02T00:00:00.000Z'),
}

describe('sales order command outputSchema', () => {
  it('declares an outputSchema on sales.orders.update describing the returned order entity', () => {
    const outputSchema = commandRegistry.outputSchemaOf('sales.orders.update')

    expect(outputSchema).not.toBeNull()
    expect(outputSchema!.safeParse({ order: validOrder }).success).toBe(true)
  })

  it('rejects order payloads the command could not have produced', () => {
    const outputSchema = commandRegistry.outputSchemaOf('sales.orders.update')

    expect(outputSchema).not.toBeNull()
    expect(outputSchema!.safeParse({ orderId: validOrder.id }).success).toBe(false)
    expect(outputSchema!.safeParse({ order: { ...validOrder, id: 'not-a-uuid' } }).success).toBe(false)
    expect(outputSchema!.safeParse({ order: { ...validOrder, lineItemCount: '2' } }).success).toBe(false)
    expect(outputSchema!.safeParse({}).success).toBe(false)
    expect(outputSchema!.safeParse('junk').success).toBe(false)
    expect(outputSchema!.safeParse(null).success).toBe(false)
  })

  it('tolerates the nullable order columns being absent or null', () => {
    const outputSchema = commandRegistry.outputSchemaOf('sales.orders.update')
    const { channelId, customerEntityId, status, statusEntryId, ...rest } = validOrder

    expect(outputSchema).not.toBeNull()
    expect(outputSchema!.safeParse({ order: rest }).success).toBe(true)
    expect(
      outputSchema!.safeParse({ order: { ...validOrder, status: null, channelId: null } }).success,
    ).toBe(true)
  })

  it('declares the id-only outputSchema on sales.orders.create and sales.orders.delete', () => {
    for (const commandId of ['sales.orders.create', 'sales.orders.delete']) {
      const outputSchema = commandRegistry.outputSchemaOf(commandId)

      expect(outputSchema).not.toBeNull()
      expect(outputSchema!.safeParse({ orderId: validOrder.id }).success).toBe(true)
      expect(outputSchema!.safeParse({ orderId: 'not-a-uuid' }).success).toBe(false)
      expect(outputSchema!.safeParse({}).success).toBe(false)
    }
  })
})

describe('sales.orders.update reaches a workflow author through the context ledger', () => {
  const orderApproval = workflowsConfig.workflows[0]

  it('is the workflow-safe command the shipped order-approval definition executes', () => {
    expect(listWorkflowSafeCommands().map((command) => command.commandId)).toContain(
      'sales.orders.update',
    )
  })

  it('advertises the typed order keys downstream of the shipped definition update activities', () => {
    const ledger = computeContextLedger(orderApproval.definition as LedgerWorkflowDefinition, {
      resolveOutputContract: resolveServerOutputContract,
    })

    const approvedEntries = ledger.steps.approved.entries
    const pathsAtApproved = approvedEntries.map((entry) => entry.path)

    expect(pathsAtApproved).toContain('Set Order to Pending Approval.result.order.id')
    expect(pathsAtApproved).toContain('Set Order to Pending Approval.result.order.status')
    expect(pathsAtApproved).toContain('Set Order to Pending Approval.result.order.grandTotalGrossAmount')

    expect(
      approvedEntries.find(
        (entry) => entry.path === 'Set Order to Pending Approval.result.order.grandTotalGrossAmount',
      ),
    ).toMatchObject({ type: 'text' })
    expect(
      approvedEntries.find(
        (entry) => entry.path === 'Set Order to Pending Approval.result.order.lineItemCount',
      ),
    ).toMatchObject({ type: 'number' })
    expect(
      approvedEntries.find(
        (entry) => entry.path === 'Set Order to Pending Approval.result.order.placedAt',
      ),
    ).toMatchObject({ type: 'date' })

    expect(pathsAtApproved).toContain('Set Order to Pending Approval.commandId')
    expect(pathsAtApproved).toContain('Set Order to Pending Approval.executed')
  })

  it('carries the second update activity keys into the end step', () => {
    const ledger = computeContextLedger(orderApproval.definition as LedgerWorkflowDefinition, {
      resolveOutputContract: resolveServerOutputContract,
    })

    const pathsAtEnd = ledger.steps.end.entries.map((entry) => entry.path)

    expect(pathsAtEnd).toContain('Set Order to Approved.result.order.status')
    expect(pathsAtEnd).toContain('Set Order to Rejected.result.order.status')
  })
})
