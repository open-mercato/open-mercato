import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext, CommandBus } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { MrpRun, MrpSuggestion } from '../data/entities.js'
import type { MrpRunCreateInput, MrpSuggestionsBulkActionInput } from '../data/validators.js'
import { emitProductionEvent } from '../events.js'
import { getMrpRunQueue } from '../lib/mrp/queue.js'
import { isProductionEnabledForTenant } from '../lib/productionToggle.js'
import { E } from '../../../../generated/entities.ids.generated.js'

/**
 * MRP run/suggestion commands (task 5.2, spec § MRP engine + Data Models).
 *
 * `production.mrp.createRun` and `production.mrp.cronFanOut` never execute
 * the engine synchronously — they only create the `MrpRun` row(s) and
 * enqueue one queue job per row onto `production-mrp` (spec decision c). The
 * actual computation happens in `workers/mrp-run.worker.ts` ->
 * `lib/mrp/runJob.ts`.
 */

function requireScopeIds(ctx: CommandRuntimeContext): { tenantId: string; organizationId: string } {
  const tenantId = ctx.auth?.tenantId
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, { error: '[internal] Missing tenant/organization scope' })
  }
  return { tenantId, organizationId }
}

function resolveDataEngine(ctx: CommandRuntimeContext): DataEngine {
  return ctx.container.resolve<DataEngine>('dataEngine')
}

const mrpSuggestionCrudIndexer: CrudIndexerConfig<MrpSuggestion> = { entityType: E.production.mrp_suggestion }
const mrpSuggestionCrudEvents: CrudEventsConfig<MrpSuggestion> = {
  module: 'production',
  entity: 'mrp_suggestion',
  persistent: true,
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// production.mrp.createRun — one MrpRun + one queue job (spec decision c)
// ---------------------------------------------------------------------------

const createRunCommand: CommandHandler<MrpRunCreateInput, { id: string }> = {
  id: 'production.mrp.createRun',
  isUndoable: false,

  async execute(input, ctx) {
    const { tenantId, organizationId } = requireScopeIds(ctx)
    const em = ctx.container.resolve<EntityManager>('em').fork()

    const asOfDate = input.asOfDate ?? toIsoDate(new Date())
    const run = em.create(MrpRun, {
      tenantId,
      organizationId,
      status: 'pending',
      params: { asOfDate },
      progressJobId: null,
      startedAt: null,
      finishedAt: null,
      stats: null,
    } as never)
    em.persist(run)
    await em.flush()

    const queue = getMrpRunQueue()
    await queue.enqueue({
      mrpRunId: run.id,
      tenantId,
      organizationId,
      userId: ctx.auth?.sub ?? null,
    })

    return { id: run.id }
  },

  async buildLog({ result }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('production.audit.mrp.create_run', 'Start MRP run'),
      resourceKind: 'production.mrp_run',
      resourceId: result.id,
      payload: { runId: result.id },
    }
  },
}

// ---------------------------------------------------------------------------
// production.mrp.cronFanOut — scheduler target command (system scope)
//
// Enumerates the distinct tenant/organization scopes that actually use MRP
// (any scope with at least one `ProductPlanningParams` row) and enqueues one
// `MrpRun` + one queue job per scope (fan-out, spec decision c: "never one
// job iterating all tenants"). Wired via the Scheduler UI: an admin creates
// a `ScheduledJob` with `scopeType: 'system'`, `targetType: 'command'`,
// `targetCommand: 'production.mrp.cronFanOut'`.
//
// Documented limitation: a tenant/org with zero `ProductPlanningParams` rows
// never gets a cron run — there is nothing for MRP to plan for it yet, so
// this is not a functional gap, just the enumeration boundary.
// ---------------------------------------------------------------------------

const cronFanOutCommand: CommandHandler<Record<string, unknown>, { runsCreated: number }> = {
  id: 'production.mrp.cronFanOut',
  isUndoable: false,

  async execute(_input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const connection = em.getConnection()
    const rows = await connection.execute(
      `select distinct "tenant_id", "organization_id" from "production_planning_params" where "deleted_at" is null`,
      [],
      'all',
    )
    const scopes: Array<{ tenantId: string; organizationId: string }> = []
    if (Array.isArray(rows)) {
      for (const row of rows as Array<Record<string, unknown>>) {
        const tenantId = typeof row.tenant_id === 'string' ? row.tenant_id : null
        const organizationId = typeof row.organization_id === 'string' ? row.organization_id : null
        if (tenantId && organizationId) scopes.push({ tenantId, organizationId })
      }
    }

    const asOfDate = toIsoDate(new Date())
    const queue = getMrpRunQueue()
    let runsCreated = 0
    for (const scope of scopes) {
      // Review finding (major): toggle off must mean NO observable change,
      // including cron. A tenant with `production_enabled=false` (default —
      // `isProductionEnabledForTenant` fails closed) is skipped entirely: no
      // `MrpRun` row, no queue job, even if it has `ProductPlanningParams`
      // rows from before the toggle was disabled.
      const enabled = await isProductionEnabledForTenant(scope.tenantId)
      if (!enabled) continue

      const run = em.create(MrpRun, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        status: 'pending',
        params: { asOfDate },
        progressJobId: null,
        startedAt: null,
        finishedAt: null,
        stats: null,
      } as never)
      em.persist(run)
      await em.flush()

      await queue.enqueue({
        mrpRunId: run.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        userId: null,
      })
      runsCreated += 1
    }

    return { runsCreated }
  },

  async buildLog({ result }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('production.audit.mrp.cron_fan_out', 'MRP cron fan-out'),
      resourceKind: 'production.mrp_run',
      resourceId: null,
      payload: { runsCreated: result.runsCreated },
    }
  },
}

// ---------------------------------------------------------------------------
// production.mrp.acceptSuggestions — bulk accept
//
// `make` -> creates a draft production order (`production.orders.create`,
// `sourceType: 'mrp'`, `sourceId: suggestion.id`).
// `buy` -> marks accepted and emits `production.mrp_suggestion.accepted`
// (spec decision d, the purchasing seam) — a subscriber turns this into a
// notification (`subscribers/mrp-suggestion-accepted-notification.ts`);
// the CSV export itself is a separate read-only route
// (`api/mrp/suggestions/export`), not triggered by acceptance.
// `reschedule`/`cancel` -> marked accepted and the same event is emitted;
// existing orders are NOT auto-modified in this MVP (documented — a human
// acts on the notification/event manually; automatic order mutation from a
// suggestion is a tracked follow-up).
//
// Only currently-`open` suggestions are actionable; already-resolved rows
// are silently skipped (idempotent re-submission of a bulk selection).
// ---------------------------------------------------------------------------

export interface AcceptSuggestionsResult {
  acceptedIds: string[]
  createdOrderIds: string[]
  skippedIds: string[]
}

const acceptSuggestionsCommand: CommandHandler<MrpSuggestionsBulkActionInput, AcceptSuggestionsResult> = {
  id: 'production.mrp.acceptSuggestions',
  isUndoable: false,

  async execute(input, ctx) {
    const { tenantId, organizationId } = requireScopeIds(ctx)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const dataEngine = resolveDataEngine(ctx)

    const rows = await em.find(MrpSuggestion, {
      id: { $in: input.ids },
      tenantId,
      organizationId,
      deletedAt: null,
    })

    const acceptedIds: string[] = []
    const createdOrderIds: string[] = []
    const skippedIds: string[] = []

    for (const row of rows) {
      if (row.status !== 'open') {
        skippedIds.push(row.id)
        continue
      }

      if (row.suggestionType === 'make') {
        const { result } = await commandBus.execute<{ [key: string]: unknown }, { id: string }>(
          'production.orders.create',
          {
            input: {
              productId: row.productId,
              variantId: row.variantId ?? null,
              qtyPlanned: Number(row.qty),
              uom: row.uom,
              dueDate: row.dueDate,
              priority: 0,
              sourceType: 'mrp',
              sourceId: row.id,
            },
            ctx,
          },
        )
        createdOrderIds.push(result.id)
      }

      row.status = 'accepted'
      em.persist(row)
      await em.flush()

      await emitCrudSideEffects({
        dataEngine,
        action: 'updated',
        entity: row,
        identifiers: { id: row.id, organizationId, tenantId },
        indexer: mrpSuggestionCrudIndexer,
        events: mrpSuggestionCrudEvents,
      })

      await emitProductionEvent(
        'production.mrp_suggestion.accepted',
        {
          id: row.id,
          suggestionType: row.suggestionType,
          productId: row.productId,
          variantId: row.variantId ?? null,
          qty: row.qty,
          uom: row.uom,
          dueDate: row.dueDate.toISOString().slice(0, 10),
          tenantId,
          organizationId,
        },
        { persistent: true },
      )

      acceptedIds.push(row.id)
    }

    for (const id of input.ids) {
      if (!rows.find((row) => row.id === id)) skippedIds.push(id)
    }

    return { acceptedIds, createdOrderIds, skippedIds }
  },

  async buildLog({ result }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('production.audit.mrp.accept_suggestions', 'Accept MRP suggestions'),
      resourceKind: 'production.mrp_suggestion',
      resourceId: result.acceptedIds[0] ?? null,
      payload: result,
    }
  },
}

// ---------------------------------------------------------------------------
// production.mrp.dismissSuggestions — bulk dismiss
// ---------------------------------------------------------------------------

export interface DismissSuggestionsResult {
  dismissedIds: string[]
  skippedIds: string[]
}

const dismissSuggestionsCommand: CommandHandler<MrpSuggestionsBulkActionInput, DismissSuggestionsResult> = {
  id: 'production.mrp.dismissSuggestions',
  isUndoable: false,

  async execute(input, ctx) {
    const { tenantId, organizationId } = requireScopeIds(ctx)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const dataEngine = resolveDataEngine(ctx)

    const rows = await em.find(MrpSuggestion, {
      id: { $in: input.ids },
      tenantId,
      organizationId,
      deletedAt: null,
    })

    const dismissedIds: string[] = []
    const skippedIds: string[] = []

    for (const row of rows) {
      if (row.status !== 'open') {
        skippedIds.push(row.id)
        continue
      }
      row.status = 'dismissed'
      em.persist(row)
      await em.flush()

      await emitCrudSideEffects({
        dataEngine,
        action: 'updated',
        entity: row,
        identifiers: { id: row.id, organizationId, tenantId },
        indexer: mrpSuggestionCrudIndexer,
        events: mrpSuggestionCrudEvents,
      })

      dismissedIds.push(row.id)
    }

    for (const id of input.ids) {
      if (!rows.find((row) => row.id === id)) skippedIds.push(id)
    }

    return { dismissedIds, skippedIds }
  },

  async buildLog({ result }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('production.audit.mrp.dismiss_suggestions', 'Dismiss MRP suggestions'),
      resourceKind: 'production.mrp_suggestion',
      resourceId: result.dismissedIds[0] ?? null,
      payload: result,
    }
  },
}

registerCommand(createRunCommand)
registerCommand(cronFanOutCommand)
registerCommand(acceptSuggestionsCommand)
registerCommand(dismissSuggestionsCommand)
