import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CheckoutLink, CheckoutTransaction } from '../data/entities'
import { transactionCreateSchema, transactionUpdateStatusSchema } from '../data/validators'
import { emitCheckoutEvent } from '../events'
import {
  isTerminalCheckoutStatus,
  mapGatewayStatusToCheckoutStatus,
  parseCheckoutInput,
  toMoneyString,
} from '../lib/utils'

function resolveTransactionScope(input: { tenantId?: string | null; organizationId?: string | null }) {
  if (!input.organizationId || !input.tenantId) {
    throw new CrudHttpError(400, { error: 'Transaction scope is required' })
  }
  return {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
  }
}

const createTransactionCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'checkout.transaction.create',
  async execute(rawInput, ctx) {
    const { parsed } = parseCheckoutInput(rawInput, transactionCreateSchema.parse)
    const scope = resolveTransactionScope(parsed)
    const em = ctx.container.resolve('em') as EntityManager
    let lockedLinkId: string | null = null
    let lockedLinkSlug: string | null = null
    let shouldEmitLockedEvent = false
    const transaction = await em.transactional(async (tx) => {
      const currentLink = await tx.findOne(CheckoutLink, {
        id: parsed.linkId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })
      if (!currentLink) {
        throw new CrudHttpError(404, { error: 'Payment link not found' })
      }
      if (currentLink.status !== 'active') {
        throw new CrudHttpError(422, { error: 'This payment link is not currently accepting payments' })
      }
      const reserved = await tx.getConnection().execute<Array<{ id: string }>>(
        `
          UPDATE checkout_links
          SET active_reservation_count = active_reservation_count + 1,
              is_locked = true,
              updated_at = now()
          WHERE id = ?
            AND organization_id = ?
            AND tenant_id = ?
            AND deleted_at IS NULL
            AND status = 'active'
            AND (
              max_completions IS NULL
              OR completion_count + active_reservation_count < max_completions
            )
          RETURNING id
        `,
        [parsed.linkId, scope.organizationId, scope.tenantId],
      )
      if (!reserved[0]?.id) {
        throw new CrudHttpError(422, { error: 'This payment link is no longer available' })
      }
      lockedLinkId = currentLink.id
      lockedLinkSlug = currentLink.slug
      shouldEmitLockedEvent = !currentLink.isLocked
      const transaction = tx.create(CheckoutTransaction, {
        ...parsed,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        amount: toMoneyString(parsed.amount) ?? '0.00',
        status: 'processing',
      })
      tx.persist(transaction)
      await tx.flush()
      return transaction
    })
    if (shouldEmitLockedEvent && lockedLinkId && lockedLinkSlug) {
      await emitCheckoutEvent('checkout.link.locked', {
        id: lockedLinkId,
        slug: lockedLinkSlug,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      }).catch(() => undefined)
    }
    await emitCheckoutEvent('checkout.transaction.created', {
      transactionId: transaction.id,
      linkId: transaction.linkId,
      status: transaction.status,
      amount: Number(transaction.amount),
      currency: transaction.currencyCode,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }).catch(() => undefined)
    await emitCheckoutEvent('checkout.transaction.customerDataCaptured', {
      transactionId: transaction.id,
      linkId: transaction.linkId,
      status: transaction.status,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      customerDataCaptured: true,
    }).catch(() => undefined)
    return { id: transaction.id }
  },
}

const updateTransactionStatusCommand: CommandHandler<Record<string, unknown>, { ok: true }> = {
  id: 'checkout.transaction.updateStatus',
  async execute(rawInput, ctx) {
    const { parsed } = parseCheckoutInput(rawInput, transactionUpdateStatusSchema.parse)
    const scope = resolveTransactionScope(parsed)
    const em = ctx.container.resolve('em') as EntityManager
    let terminalEventPayload: Record<string, unknown> | null = null
    let emitUsageLimitReached = false
    await em.transactional(async (tx) => {
      const transaction = await tx.findOne(CheckoutTransaction, {
        id: parsed.id,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
      if (!transaction) throw new CrudHttpError(404, { error: 'Transaction not found' })
      const link = await tx.findOne(CheckoutLink, {
        id: transaction.linkId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })
      if (!link) throw new CrudHttpError(404, { error: 'Payment link not found' })

      const previousStatus = transaction.status
      const nextStatus = parsed.status
      const previousTerminal = isTerminalCheckoutStatus(previousStatus)
      const nextTerminal = isTerminalCheckoutStatus(nextStatus)

      transaction.status = nextStatus
      transaction.paymentStatus = parsed.paymentStatus ?? transaction.paymentStatus ?? null
      transaction.gatewayTransactionId = parsed.gatewayTransactionId ?? transaction.gatewayTransactionId ?? null
      await tx.flush()

      if (!previousTerminal && nextTerminal) {
        link.activeReservationCount = Math.max(0, link.activeReservationCount - 1)
        if (nextStatus === 'completed') {
          link.completionCount += 1
        }
        await tx.flush()
        if (
          nextStatus === 'completed'
          && link.maxCompletions != null
          && link.completionCount >= link.maxCompletions
        ) {
          emitUsageLimitReached = true
        }
      }
      if (nextTerminal) {
        terminalEventPayload = {
          transactionId: transaction.id,
          linkId: transaction.linkId,
          slug: link.slug,
          status: transaction.status,
          paymentStatus: transaction.paymentStatus ?? null,
          amount: Number(transaction.amount),
          currency: transaction.currencyCode,
          gatewayProvider: link.gatewayProviderKey ?? null,
          gatewayTransactionId: transaction.gatewayTransactionId ?? null,
          occurredAt: new Date().toISOString(),
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        }
      }
    })
    if (parsed.status === 'completed') {
      await emitCheckoutEvent('checkout.transaction.completed', terminalEventPayload ?? {}).catch(() => undefined)
    } else if (parsed.status === 'failed') {
      await emitCheckoutEvent('checkout.transaction.failed', terminalEventPayload ?? {}).catch(() => undefined)
    } else if (parsed.status === 'cancelled') {
      await emitCheckoutEvent('checkout.transaction.cancelled', terminalEventPayload ?? {}).catch(() => undefined)
    } else if (parsed.status === 'expired') {
      await emitCheckoutEvent('checkout.transaction.expired', terminalEventPayload ?? {}).catch(() => undefined)
    }
    if (emitUsageLimitReached && terminalEventPayload) {
      await emitCheckoutEvent('checkout.link.usageLimitReached', {
        id: terminalEventPayload.linkId as string,
        slug: terminalEventPayload.slug as string,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      }).catch(() => undefined)
    }
    return { ok: true }
  },
}

registerCommand(createTransactionCommand)
registerCommand(updateTransactionStatusCommand)

export function mapGatewayStatusForCommand(status: string | null | undefined) {
  return mapGatewayStatusToCheckoutStatus(status)
}
