import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { ChallengeMethod, SudoChallengeConfig } from '../data/entities'
import type { SudoChallengeService } from '../services/SudoChallengeService'
import {
  applySudoConfigSnapshot,
  captureSudoConfigSnapshot,
  readSudoConfigUndoPayload,
  type SudoConfigUndoPayload,
} from './sudoConfig.shared'

export const commandId = 'security.sudo.config.delete'

const commandSchema = z.object({
  id: z.string().uuid(),
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
    const parsed = commandSchema.safeParse(rawInput)
    if (!parsed.success) {
      throw new CrudHttpError(400, { error: 'Invalid payload', issues: parsed.error.issues })
    }

    const service = ctx.container.resolve<SudoChallengeService>('sudoChallengeService')
    await service.deleteConfig(parsed.data.id)
    return { ok: true as const }
  },
  async buildLog({ input, snapshots, ctx }) {
    const { translate } = await resolveTranslations()
    const payload = commandSchema.parse(input)
    return {
      actionLabel: translate('security.audit.sudo.delete', 'Delete sudo configuration'),
      resourceKind: 'security.sudo_config',
      resourceId: payload.id,
      actorUserId: ctx.auth?.sub ?? null,
      payload: {
        undo: {
          before: (snapshots.before as SudoConfigUndoPayload['before']) ?? null,
        } satisfies SudoConfigUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = readSudoConfigUndoPayload(logEntry)?.before
    if (!before) return

    const em = ctx.container.resolve<EntityManager>('em')
    const config = await em.findOne(SudoChallengeConfig, { id: before.id })
    if (!config) {
      const created = em.create(SudoChallengeConfig, {
        id: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        label: before.label,
        targetIdentifier: before.targetIdentifier,
        isEnabled: before.isEnabled,
        isDeveloperDefault: before.isDeveloperDefault,
        ttlSeconds: before.ttlSeconds,
        challengeMethod: before.challengeMethod as ChallengeMethod,
        configuredBy: before.configuredBy,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: before.deletedAt ? new Date(before.deletedAt) : null,
      })
      em.persist(created)
      await em.flush()
      return
    }

    applySudoConfigSnapshot(config, before)
    await em.flush()
  },
})
