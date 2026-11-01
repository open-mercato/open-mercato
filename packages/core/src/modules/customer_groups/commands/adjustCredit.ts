import { randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CustomerCreditAccount } from '../data/entities'
import { customerCreditAdjustCommandSchema, type CustomerCreditAdjustCommandInput } from '../data/validators'
import type { CustomerCreditService, CreditEntryView } from '../services/customerCreditService'

// Step 1.12 (D-R5-2/G7/G20, §6.5/§9.2). The ONLY write path left for a tenant with no
// payments integration to ever lower exposure after a reservation: `settleCredit` is
// called by an integration, `/adjust` is called by an operator — spec §6.5's table names
// both as the sole ways a `settle`-shaped correction reaches the ledger. The route
// resolves the account id against the caller's organization scope and dispatches this
// command; this file never does its own HTTP translation (that is `api/.../adjust/route.ts`'s
// job, same split as every other command in this module).
//
// Undo (G20): "`adjust` is a command whose undo appends the inverse entry, never a
// delete." The forward write and its undo both go through
// `customerCreditService.adjustCredit` — the SAME lock/idempotency-respecting method,
// called a second time with the negated amount, `relatedEntryId` pointing at the entry
// being reversed, and the key `undo:{entryId}` (§6.5).

type AdjustCreditCommandResult = {
  entry: CreditEntryView
  tenantId: string
  organizationId: string
  customerId: string
  currencyCode: string
}

type AdjustCreditUndoPayload = {
  creditAccountId: string
  tenantId: string
  organizationId: string
  customerId: string
  currencyCode: string
  entryId: string
  amount: string
}

function resolveCreditService(ctx: CommandRuntimeContext): CustomerCreditService {
  return ctx.container.resolve('customerCreditService') as CustomerCreditService
}

function resolveCommandEm(ctx: CommandRuntimeContext): EntityManager {
  return ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
}

// Undoing a signed amount flips its sign; the string is already a validated 2-dp decimal
// (never zero), so a plain prefix toggle is exact — no float round-trip.
function negateAmountString(value: string): string {
  return value.startsWith('-') ? value.slice(1) : `-${value}`
}

async function loadAccountInScope(
  em: EntityManager,
  id: string,
  tenantId: string,
  organizationIds: string[] | null,
): Promise<CustomerCreditAccount | null> {
  return em.findOne(CustomerCreditAccount, {
    id,
    tenantId,
    deletedAt: null,
    ...(organizationIds ? { organizationId: { $in: organizationIds } } : {}),
  })
}

function actorUserId(ctx: CommandRuntimeContext): string | null {
  const auth = ctx.auth
  if (!auth || auth.isApiKey) return null
  return typeof auth.sub === 'string' && auth.sub.length ? auth.sub : null
}

const adjustCreditCommand: CommandHandler<CustomerCreditAdjustCommandInput, AdjustCreditCommandResult> = {
  id: 'customer_groups.credit.adjust',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = customerCreditAdjustCommandSchema.parse(rawInput)
    const tenantId = ctx.auth?.tenantId ?? null
    if (!tenantId) {
      throw new CrudHttpError(400, { error: '[internal] tenant context is required for customer_groups.credit.adjust' })
    }

    const em = resolveCommandEm(ctx)
    const account = await loadAccountInScope(em, parsed.creditAccountId, tenantId, ctx.organizationIds)
    if (!account) {
      const { translate } = await resolveTranslations()
      throw notFound(translate('customer_groups.errors.creditAccountNotFound', 'Credit account not found.'))
    }

    const creditService = resolveCreditService(ctx)
    const { entry } = await creditService.adjustCredit({
      scope: { tenantId, organizationId: account.organizationId },
      buyer: { customerId: account.customerId },
      currencyCode: account.currencyCode,
      amount: parsed.amount,
      note: parsed.note,
      // No caller-supplied business key (§9.2): the command mints its own per execution.
      idempotencyKey: `adjust:${randomUUID()}`,
      createdByUserId: actorUserId(ctx),
    })

    return {
      entry,
      tenantId,
      organizationId: account.organizationId,
      customerId: account.customerId,
      currencyCode: account.currencyCode,
    }
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('customer_groups.audit.credit.adjust', 'Post credit adjustment'),
      resourceKind: 'customer_groups.credit_account',
      resourceId: result.entry.creditAccountId,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      snapshotAfter: result.entry,
      payload: {
        undo: {
          creditAccountId: result.entry.creditAccountId,
          tenantId: result.tenantId,
          organizationId: result.organizationId,
          customerId: result.customerId,
          currencyCode: result.currencyCode,
          entryId: result.entry.entryId,
          amount: result.entry.amount,
        } satisfies AdjustCreditUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AdjustCreditUndoPayload>(logEntry)
    if (!payload || !payload.entryId) return

    const { translate } = await resolveTranslations()
    const creditService = resolveCreditService(ctx)
    await creditService.adjustCredit({
      scope: { tenantId: payload.tenantId, organizationId: payload.organizationId },
      buyer: { customerId: payload.customerId },
      currencyCode: payload.currencyCode,
      amount: negateAmountString(payload.amount),
      note: translate(
        'customer_groups.audit.credit.adjustUndoNote',
        'Reversal of adjustment {entryId}',
        { entryId: payload.entryId },
      ),
      // §6.5: the undo entry's key, so a repeated undo of the SAME log entry is a no-op
      // replay rather than a second reversal.
      idempotencyKey: `undo:${payload.entryId}`,
      relatedEntryId: payload.entryId,
      createdByUserId: actorUserId(ctx),
    })
  },
}

registerCommand(adjustCreditCommand)

export { adjustCreditCommand }
