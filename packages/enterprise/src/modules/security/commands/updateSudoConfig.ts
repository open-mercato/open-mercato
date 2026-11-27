import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { sudoConfigUpdateSchema } from '../data/validators'
import type { SudoChallengeService } from '../services/SudoChallengeService'
import {
  buildSudoAuthScopeFromAuth,
  buildSudoConfigAuditLog,
  captureSudoConfigBeforeWrite,
  captureSudoConfigSnapshot,
  denySudoConfigReplay,
  parseSudoConfigCommandInput,
  readSudoConfigForAudit,
  readSudoConfigUndoPayload,
  restoreSudoConfigSnapshot,
  type SudoConfigUndoPayload,
} from './sudoConfig.shared'

export const commandId = 'security.sudo.config.update'

const commandSchema = z.object({
  id: z.string().uuid(),
  data: sudoConfigUpdateSchema,
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
    const actor = ctx.auth?.sub
    if (!actor) throw new CrudHttpError(401, { error: 'Unauthorized' })

    const { id, data } = parseSudoConfigCommandInput(commandSchema, rawInput)
    const scope = buildSudoAuthScopeFromAuth(ctx.auth)
    await ctx.container.resolve<SudoChallengeService>('sudoChallengeService').updateConfig(id, data, actor, scope)
    return { ok: true as const }
  },

  async buildLog({ input, snapshots, ctx }) {
    const { id } = commandSchema.parse(input)
    const updated = await readSudoConfigForAudit(ctx, id)
    return buildSudoConfigAuditLog(ctx, 'update', id, {
      before: (snapshots.before as SudoConfigUndoPayload['before']) ?? null,
      after: updated ? captureSudoConfigSnapshot(updated) : null,
    })
  },

  async undo({ logEntry, ctx }) {
    const before = readSudoConfigUndoPayload(logEntry)?.before
    if (before) await restoreSudoConfigSnapshot(ctx.container.resolve<EntityManager>('em'), before, false)
  },
})
