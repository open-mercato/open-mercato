/**
 * Shared helpers for customers AI tool packs.
 *
 * Mirrors the catalog precedent (`packages/core/src/modules/catalog/ai-tools/_shared.ts`):
 * the company and people packs previously carried byte-for-byte-identical copies
 * of the date-to-ISO helper, the `resolveEm` / `buildScope` accessors, the
 * list-row → summary mapper, and the related-records builder
 * (addresses / activities / notes / tasks / interactions / tags / deals, plus a
 * companies-only `people` mapper). Centralizing them here gives both packs one
 * source of truth so a change to the related-records output shape no longer has
 * to be applied — and kept in sync — in two places.
 *
 * This is a pure internal refactor: tool names, input schemas, `requiredFeatures`,
 * and emitted output shapes stay identical.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AiToolExecutionContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import type { CustomersToolContext } from './types'

export function toIso(value: unknown): string | null {
  if (!value) return null
  const dt = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(dt.getTime())) return null
  return dt.toISOString()
}

export function resolveEm(ctx: CustomersToolContext | AiToolExecutionContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

export function buildScope(ctx: CustomersToolContext | AiToolExecutionContext, tenantId: string) {
  return {
    tenantId,
    organizationId: ctx.organizationId,
  }
}

/* -------------------------------------------------------------------------- */
/*  List-row summary mapper                                                    */
/* -------------------------------------------------------------------------- */

export type CustomerListApiItemBase = {
  id?: string
  display_name?: string | null
  displayName?: string | null
  primary_email?: string | null
  primaryEmail?: string | null
  primary_phone?: string | null
  primaryPhone?: string | null
  status?: string | null
  lifecycle_stage?: string | null
  lifecycleStage?: string | null
  source?: string | null
  owner_user_id?: string | null
  ownerUserId?: string | null
  organization_id?: string | null
  organizationId?: string | null
  tenant_id?: string | null
  tenantId?: string | null
  created_at?: string | null
  createdAt?: string | null
}

export type CustomerListSummary = {
  id: string | undefined
  displayName: string | null
  primaryEmail: string | null
  primaryPhone: string | null
  status: string | null
  lifecycleStage: string | null
  source: string | null
  ownerUserId: string | null
  organizationId: string | null
  tenantId: string | null
  createdAt: string | null
}

export function toCustomerListSummary(row: CustomerListApiItemBase): CustomerListSummary {
  const createdAtRaw = row.created_at ?? row.createdAt ?? null
  const createdAt = createdAtRaw ? new Date(String(createdAtRaw)).toISOString() : null
  return {
    id: row.id,
    displayName: row.display_name ?? row.displayName ?? null,
    primaryEmail: row.primary_email ?? row.primaryEmail ?? null,
    primaryPhone: row.primary_phone ?? row.primaryPhone ?? null,
    status: row.status ?? null,
    lifecycleStage: row.lifecycle_stage ?? row.lifecycleStage ?? null,
    source: row.source ?? null,
    ownerUserId: row.owner_user_id ?? row.ownerUserId ?? null,
    organizationId: row.organization_id ?? row.organizationId ?? null,
    tenantId: row.tenant_id ?? row.tenantId ?? null,
    createdAt,
  }
}

/* -------------------------------------------------------------------------- */
/*  Related-records mappers                                                    */
/* -------------------------------------------------------------------------- */

function asRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []
}

export function mapAddresses(rows: Array<Record<string, unknown>>) {
  return rows.map((address) => ({
    id: address.id,
    name: address.name ?? null,
    purpose: address.purpose ?? null,
    addressLine1: address.addressLine1 ?? null,
    addressLine2: address.addressLine2 ?? null,
    city: address.city ?? null,
    region: address.region ?? null,
    postalCode: address.postalCode ?? null,
    country: address.country ?? null,
    isPrimary: !!address.isPrimary,
  }))
}

export function mapActivities(rows: Array<Record<string, unknown>>) {
  return rows.map((activity) => ({
    id: activity.id,
    activityType: activity.activityType,
    subject: activity.subject ?? null,
    body: activity.body ?? null,
    occurredAt: toIso(activity.occurredAt),
    createdAt: toIso(activity.createdAt),
  }))
}

export function mapNotes(rows: Array<Record<string, unknown>>) {
  return rows.map((comment) => ({
    id: comment.id,
    body: comment.body,
    authorUserId: comment.authorUserId ?? null,
    createdAt: toIso(comment.createdAt),
  }))
}

export function mapTasks(rows: Array<Record<string, unknown>>) {
  return rows.map((task) => ({
    id: task.id,
    todoId: task.todoId ?? task.id,
    todoSource: task.todoSource ?? null,
    createdAt: toIso(task.createdAt),
  }))
}

export function mapInteractions(rows: Array<Record<string, unknown>>) {
  return rows.map((interaction) => ({
    id: interaction.id,
    interactionType: interaction.interactionType,
    title: interaction.title ?? null,
    status: interaction.status,
    scheduledAt: toIso(interaction.scheduledAt),
    occurredAt: toIso(interaction.occurredAt),
  }))
}

export type RelatedTag = { id: string; slug: string; label: string; color: string | null }

export function mapTags(rows: Array<Record<string, unknown>>): RelatedTag[] {
  return rows
    .map((tag) => {
      if (!tag || typeof tag !== 'object') return null
      const id = typeof tag.id === 'string' ? tag.id : null
      const label = typeof tag.label === 'string' ? tag.label : null
      if (!id || !label) return null
      const slug = typeof tag.slug === 'string' ? tag.slug : label
      const color = typeof tag.color === 'string' ? tag.color : null
      return { id, slug, label, color }
    })
    .filter((entry): entry is RelatedTag => entry !== null)
}

export type RelatedDeal = {
  id: string
  title: string
  status: string | null
  pipelineStageId: string | null
  valueAmount: string | null
  valueCurrency: string | null
}

export function mapDeals(rows: Array<Record<string, unknown>>): RelatedDeal[] {
  return rows
    .map((deal) => {
      if (!deal || typeof deal !== 'object') return null
      const id = typeof deal.id === 'string' ? deal.id : null
      if (!id) return null
      return {
        id,
        title: typeof deal.title === 'string' ? deal.title : '',
        status: typeof deal.status === 'string' ? deal.status : null,
        pipelineStageId: typeof deal.pipelineStageId === 'string' ? deal.pipelineStageId : null,
        valueAmount:
          typeof deal.valueAmount === 'string'
            ? deal.valueAmount
            : deal.valueAmount === null || deal.valueAmount === undefined
              ? null
              : String(deal.valueAmount),
        valueCurrency: typeof deal.valueCurrency === 'string' ? deal.valueCurrency : null,
      }
    })
    .filter((value): value is RelatedDeal => value !== null)
}

export type RelatedPerson = {
  id: string
  displayName: string
  primaryEmail: string | null
  primaryPhone: string | null
  jobTitle: string | null
  department: string | null
}

export function mapPeople(rows: Array<Record<string, unknown>>): RelatedPerson[] {
  return rows
    .map((person) => {
      if (!person || typeof person !== 'object') return null
      const id = typeof person.id === 'string' ? person.id : null
      const displayName = typeof person.displayName === 'string' ? person.displayName : null
      if (!id || !displayName) return null
      return {
        id,
        displayName,
        primaryEmail: typeof person.primaryEmail === 'string' ? person.primaryEmail : null,
        primaryPhone: typeof person.primaryPhone === 'string' ? person.primaryPhone : null,
        jobTitle: typeof person.jobTitle === 'string' ? person.jobTitle : null,
        department: typeof person.department === 'string' ? person.department : null,
      }
    })
    .filter((value): value is RelatedPerson => value !== null)
}

export type CustomerRelatedRecords = {
  addresses: ReturnType<typeof mapAddresses>
  activities: ReturnType<typeof mapActivities>
  notes: ReturnType<typeof mapNotes>
  tasks: ReturnType<typeof mapTasks>
  interactions: ReturnType<typeof mapInteractions>
  tags: RelatedTag[]
  deals: RelatedDeal[]
  people?: RelatedPerson[]
}

/**
 * Builds the related-records block from a customers detail API payload
 * (`addresses`, `activities`, `comments`, `todos`, `interactions`, `tags`,
 * `deals`, and — for companies — `people`). The key order matches the
 * pre-refactor literals so the emitted shape is unchanged. Pass
 * `includePeople: true` to add the companies-only `people` collection.
 */
export function buildRelatedRecords(
  data: Record<string, unknown>,
  options: { includePeople?: boolean } = {},
): CustomerRelatedRecords {
  const related: CustomerRelatedRecords = {
    addresses: mapAddresses(asRows(data.addresses)),
    activities: mapActivities(asRows(data.activities)),
    notes: mapNotes(asRows(data.comments)),
    tasks: mapTasks(asRows(data.todos)),
    interactions: mapInteractions(asRows(data.interactions)),
    tags: mapTags(asRows(data.tags)),
    deals: mapDeals(asRows(data.deals)),
  }
  if (options.includePeople) {
    related.people = mapPeople(asRows(data.people))
  }
  return related
}
