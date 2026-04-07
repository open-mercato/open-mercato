import type { EntityManager } from '@mikro-orm/postgresql'
import { applyResponseEnrichers } from '@open-mercato/shared/lib/crud/enricher-runner'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerDeal, CustomerEntity, CustomerInteraction } from '../data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import {
  CUSTOMER_INTERACTION_ENTITY_ID,
  type InteractionRecord,
} from './interactionCompatibility'

type ContainerLike = {
  resolve: (name: string) => unknown
}

type AuthLike = {
  tenantId: string | null
  orgId: string | null
  sub?: string | null
  userId?: string | null
  keyId?: string | null
}

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    input: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
}

type HydrateCanonicalInteractionsInput = {
  em: EntityManager
  container: ContainerLike
  auth: AuthLike
  selectedOrganizationId: string | null
  interactions: CustomerInteraction[]
  enrich?: boolean
}

type CustomerSummary = {
  id: string
  displayName: string | null
  kind: string | null
}

function resolveActorId(auth: AuthLike): string {
  if (typeof auth.sub === 'string' && auth.sub.trim().length > 0) return auth.sub
  if (typeof auth.userId === 'string' && auth.userId.trim().length > 0) return auth.userId
  if (typeof auth.keyId === 'string' && auth.keyId.trim().length > 0) return auth.keyId
  return 'system'
}

function mergeAdditiveRecord<T extends Record<string, unknown>>(base: T, candidate: T | undefined): T {
  if (!candidate) return base
  const additions = Object.fromEntries(
    Object.entries(candidate).filter(([key]) => !(key in base)),
  ) as Partial<T>
  return {
    ...base,
    ...additions,
  }
}

async function resolveUserFeatures(
  container: ContainerLike,
  userId: string,
  tenantId: string | null,
  organizationId: string | null,
): Promise<string[] | undefined> {
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.getGrantedFeatures) return undefined
    return await rbac.getGrantedFeatures(userId, { tenantId, organizationId })
  } catch {
    return undefined
  }
}

export async function buildCustomersInteractionEnricherContext(
  container: ContainerLike,
  auth: AuthLike,
  organizationId: string | null,
): Promise<EnricherContext> {
  const userId = resolveActorId(auth)
  return {
    organizationId: organizationId ?? '',
    tenantId: auth.tenantId ?? '',
    userId,
    em: container.resolve('em'),
    container,
    userFeatures: await resolveUserFeatures(container, userId, auth.tenantId, organizationId),
  }
}

export async function loadCustomerSummaries(
  em: EntityManager,
  entityIds: string[],
  tenantId?: string | null,
  organizationId?: string | null,
): Promise<Map<string, CustomerSummary>> {
  if (!entityIds.length) return new Map()
  const entities = await findWithDecryption(em, CustomerEntity, { id: { $in: entityIds } }, undefined, { tenantId, organizationId })
  return new Map(
    entities.map((entity) => [
      entity.id,
      {
        id: entity.id,
        displayName: entity.displayName ?? null,
        kind: entity.kind ?? null,
      },
    ]),
  )
}

export async function hydrateCanonicalInteractions({
  em,
  container,
  auth,
  selectedOrganizationId,
  interactions,
  enrich = false,
}: HydrateCanonicalInteractionsInput): Promise<InteractionRecord[]> {
  if (interactions.length === 0) return []

  const authorIds = Array.from(
    new Set(
      interactions
        .map((interaction) =>
          typeof interaction.authorUserId === 'string' ? interaction.authorUserId : null)
        .filter((value): value is string => !!value),
    ),
  )
  const dealIds = Array.from(
    new Set(
      interactions
        .map((interaction) => (typeof interaction.dealId === 'string' ? interaction.dealId : null))
        .filter((value): value is string => !!value),
    ),
  )

  const tenantId = auth.tenantId ?? null
  const organizationId = selectedOrganizationId ?? null
  const [users, deals, customFieldValues] = await Promise.all([
    authorIds.length > 0 ? findWithDecryption(em, User, { id: { $in: authorIds } }, undefined, { tenantId, organizationId }) : Promise.resolve([]),
    dealIds.length > 0 ? findWithDecryption(em, CustomerDeal, { id: { $in: dealIds } }, undefined, { tenantId, organizationId }) : Promise.resolve([]),
    loadCustomFieldValues({
      em,
      entityId: CUSTOMER_INTERACTION_ENTITY_ID,
      recordIds: interactions.map((interaction) => interaction.id),
      tenantIdByRecord: Object.fromEntries(interactions.map((interaction) => [interaction.id, interaction.tenantId])),
      organizationIdByRecord: Object.fromEntries(interactions.map((interaction) => [interaction.id, interaction.organizationId])),
      tenantFallbacks: [auth.tenantId].filter((value): value is string => !!value),
    }),
  ])

  const userMap = new Map(
    users.map((user) => [
      user.id,
      {
        name: user.name ?? null,
        email: user.email ?? null,
      },
    ]),
  )
  const dealMap = new Map(deals.map((deal) => [deal.id, deal.title]))

  const baseItems: InteractionRecord[] = interactions.map((interaction) => {
    const entityId = typeof interaction.entity === 'string' ? interaction.entity : interaction.entity.id
    return {
      id: interaction.id,
      entityId,
      dealId: interaction.dealId ?? null,
      interactionType: interaction.interactionType,
      title: interaction.title ?? null,
      body: interaction.body ?? null,
      status: interaction.status,
      scheduledAt: interaction.scheduledAt ? interaction.scheduledAt.toISOString() : null,
      occurredAt: interaction.occurredAt ? interaction.occurredAt.toISOString() : null,
      priority: interaction.priority ?? null,
      authorUserId: interaction.authorUserId ?? null,
      ownerUserId: interaction.ownerUserId ?? null,
      appearanceIcon: interaction.appearanceIcon ?? null,
      appearanceColor: interaction.appearanceColor ?? null,
      source: interaction.source ?? null,
      organizationId: interaction.organizationId,
      tenantId: interaction.tenantId,
      createdAt: interaction.createdAt.toISOString(),
      updatedAt: interaction.updatedAt.toISOString(),
      authorName: interaction.authorUserId ? userMap.get(interaction.authorUserId)?.name ?? null : null,
      authorEmail: interaction.authorUserId ? userMap.get(interaction.authorUserId)?.email ?? null : null,
      dealTitle: interaction.dealId ? dealMap.get(interaction.dealId) ?? null : null,
      customValues: customFieldValues[interaction.id] ?? null,
    }
  })

  if (!enrich) return baseItems

  const enricherContext = await buildCustomersInteractionEnricherContext(
    container,
    auth,
    selectedOrganizationId,
  )
  const enriched = await applyResponseEnrichers(baseItems, 'customers.interaction', enricherContext)
  return baseItems.map((item, index) => mergeAdditiveRecord(item, enriched.items[index]))
}
