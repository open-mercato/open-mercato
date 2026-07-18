import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  StockUomMismatchError,
  InsufficientStockError,
  DoubleReversalError,
  type ProductionStockProvider,
  type StockLine,
  type StockMovementRef,
} from '../lib/stockProvider.js'
import type { StockLedgerService } from '../services/stockLedgerService.js'
import type { StockAdjustInput, StockReceiveInput, StockReverseMovementInput } from '../data/validators.js'

/**
 * Stock intake commands (Phase 2.2 — manual receipt, opening
 * balance/correction, storno).
 *
 * Undo model (spec decision h): the stock ledger is append-only. There is no
 * classic undo — a correction is an explicit compensating movement, which is
 * exactly what `production.stock.reverseMovement` (storno) is. Per
 * `CommandHandler.isUndoable` (`@open-mercato/shared/lib/commands/types.ts`:
 * `handler.isUndoable !== false && typeof handler.undo === 'function'`), all
 * three commands below omit `undo` AND set `isUndoable: false` — this keeps
 * them out of the generic undo/redo route while `commandBus.execute(...)`
 * still runs them normally, so they get the full command-bus audit trail
 * (action log, `buildLog` metadata) without a misleading "Undo" affordance
 * that would silently no-op.
 *
 * Side effects: unlike the technology commands in `commands/technology.ts`,
 * these commands do NOT call `emitCrudSideEffects` themselves. Each
 * `ProductionStockProvider` method (`receive`/`adjust`/`reverseMovement`) is
 * itself already responsible for emitting `production.stock_movement.created`
 * and reindexing the `StockMovement` row after its own atomic phase commits
 * (see the "Side-effect flush contract" doc on `StockLedgerService`). These
 * command handlers are therefore thin, validated wrappers around the DI
 * `productionStockProvider` seam — resolved via the container, never
 * imported directly, so a future warehouse module can swap the
 * implementation without touching this file.
 */

function requireScopeIds(ctx: CommandRuntimeContext): { tenantId: string; organizationId: string } {
  const tenantId = ctx.auth?.tenantId
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, { error: '[internal] Missing tenant/organization scope' })
  }
  return { tenantId, organizationId }
}

function resolveStockProvider(ctx: CommandRuntimeContext): ProductionStockProvider {
  return ctx.container.resolve<ProductionStockProvider>('productionStockProvider')
}

/**
 * `reverseMovement` is intentionally NOT part of the `ProductionStockProvider`
 * interface (spec decision i) — it is a `StockLedgerService`-specific
 * correction API. Resolve the same DI token but narrow to the concrete
 * shape needed here (type-only reference to the sibling service class, no
 * runtime import of another module).
 */
function resolveStockLedger(ctx: CommandRuntimeContext): Pick<StockLedgerService, 'reverseMovement'> {
  return ctx.container.resolve<Pick<StockLedgerService, 'reverseMovement'>>('productionStockProvider')
}

/**
 * Translates the stock provider's domain errors into the matching HTTP
 * status AND a user-facing, translated message — never the raw `[internal]`
 * `Error#message` (review finding: that string embeds diagnostic detail,
 * e.g. a movement UUID, and `CrudForm` renders a `CrudHttpError` body's
 * `error` field verbatim). Structured identifiers (uom values, movement id)
 * are threaded through as translation params instead of string-concatenated
 * into the message.
 */
async function mapStockProviderError(err: unknown): Promise<unknown> {
  const { translate } = await resolveTranslations()
  if (err instanceof StockUomMismatchError) {
    return new CrudHttpError(422, {
      error: translate(
        'production.errors.stock_uom_mismatch',
        'Unit of measure mismatch: expected {expected}, got {actual}.',
        { expected: err.expected, actual: err.actual },
      ),
    })
  }
  if (err instanceof InsufficientStockError) {
    return new CrudHttpError(422, {
      error: translate('production.errors.insufficient_stock', 'Insufficient stock for this operation.'),
    })
  }
  if (err instanceof DoubleReversalError) {
    return new CrudHttpError(409, {
      error: translate('production.errors.double_reversal', 'This stock movement has already been reversed.'),
    })
  }
  return err
}

// ---------------------------------------------------------------------------
// production.stock.receive — manual receipt (PW: goods-received-note style)
// ---------------------------------------------------------------------------

const receiveStockCommand: CommandHandler<StockReceiveInput, { movementIds: string[] }> = {
  id: 'production.stock.receive',
  isUndoable: false,

  async execute(input, ctx) {
    const { tenantId, organizationId } = requireScopeIds(ctx)
    const provider = resolveStockProvider(ctx)

    const line: StockLine = {
      productId: input.productId,
      variantId: input.variantId ?? null,
      batchNumber: input.batchNumber ?? null,
      expiresAt: input.expiresAt ?? null,
      qty: input.qty,
      uom: input.uom,
    }
    const ref: StockMovementRef = {
      scope: { tenantId, organizationId },
      sourceType: input.sourceType ?? 'manual',
      reasonEntryId: input.reasonEntryId ?? null,
    }

    try {
      return await provider.receive([line], ref)
    } catch (err) {
      throw await mapStockProviderError(err)
    }
  },

  async buildLog({ input, result, ctx }) {
    const { translate } = await resolveTranslations()
    const { tenantId, organizationId } = requireScopeIds(ctx)
    return {
      actionLabel: translate('production.audit.stock.receive', 'Receive stock'),
      resourceKind: 'production.stock_movement',
      resourceId: result.movementIds[0] ?? null,
      tenantId,
      organizationId,
      payload: { input, movementIds: result.movementIds },
    }
  },
}

// ---------------------------------------------------------------------------
// production.stock.adjust — opening balance load / correction (signed qty)
// ---------------------------------------------------------------------------

const adjustStockCommand: CommandHandler<StockAdjustInput, { movementId: string }> = {
  id: 'production.stock.adjust',
  isUndoable: false,

  async execute(input, ctx) {
    const { tenantId, organizationId } = requireScopeIds(ctx)
    const provider = resolveStockProvider(ctx)

    const line: StockLine = {
      productId: input.productId,
      variantId: input.variantId ?? null,
      batchNumber: input.batchNumber ?? null,
      qty: input.qty,
      uom: input.uom,
    }
    const ref: StockMovementRef = {
      scope: { tenantId, organizationId },
      sourceType: 'manual',
      reasonEntryId: null,
    }

    try {
      // `input.reason` is a required free-text note (dictionaries not built
      // yet — see the TODO on `stockAdjustSchema`). It is NOT passed as
      // `reasonEntryId` (a uuid FK column) and is instead recorded only in
      // this command's `buildLog` context below, so it still lands in the
      // audit trail without corrupting the dictionary-entry column.
      return await provider.adjust(line, null, ref)
    } catch (err) {
      throw await mapStockProviderError(err)
    }
  },

  async buildLog({ input, result, ctx }) {
    const { translate } = await resolveTranslations()
    const { tenantId, organizationId } = requireScopeIds(ctx)
    return {
      actionLabel: translate('production.audit.stock.adjust', 'Adjust stock'),
      resourceKind: 'production.stock_movement',
      resourceId: result.movementId,
      tenantId,
      organizationId,
      payload: { input, movementId: result.movementId },
      context: { reason: input.reason },
    }
  },
}

// ---------------------------------------------------------------------------
// production.stock.reverseMovement — storno (compensating movement)
// ---------------------------------------------------------------------------

const reverseStockMovementCommand: CommandHandler<StockReverseMovementInput, { movementId: string }> = {
  id: 'production.stock.reverseMovement',
  isUndoable: false,

  async execute(input, ctx) {
    const { tenantId, organizationId } = requireScopeIds(ctx)
    const ledger = resolveStockLedger(ctx)

    try {
      return await ledger.reverseMovement(input.movementId, { tenantId, organizationId })
    } catch (err) {
      throw await mapStockProviderError(err)
    }
  },

  async buildLog({ input, result, ctx }) {
    const { translate } = await resolveTranslations()
    const { tenantId, organizationId } = requireScopeIds(ctx)
    return {
      actionLabel: translate('production.audit.stock.reverse_movement', 'Reverse stock movement'),
      resourceKind: 'production.stock_movement',
      resourceId: result.movementId,
      tenantId,
      organizationId,
      relatedResourceKind: 'production.stock_movement',
      relatedResourceId: input.movementId,
      payload: { input, movementId: result.movementId },
    }
  },
}

registerCommand(receiveStockCommand)
registerCommand(adjustStockCommand)
registerCommand(reverseStockMovementCommand)
