import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { sudoConfigUpdateSchema } from '../data/validators'
import { SudoChallengeConfig } from '../data/entities'
import type { SudoChallengeService } from '../services/SudoChallengeService'
import {
  applySudoConfigSnapshot,
  captureSudoConfigSnapshot,
  readSudoConfigUndoPayload,
  type SudoConfigUndoPayload,
} from './sudoConfig.shared'

export const commandId = 'security.sudo.config.update'

const commandSchema = z.object({
  id: z.string().uuid(),
  data: sudoConfigUpdateSchema,
})

registerCommand({
  id: commandId,
  async prepare(rawInput, ctx) {
    const parsed = commandSchema.safeParse(rawInput)
    if (!parsed.success) {
      throw new CrudHttpError(400, { error: 'Invalid payload', issues: parsed.error.issues })
    }

    const em = ctx.container.resolve<EntityManager>('em')
    const config = await em.findOne(SudoChallengeConfig, { id: parsed.data.id, deletedAt: null })
    if (!config) {
      throw new CrudHttpError(404, { error: 'Sudo configuration not found' })
    }
    return { before: captureSudoConfigSnapshot(config) }
  },
  async execute(rawInput, ctx) {
    if (!ctx.auth?.sub) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }
    const parsed = commandSchema.safeParse(rawInput)
    if (!parsed.success) {
      throw new CrudHttpError(400, { error: 'Invalid payload', issues: parsed.error.issues })
    }

    const service = ctx.container.resolve<SudoChallengeService>('sudoChallengeService')
    await service.updateConfig(parsed.data.id, parsed.data.data, ctx.auth.sub)
    return { ok: true as const }
  },
  async buildLog({ input, snapshots, ctx }) {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const payload = commandSchema.parse(input)
    const config = await em.findOne(SudoChallengeConfig, { id: payload.id })
    return {
      actionLabel: translate('security.audit.sudo.update', 'Update sudo configuration'),
      resourceKind: 'security.sudo_config',
      resourceId: payload.id,
      actorUserId: ctx.auth?.sub ?? null,
      payload: {
        undo: {
          before: (snapshots.before as SudoConfigUndoPayload['before']) ?? null,
          after: config ? captureSudoConfigSnapshot(config) : null,
        } satisfies SudoConfigUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = readSudoConfigUndoPayload(logEntry)?.before
    if (!before) return

    const em = ctx.container.resolve<EntityManager>('em')
    const config = await em.findOne(SudoChallengeConfig, { id: before.id })
    if (!config) return
    applySudoConfigSnapshot(config, before)
    await em.flush()
  },
})
