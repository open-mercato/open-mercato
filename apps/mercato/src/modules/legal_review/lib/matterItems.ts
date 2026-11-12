import type { AuthPrincipalService } from '@open-mercato/shared/lib/auth/principal-service'
import {
  legalAgreementTypeSchema,
  legalPaperSchema,
  type LegalMatterItem,
} from '../data/validators'
import { normalizeLegalMatterStage } from './stages'

export const LEGAL_MATTER_ENTITY_ID = 'legal_review:legal_matter' as const

type Scope = { tenantId: string; organizationId: string }
type ServiceContainer = { resolve: (name: string) => unknown }

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function readIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' && value.length > 0) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

function pick(item: Record<string, unknown>, snake: string, camel: string): unknown {
  return item[snake] !== undefined ? item[snake] : item[camel]
}

/** Maps a query-engine row (snake_case) or an entity-shaped object to the API item. */
export function toLegalMatterItem(item: Record<string, unknown>): LegalMatterItem {
  const agreementType = legalAgreementTypeSchema.safeParse(pick(item, 'agreement_type', 'agreementType'))
  const paper = legalPaperSchema.safeParse(item.paper)
  return {
    id: String(item.id),
    documentId: String(pick(item, 'document_id', 'documentId')),
    reference: readString(item.reference) ?? '',
    counterparty: readString(item.counterparty) ?? '',
    purpose: readString(item.purpose),
    jurisdiction: readString(item.jurisdiction),
    agreementType: agreementType.success ? agreementType.data : 'other',
    paper: paper.success ? paper.data : 'counterparty',
    requestedByUserId: readString(pick(item, 'requested_by_user_id', 'requestedByUserId')),
    assigneeUserId: readString(pick(item, 'assignee_user_id', 'assigneeUserId')),
    requestedByLabel: null,
    assigneeLabel: null,
    stage: normalizeLegalMatterStage(item.stage),
    dueAt: readIso(pick(item, 'due_at', 'dueAt')),
    organizationId: String(pick(item, 'organization_id', 'organizationId')),
    createdAt: readIso(pick(item, 'created_at', 'createdAt')),
    updatedAt: readIso(pick(item, 'updated_at', 'updatedAt')),
  }
}

function resolvePrincipalService(container: ServiceContainer): Pick<AuthPrincipalService, 'resolveLabels'> | null {
  try {
    const service = container.resolve('authPrincipalService') as Partial<AuthPrincipalService> | null
    return service && typeof service.resolveLabels === 'function'
      ? (service as Pick<AuthPrincipalService, 'resolveLabels'>)
      : null
  } catch {
    return null
  }
}

/**
 * Adds `requestedByLabel` / `assigneeLabel` display names, resolved server-side
 * through the auth principal service so a viewer does not need the
 * `auth.users.list` feature to see who asked for and who handles a matter.
 */
export async function applyUserLabels(
  container: ServiceContainer,
  scope: Scope,
  items: LegalMatterItem[],
): Promise<LegalMatterItem[]> {
  const userIds = Array.from(
    new Set(
      items
        .flatMap((item) => [item.requestedByUserId, item.assigneeUserId])
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  )
  if (userIds.length === 0) return items
  const service = resolvePrincipalService(container)
  if (!service) return items
  const labels = await service.resolveLabels({ type: 'user', ids: userIds, scope })
  const byId = new Map(labels.map((entry) => [entry.id, readString(entry.label)]))
  return items.map((item) => ({
    ...item,
    requestedByLabel: item.requestedByUserId ? byId.get(item.requestedByUserId) ?? null : null,
    assigneeLabel: item.assigneeUserId ? byId.get(item.assigneeUserId) ?? null : null,
  }))
}
