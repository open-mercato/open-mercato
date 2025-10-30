import type { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import type { ActionLogCreateInput } from '@open-mercato/core/modules/audit_logs/data/validators'
import { commandRegistry } from './registry'
import type {
  CommandExecutionOptions,
  CommandExecuteResult,
  CommandHandler,
  CommandLogBuilderArgs,
  CommandLogMetadata,
  CommandRuntimeContext,
} from './types'
import { defaultUndoToken } from './types'
import type { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import type { AwilixContainer } from 'awilix'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import {
  deriveResourceFromCommandId,
  invalidateCrudCache,
  pickFirstIdentifier,
  isCrudCacheDebugEnabled,
} from '@open-mercato/shared/lib/crud/cache'

const SKIPPED_ACTION_LOG_RESOURCE_KINDS = new Set<string>([
  'audit_logs.access',
  'audit_logs.action',
  'dashboards.layout',
  'dashboards.user_widgets',
  'dashboards.role_widgets',
])

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  return input as Record<string, unknown>
}

function extractAliasList(source: unknown): string[] {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return []
  const record = source as Record<string, unknown>
  const raw = record.cacheAliases
  if (!Array.isArray(raw)) return []
  return raw
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim())
}

export class CommandBus {
  async execute<TInput = unknown, TResult = unknown>(
    commandId: string,
    options: CommandExecutionOptions<TInput>
  ): Promise<CommandExecuteResult<TResult>> {
    const handler = this.resolveHandler<TInput, TResult>(commandId)
    const snapshots = await this.prepareSnapshots(handler, options)
    const result = await handler.execute(options.input, options.ctx)
    const afterSnapshot = await this.captureAfter(handler, options, result)
    const logMeta = await this.buildLog(handler, options, result, snapshots)
    let mergedMeta = this.mergeMetadata(options.metadata, logMeta)
    const undoable = this.isUndoable(handler)
    if (undoable) {
      mergedMeta = mergedMeta ?? {}
      if (!mergedMeta.undoToken) mergedMeta.undoToken = defaultUndoToken()
      if (mergedMeta.actorUserId === undefined) mergedMeta.actorUserId = options.ctx.auth?.sub ?? null
    }
    if (afterSnapshot !== undefined && afterSnapshot !== null) {
      if (!mergedMeta) {
        mergedMeta = { snapshotAfter: afterSnapshot }
      } else if (!mergedMeta.snapshotAfter) {
        mergedMeta.snapshotAfter = afterSnapshot
      }
    }
    if (snapshots.before) {
      if (!mergedMeta) {
        mergedMeta = { snapshotBefore: snapshots.before }
      } else if (!mergedMeta.snapshotBefore) {
        mergedMeta.snapshotBefore = snapshots.before
      }
    }
    const logEntry = await this.persistLog(commandId, options, mergedMeta)
    await this.invalidateCacheAfterExecute(commandId, options, result, mergedMeta)
    await this.flushCrudSideEffects(options.ctx.container)
    return { result, logEntry }
  }

  async undo(undoToken: string, ctx: CommandRuntimeContext): Promise<void> {
    const service = ctx.container.resolve<ActionLogService>('actionLogService')
    const log = await service.findByUndoToken(undoToken)
    if (!log) throw new Error('Undo token expired or not found')
    const handler = this.resolveHandler(log.commandId)
    if (!handler.undo || this.isUndoable(handler) === false) {
      throw new Error(`Command ${log.commandId} is not undoable`)
    }
    await handler.undo({
      input: log.commandPayload as Parameters<NonNullable<typeof handler.undo>>[0]['input'],
      ctx,
      logEntry: log,
    })
    await service.markUndone(log.id)
    await this.invalidateCacheAfterUndo(log, ctx)
    await this.flushCrudSideEffects(ctx.container)
  }

  private resolveHandler<TInput, TResult>(commandId: string): CommandHandler<TInput, TResult> {
    const handler = commandRegistry.get<TInput, TResult>(commandId)
    if (!handler) throw new Error(`Command handler not registered for id ${commandId}`)
    return handler
  }

  private async prepareSnapshots<TInput, TResult>(
    handler: CommandHandler<TInput, TResult>,
    options: CommandExecutionOptions<TInput>
  ): Promise<{ before?: unknown }> {
    if (!handler.prepare) return {}
    try {
      return (await handler.prepare(options.input, options.ctx)) || {}
    } catch (err) {
      throw err
    }
  }

  private async captureAfter<TInput, TResult>(
    handler: CommandHandler<TInput, TResult>,
    options: CommandExecutionOptions<TInput>,
    result: TResult
  ): Promise<unknown> {
    if (!handler.captureAfter) return undefined
    return handler.captureAfter(options.input, result, options.ctx)
  }

  private async buildLog<TInput, TResult>(
    handler: CommandHandler<TInput, TResult>,
    options: CommandExecutionOptions<TInput>,
    result: TResult,
    snapshots: { before?: unknown }
  ): Promise<CommandLogMetadata | null> {
    if (!handler.buildLog) return null
    const args: CommandLogBuilderArgs<TInput, TResult> = {
      input: options.input,
      result,
      ctx: options.ctx,
      snapshots,
    }
    return (await handler.buildLog(args)) || null
  }

  private mergeMetadata(primary?: CommandLogMetadata | null, secondary?: CommandLogMetadata | null): CommandLogMetadata | null {
    if (!primary && !secondary) return null
    return {
      tenantId: primary?.tenantId ?? secondary?.tenantId ?? null,
      organizationId: primary?.organizationId ?? secondary?.organizationId ?? null,
      actorUserId: primary?.actorUserId ?? secondary?.actorUserId ?? null,
      actionLabel: primary?.actionLabel ?? secondary?.actionLabel ?? null,
      resourceKind: primary?.resourceKind ?? secondary?.resourceKind ?? null,
      resourceId: primary?.resourceId ?? secondary?.resourceId ?? null,
      undoToken: primary?.undoToken ?? secondary?.undoToken ?? null,
      payload: primary?.payload ?? secondary?.payload ?? null,
      snapshotBefore: primary?.snapshotBefore ?? secondary?.snapshotBefore ?? null,
      snapshotAfter: primary?.snapshotAfter ?? secondary?.snapshotAfter ?? null,
      changes: primary?.changes ?? secondary?.changes ?? null,
      context: primary?.context ?? secondary?.context ?? null,
    }
  }

  private async persistLog<TInput>(
    commandId: string,
    options: CommandExecutionOptions<TInput>,
    metadata: CommandLogMetadata | null
  ): Promise<ActionLog | null> {
    if (!metadata) return null
    const resourceKind =
      typeof metadata.resourceKind === 'string' ? metadata.resourceKind : null
    if (resourceKind && SKIPPED_ACTION_LOG_RESOURCE_KINDS.has(resourceKind)) {
      return null
    }
    let service: ActionLogService | null = null
    try {
      service = options.ctx.container.resolve<ActionLogService>('actionLogService')
    } catch {
      service = null
    }
    if (!service) return null

    const tenantId = metadata.tenantId ?? options.ctx.auth?.tenantId ?? null
    const organizationId =
      metadata.organizationId ?? options.ctx.selectedOrganizationId ?? options.ctx.auth?.orgId ?? null
    const actorUserId = metadata.actorUserId ?? options.ctx.auth?.sub ?? null
    const payload: Record<string, unknown> = {
      tenantId: tenantId ?? undefined,
      organizationId: organizationId ?? undefined,
      actorUserId: actorUserId ?? undefined,
      commandId,
    }

    if (metadata) {
      if ('actionLabel' in metadata && metadata.actionLabel != null) payload.actionLabel = metadata.actionLabel
      if ('resourceKind' in metadata && metadata.resourceKind != null) payload.resourceKind = metadata.resourceKind
      if ('resourceId' in metadata && metadata.resourceId != null) payload.resourceId = metadata.resourceId
      if ('undoToken' in metadata && metadata.undoToken != null) payload.undoToken = metadata.undoToken
      if ('payload' in metadata && metadata.payload !== undefined) payload.commandPayload = metadata.payload
      if ('snapshotBefore' in metadata && metadata.snapshotBefore !== undefined) payload.snapshotBefore = metadata.snapshotBefore
      if ('snapshotAfter' in metadata && metadata.snapshotAfter !== undefined) payload.snapshotAfter = metadata.snapshotAfter
      if ('changes' in metadata && metadata.changes !== undefined && metadata.changes !== null) payload.changes = metadata.changes
      if ('context' in metadata && metadata.context !== undefined && metadata.context !== null) payload.context = metadata.context
    }

    const redoEnvelope = wrapRedoPayload('commandPayload' in payload ? (payload.commandPayload as unknown) : undefined, options.input)
    payload.commandPayload = redoEnvelope

    return await service.log(payload as ActionLogCreateInput)
  }

  private isUndoable(handler: CommandHandler<unknown, unknown>): boolean {
    return handler.isUndoable !== false && typeof handler.undo === 'function'
  }

  private async invalidateCacheAfterExecute<TResult>(
    commandId: string,
    options: CommandExecutionOptions<unknown>,
    result: TResult,
    metadata: CommandLogMetadata | null
  ): Promise<void> {
    const resource = typeof metadata?.resourceKind === 'string' ? metadata.resourceKind : null
    if (!resource) return
    try {
      const ctx = options.ctx
      const resultRecord = asRecord(result)
      const resultEntity = asRecord(resultRecord?.entity)
      const inputRecord = asRecord(options.input)
      const inputEntity = asRecord(inputRecord?.entity)

      const recordId = pickFirstIdentifier(
        metadata?.resourceId,
        resultRecord?.entityId,
        resultRecord?.id,
        resultRecord?.recordId,
        resultEntity?.id,
        inputRecord?.id,
        inputRecord?.entityId,
        inputRecord?.recordId,
        inputEntity?.id
      )

      const organizationId = pickFirstIdentifier(
        metadata?.organizationId,
        resultRecord?.organizationId,
        resultEntity?.organizationId,
        inputRecord?.organizationId,
        inputEntity?.organizationId,
        ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
      )

      const tenantId = pickFirstIdentifier(
        metadata?.tenantId,
        resultRecord?.tenantId,
        resultEntity?.tenantId,
        inputRecord?.tenantId,
        inputEntity?.tenantId,
        ctx.auth?.tenantId ?? null
      )

      const fallbackTenant = pickFirstIdentifier(metadata?.tenantId, ctx.auth?.tenantId ?? null)

      const aliasSet = new Set<string>()
      for (const alias of extractAliasList(metadata?.context ?? null)) {
        aliasSet.add(alias)
      }
      const derived = deriveResourceFromCommandId(commandId)
      if (derived) aliasSet.add(derived)
      const aliasExtras = Array.from(aliasSet)
      await invalidateCrudCache(
        ctx.container,
        resource,
        { id: recordId, organizationId, tenantId },
        fallbackTenant,
        `command:${commandId}:execute`,
        aliasExtras
      )
    } catch (err) {
      if (isCrudCacheDebugEnabled()) {
        try {
          console.debug('[crud][cache] execute-invalidation failed', { commandId, err })
        } catch {}
      }
    }
  }

  private async invalidateCacheAfterUndo(log: ActionLog, ctx: CommandRuntimeContext): Promise<void> {
    const resource = typeof log.resourceKind === 'string' ? log.resourceKind : null
    if (!resource) return
    try {
      const recordId = pickFirstIdentifier(log.resourceId)
      const organizationId = pickFirstIdentifier(log.organizationId, ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null)
      const tenantId = pickFirstIdentifier(log.tenantId, ctx.auth?.tenantId ?? null)
      const fallbackTenant = pickFirstIdentifier(log.tenantId, ctx.auth?.tenantId ?? null)
      const aliasSet = new Set<string>()
      for (const alias of extractAliasList(log.contextJson ?? null)) {
        aliasSet.add(alias)
      }
      const derived = deriveResourceFromCommandId(log.commandId)
      if (derived) aliasSet.add(derived)
      const aliasExtras = Array.from(aliasSet)
      await invalidateCrudCache(
        ctx.container,
        resource,
        { id: recordId, organizationId, tenantId },
        fallbackTenant,
        `command:${log.commandId}:undo`,
        aliasExtras
      )
    } catch (err) {
      if (isCrudCacheDebugEnabled()) {
        try {
          console.debug('[crud][cache] undo-invalidation failed', { commandId: log.commandId, err })
        } catch {}
      }
    }
  }

  private async flushCrudSideEffects(container: AwilixContainer): Promise<void> {
    try {
      const dataEngine = container.resolve<DataEngine>('dataEngine')
      await dataEngine.flushOrmEntityChanges()
    } catch {
      // best-effort: failures should not block command execution
    }
  }
}

type RedoEnvelope = {
  __redoInput: unknown
  [key: string]: unknown
}

function wrapRedoPayload(existing: unknown, input: unknown): RedoEnvelope {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    const envelope: RedoEnvelope = { __redoInput: input }
    if (existing !== undefined) envelope.value = existing
    return envelope
  }
  const current = existing as Record<string, unknown>
  if ('__redoInput' in current && current.__redoInput !== undefined) {
    return current as RedoEnvelope
  }
  return { __redoInput: input, ...current }
}
