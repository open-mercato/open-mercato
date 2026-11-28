import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { SudoChallengeService } from '../services/SudoChallengeService'
import {
  buildSudoAuthScopeFromAuth,
  buildSudoConfigAuditLog,
  captureSudoConfigBeforeWrite,
  denySudoConfigReplay,
  parseSudoConfigCommandInput,
  readSudoConfigUndoPayload,
  restoreSudoConfigSnapshot,
  type SudoConfigUndoPayload,
} from './sudoConfig.shared'

export const commandId = 'security.sudo.config.delete'

const commandSchema = z.object({
  id: z.string().uuid(),
})

registerCommand({
  id: commandId,
  isUndoable: false,
  authorizeReplay: denySudoConfigReplay,

  prepare(rawInput, ctx) {
    const { id } = parseSudoConfigCommandInput(commandSchema, rawInput)
    return captureSudoConfigBeforeWrite(ctx, id)
  },

  async execute(rawInput, ctx) {
    const { id } = parseSudoConfigCommandInput(commandSchema, rawInput)
    await ctx.container.resolve<SudoChallengeService>('sudoChallengeService')
      .deleteConfig(id, buildSudoAuthScopeFromAuth(ctx.auth))
    return { ok: true as const }
  },

  buildLog({ input, snapshots, ctx }) {
    const { id } = commandSchema.parse(input)
    return buildSudoConfigAuditLog(ctx, 'delete', id, {
      before: (snapshots.before as SudoConfigUndoPayload['before']) ?? null,
    })
  },

  async undo({ logEntry, ctx }) {
    const before = readSudoConfigUndoPayload(logEntry)?.before
    if (before) await restoreSudoConfigSnapshot(ctx.container.resolve<EntityManager>('em'), before, true)
  },
})
