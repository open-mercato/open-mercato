import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'

function normalizeStatus(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function resolveApiKeyLabel(auth: any): string | null {
  if (!auth || !auth.isApiKey) return null
  const keyName = typeof auth.keyName === 'string' ? auth.keyName.trim() : ''
  const keyId = typeof auth.keyId === 'string' ? auth.keyId.trim() : ''
  const label = keyName || keyId || (typeof auth.sub === 'string' ? auth.sub : '')
  return label ? label : null
}

function buildStatusSnapshot(
  kind: 'order' | 'quote',
  data: {
    id: string
    organizationId: string
    tenantId: string
    status: string | null
    statusEntryId?: string | null
  }
) {
  if (kind === 'order') {
    return {
      order: {
        id: data.id,
        organizationId: data.organizationId,
        tenantId: data.tenantId,
        status: data.status,
        statusEntryId: data.statusEntryId ?? null,
      },
    }
  }
  return {
    quote: {
      id: data.id,
      organizationId: data.organizationId,
      tenantId: data.tenantId,
      status: data.status,
      statusEntryId: data.statusEntryId ?? null,
    },
  }
}

export async function logSalesStatusChange(options: {
  ctx: CommandRuntimeContext
  documentKind: 'order' | 'quote'
  documentId: string
  organizationId: string
  tenantId: string
  previousStatus: string | null
  nextStatus: string | null
  previousStatusEntryId?: string | null
  nextStatusEntryId?: string | null
  actionLabelKey: string
  actionLabelFallback: string
  commandId: string
}): Promise<void> {
  const previous = normalizeStatus(options.previousStatus)
  const next = normalizeStatus(options.nextStatus)
  if (previous === next) return

  let actionLogService: ActionLogService | null = null
  try {
    actionLogService = options.ctx.container.resolve('actionLogService') as ActionLogService
  } catch {
    actionLogService = null
  }
  if (!actionLogService) return

  const { translate } = await resolveTranslations()
  const apiKeyLabel = resolveApiKeyLabel(options.ctx.auth)
  const context = {
    statusFrom: previous,
    statusTo: next,
    documentKind: options.documentKind,
    actorKind: apiKeyLabel ? 'api_key' : undefined,
    actorLabel: apiKeyLabel ?? undefined,
  }

  const snapshotBefore = buildStatusSnapshot(options.documentKind, {
    id: options.documentId,
    organizationId: options.organizationId,
    tenantId: options.tenantId,
    status: previous,
    statusEntryId: options.previousStatusEntryId ?? null,
  })
  const snapshotAfter = buildStatusSnapshot(options.documentKind, {
    id: options.documentId,
    organizationId: options.organizationId,
    tenantId: options.tenantId,
    status: next,
    statusEntryId: options.nextStatusEntryId ?? null,
  })

  await actionLogService.log({
    commandId: options.commandId,
    actionLabel: translate(options.actionLabelKey, options.actionLabelFallback),
    resourceKind: options.documentKind === 'order' ? 'sales.order' : 'sales.quote',
    resourceId: options.documentId,
    tenantId: options.tenantId,
    organizationId: options.organizationId,
    actorUserId: options.ctx.auth?.sub ?? null,
    snapshotBefore,
    snapshotAfter,
    context,
  })
}
