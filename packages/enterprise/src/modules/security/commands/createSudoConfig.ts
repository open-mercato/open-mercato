import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { sudoConfigSchema } from '../data/validators'
import { SudoChallengeConfig } from '../data/entities'
import type { SudoChallengeService } from '../services/SudoChallengeService'
import {
  buildSudoAuthScopeFromAuth,
  buildSudoConfigAuditLog,
  captureSudoConfigSnapshot,
  denySudoConfigReplay,
  parseSudoConfigCommandInput,
  readSudoConfigForAudit,
  readSudoConfigUndoPayload,
} from './sudoConfig.shared'

export const commandId = 'security.sudo.config.create'

registerCommand({
  id: commandId,
  isUndoable: false,
  authorizeReplay: denySudoConfigReplay,

  async execute(rawInput, ctx) {
    const actor = ctx.auth?.sub
    if (!actor) throw new CrudHttpError(401, { error: 'Unauthorized' })

    const input = parseSudoConfigCommandInput(sudoConfigSchema, rawInput)
    const scope = buildSudoAuthScopeFromAuth(ctx.auth)
    const { id } = await ctx.container.resolve<SudoChallengeService>('sudoChallengeService')
      .createConfig(input, actor, scope)
    return { id }
  },

  async buildLog({ result, ctx }) {
    const config = await readSudoConfigForAudit(ctx, (result as { id: string }).id)
    return buildSudoConfigAuditLog(ctx, 'create', config?.id ?? null, {
      after: config ? captureSudoConfigSnapshot(config) : null,
    })
  },

  async undo({ logEntry, ctx }) {
    const after = readSudoConfigUndoPayload(logEntry)?.after
    if (!after) return

    const em = ctx.container.resolve<EntityManager>('em')
    const config = await em.findOne(SudoChallengeConfig, { id: after.id, deletedAt: null })
    if (config) {
      const now = new Date()
      Object.assign(config, { deletedAt: now, updatedAt: now })
      await em.flush()
    }
  },
})
