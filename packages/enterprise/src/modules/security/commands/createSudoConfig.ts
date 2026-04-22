import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { sudoConfigSchema } from '../data/validators'
import { SudoChallengeConfig } from '../data/entities'
import type { SudoChallengeService } from '../services/SudoChallengeService'
import {
  applySudoConfigSnapshot,
  captureSudoConfigSnapshot,
  readSudoConfigUndoPayload,
  type SudoConfigUndoPayload,
} from './sudoConfig.shared'

export const commandId = 'security.sudo.config.create'

type CommandInput = z.infer<typeof sudoConfigSchema>

registerCommand({
  id: commandId,
  async execute(rawInput, ctx) {
    if (!ctx.auth?.sub) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }
    const parsed = sudoConfigSchema.safeParse(rawInput)
    if (!parsed.success) {
      throw new CrudHttpError(400, { error: 'Invalid payload', issues: parsed.error.issues })
    }

    const service = ctx.container.resolve<SudoChallengeService>('sudoChallengeService')
    const config = await service.createConfig(parsed.data, ctx.auth.sub)
    return { id: config.id }
  },
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const config = await em.findOne(SudoChallengeConfig, { id: (result as { id: string }).id })
    const after = config ? captureSudoConfigSnapshot(config) : null
    return {
      actionLabel: translate('security.audit.sudo.create', 'Create sudo configuration'),
      resourceKind: 'security.sudo_config',
      resourceId: config?.id ?? null,
      actorUserId: ctx.auth?.sub ?? null,
      payload: {
        undo: {
          after,
        } satisfies SudoConfigUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const after = readSudoConfigUndoPayload(logEntry)?.after
    if (!after) return

    const em = ctx.container.resolve<EntityManager>('em')
    const config = await em.findOne(SudoChallengeConfig, { id: after.id, deletedAt: null })
    if (!config) return
    config.deletedAt = new Date()
    config.updatedAt = new Date()
    await em.flush()
  },
})
