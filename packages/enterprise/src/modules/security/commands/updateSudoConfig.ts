import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { sudoConfigUpdateSchema } from '../data/validators'
import { SudoChallengeConfig } from '../data/entities'
import {
  applySudoConfigSnapshot,
  authorizeSudoConfigWrite,
  readSudoConfigWriteSnapshots,
  readSudoConfigUndoPayload,
  writeSudoConfig,
} from './sudoConfig.shared'

export const commandId = 'security.sudo.config.update'

const commandSchema = z.object({
  id: z.string().uuid(),
  expectedUpdatedAt: z.iso.datetime().optional(),
  data: sudoConfigUpdateSchema,
})

registerCommand({
  id: commandId,
  isUndoable: false,
  authorizeReplay() {
    throw new Error('[internal] Sudo configuration commands do not support replay')
  },
  async prepare(rawInput, ctx) {
    const parsed = commandSchema.safeParse(rawInput)
    if (!parsed.success) {
      throw new CrudHttpError(400, { error: 'Invalid payload', issues: parsed.error.issues })
    }

    await authorizeSudoConfigWrite(ctx, parsed.data.id)
    return {}
  },
  async execute(rawInput, ctx) {
    if (!ctx.auth?.sub) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }
    const parsed = commandSchema.safeParse(rawInput)
    if (!parsed.success) {
      throw new CrudHttpError(400, { error: 'Invalid payload', issues: parsed.error.issues })
    }

    return writeSudoConfig(ctx, parsed.data.id, parsed.data.expectedUpdatedAt, { data: parsed.data.data, configuredBy: ctx.auth.sub })
  },
  async buildLog({ input, result, ctx }) {
    const { translate } = await resolveTranslations()
    const payload = commandSchema.parse(input)
    return {
      actionLabel: translate('security.audit.sudo.update', 'Update sudo configuration'),
      resourceKind: 'security.sudo_config',
      resourceId: payload.id,
      actorUserId: ctx.auth?.sub ?? null,
      payload: {
        undo: readSudoConfigWriteSnapshots(result),
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
