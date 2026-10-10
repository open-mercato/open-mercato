import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  buildOptimisticLockConflictBody,
  enforceCommandOptimisticLockWithGuards,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { InsightsAutomationSuggestion } from '../data/entities'
import { xraySuggestionUpdateCommandSchema, type XraySuggestionUpdateCommandInput } from '../data/validators'
import { XRAY_SUGGESTION_RESOURCE_KIND } from '../lib/suggestions/constants'
import { resolveWorkflowDraftService } from '../lib/workflowsBridge'

export const XRAY_SUGGESTION_UPDATE_COMMAND_ID = 'insights.xray.suggestion.update'

export type XraySuggestionSnapshot = {
  id: string
  processKey: string
  status: string
  draftedArtifactId: string | null
  updatedAt: string | null
}

export type UpdateXraySuggestionResult = XraySuggestionSnapshot

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null
  return Number.isNaN(value.getTime()) ? null : value.toISOString()
}

function toSnapshot(record: InsightsAutomationSuggestion): XraySuggestionSnapshot {
  return {
    id: record.id,
    processKey: record.processKey,
    status: record.status,
    draftedArtifactId: record.draftedArtifactId ?? null,
    updatedAt: toIso(record.updatedAt),
  }
}

async function findSuggestionRecord(em: EntityManager, input: Pick<XraySuggestionUpdateCommandInput, 'id' | 'tenantId' | 'organizationId'>): Promise<InsightsAutomationSuggestion | null> {
  const record = await findOneWithDecryption(
    em,
    InsightsAutomationSuggestion,
    { id: input.id, tenantId: input.tenantId, organizationId: input.organizationId, deletedAt: null },
    undefined,
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
  if (!record || record.tenantId !== input.tenantId || record.organizationId !== input.organizationId) return null
  return record
}

/**
 * A drafted suggestion must point at a workflow definition of the same tenant AND organization,
 * read through the workflows module's soft-optional `workflowDraftService` (422 when it is absent
 * or the definition does not resolve in that scope; the error never says which).
 */
async function assertDraftedArtifact(ctx: CommandRuntimeContext, input: XraySuggestionUpdateCommandInput): Promise<void> {
  if (input.status !== 'drafted' || !input.draftedArtifactId) return
  const { translate } = await resolveTranslations()
  const service = resolveWorkflowDraftService(ctx.container)
  if (!service) {
    throw new CrudHttpError(422, {
      error: translate('insights.xray.errors.workflows_unavailable', 'Workflows are not available.'),
      code: 'workflows_unavailable',
    })
  }
  const definition = await service.getDefinitionForScope(input.draftedArtifactId, { tenantId: input.tenantId, organizationId: input.organizationId })
  if (!definition) {
    throw new CrudHttpError(422, {
      error: translate('insights.xray.errors.drafted_artifact_not_found', 'The workflow definition does not exist in this organization.'),
      code: 'drafted_artifact_not_found',
    })
  }
}

async function conflictWithCurrent(em: EntityManager, input: XraySuggestionUpdateCommandInput, expected: Date): Promise<never> {
  const winner = await findSuggestionRecord(em.fork(), input)
  const currentIso = toIso(winner?.updatedAt ?? null)
  const expectedIso = toIso(expected)
  if (currentIso && expectedIso) throw new CrudHttpError(409, buildOptimisticLockConflictBody(currentIso, expectedIso))
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(409, {
    error: translate('insights.xray.errors.suggestionConflict', 'The suggestion was changed by someone else. Reload and try again.'),
    code: 'suggestion_conflict',
  })
}

/**
 * Changes the status of one automation suggestion: `dismissed`, `drafted` (with the workflow
 * definition created from its draft) or back to `open`. Optimistic locking exactly like the
 * settings command: the version header (`updatedAt`) is checked against the stored row
 * (`enforceCommandOptimisticLockWithGuards`), and the write is a compare-and-set on `updated_at`,
 * so a concurrent change (a user or a mining pass) between the check and the write still answers
 * 409. A superseded suggestion (its evidence is gone) cannot be changed (422).
 */
const updateXraySuggestionCommand: CommandHandler<XraySuggestionUpdateCommandInput, UpdateXraySuggestionResult> = {
  id: XRAY_SUGGESTION_UPDATE_COMMAND_ID,
  async prepare(rawInput, ctx) {
    const input = xraySuggestionUpdateCommandSchema.parse(rawInput ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findSuggestionRecord(em, input)
    return { before: record ? toSnapshot(record) : null }
  },
  async execute(rawInput, ctx) {
    const input = xraySuggestionUpdateCommandSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await findSuggestionRecord(em, input)
    const { translate } = await resolveTranslations()
    if (!existing) {
      throw new CrudHttpError(404, { error: translate('insights.xray.errors.suggestion_not_found', 'Suggestion not found.'), code: 'suggestion_not_found' })
    }
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: XRAY_SUGGESTION_RESOURCE_KIND,
      resourceId: existing.id,
      current: existing.updatedAt,
      request: ctx.request ?? null,
    })
    if (existing.status === 'superseded') {
      throw new CrudHttpError(422, {
        error: translate('insights.xray.errors.suggestion_superseded', 'This suggestion is out of date and cannot be changed.'),
        code: 'suggestion_superseded',
      })
    }
    await assertDraftedArtifact(ctx, input)
    const loadedUpdatedAt = existing.updatedAt
    const updatedAt = new Date(Math.max(Date.now(), loadedUpdatedAt.getTime() + 1))
    const affected = await em.nativeUpdate(
      InsightsAutomationSuggestion,
      { id: existing.id, tenantId: input.tenantId, organizationId: input.organizationId, updatedAt: loadedUpdatedAt, deletedAt: null },
      { status: input.status, draftedArtifactId: input.status === 'drafted' ? input.draftedArtifactId ?? null : null, updatedAt },
    )
    if (affected !== 1) await conflictWithCurrent(em, input, loadedUpdatedAt)
    const saved = await findSuggestionRecord(em.fork(), input)
    if (!saved) throw new CrudHttpError(404, { error: translate('insights.xray.errors.suggestion_not_found', 'Suggestion not found.'), code: 'suggestion_not_found' })
    return toSnapshot(saved)
  },
  buildLog: async ({ input, result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = (snapshots.before as XraySuggestionSnapshot | null | undefined) ?? null
    return {
      actionLabel: translate('insights.xray.audit.suggestionUpdate', 'Update Process X-Ray suggestion'),
      resourceKind: XRAY_SUGGESTION_RESOURCE_KIND,
      resourceId: result.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: before,
      snapshotAfter: result,
    }
  },
}

registerCommand(updateXraySuggestionCommand)

export const xraySuggestionCommands = [updateXraySuggestionCommand]

export { updateXraySuggestionCommand }
