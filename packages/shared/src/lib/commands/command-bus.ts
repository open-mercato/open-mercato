import type { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import { commandRegistry } from './registry'
import type {
  CommandExecutionOptions,
  CommandExecuteResult,
  CommandHandler,
  CommandLogBuilderArgs,
  CommandLogMetadata,
} from './types'
import { defaultUndoToken } from './types'
import type { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'

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
    return { result, logEntry }
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
    const undoToken = metadata.undoToken ?? null

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

    if (!('commandPayload' in payload)) {
      payload.commandPayload = options.input
    }

    return await service.log(payload as any)
  }
}
