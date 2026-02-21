import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import type { RecordLockService } from '../lib/recordLockService'

type ResolveConflictInput = {
  id: string
}

async function resolveConflict(
  input: ResolveConflictInput,
  resolution: 'accept_incoming' | 'accept_mine',
  ctx: Parameters<CommandHandler<ResolveConflictInput, { ok: boolean }>['execute']>[1],
): Promise<{ ok: boolean }> {
  const tenantId = ctx.auth?.tenantId
  const userId = ctx.auth?.sub
  if (!tenantId || !userId || !input?.id) return { ok: false }
  const recordLockService = ctx.container.resolve<RecordLockService>('recordLockService')
  const resolved = await recordLockService.resolveConflictById({
    conflictId: input.id,
    tenantId,
    organizationId: ctx.auth?.orgId ?? null,
    userId,
    resolution,
  })
  return { ok: resolved }
}

registerCommand({
  id: 'record_locks.conflict.accept_incoming',
  async execute(input, ctx) {
    return resolveConflict((input ?? {}) as ResolveConflictInput, 'accept_incoming', ctx)
  },
})

registerCommand({
  id: 'record_locks.conflict.accept_mine',
  async execute(input, ctx) {
    return resolveConflict((input ?? {}) as ResolveConflictInput, 'accept_mine', ctx)
  },
})
