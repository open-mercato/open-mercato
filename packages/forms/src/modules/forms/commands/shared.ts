import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  ensureOrganizationScope,
  ensureSameScope,
  ensureTenantScope,
} from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Form, FormVersion } from '../data/entities'
import type { FormsEventId } from '../events'
import { emitFormsEvent } from '../events'
import { formsEventPayloadSchemas } from '../events-payloads'

export { ensureOrganizationScope, ensureSameScope, ensureTenantScope }
export { extractUndoPayload }

/**
 * Cache tag prefixes — declared in the phase 1b spec § Caching. Mutations
 * should `cacheService.deleteByTags([...])` after every state change.
 */
export const FORMS_CACHE_TAGS = {
  formList: (organizationId: string) => `forms.form.list:${organizationId}`,
  form: (formId: string) => `forms.form:${formId}`,
  formVersion: (versionId: string) => `forms.form_version:${versionId}`,
} as const

export const FORM_RESOURCE_KIND = 'forms.form'
export const FORM_VERSION_RESOURCE_KIND = 'forms.form_version'

/**
 * Resolve the request-scoped EM (forks should be created at command boundary).
 */
export function resolveEntityManager(ctx: CommandRuntimeContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

/**
 * Lookup a single form by ID — scoped to (tenantId, organizationId). Throws
 * 404 with `forms.errors.form_not_found` on miss to keep tenant isolation
 * (prevents probe-by-ID enumeration across orgs).
 */
export async function findFormInScope(
  em: EntityManager,
  id: string,
  tenantId: string,
  organizationId: string,
): Promise<Form> {
  const form = await em.findOne(Form, {
    id,
    tenantId,
    organizationId,
    deletedAt: null,
  })
  if (!form) {
    throw new CrudHttpError(404, { error: 'forms.errors.form_not_found' })
  }
  return form
}

/**
 * Lookup a single form version by ID — scoped to (tenantId, organizationId).
 */
export async function findFormVersionInScope(
  em: EntityManager,
  id: string,
  tenantId: string,
  organizationId: string,
): Promise<FormVersion> {
  const version = await em.findOne(FormVersion, {
    id,
    tenantId,
    organizationId,
  })
  if (!version) {
    throw new CrudHttpError(404, { error: 'forms.errors.version_not_found' })
  }
  return version
}

/**
 * Validate-and-emit shorthand. Every emit goes through the catalogued payload
 * schema before reaching the event bus so we keep the cross-module contract
 * tight (matches the SubmissionService convention from phase 1c's DI).
 */
export async function emitForms<TId extends FormsEventId>(
  eventId: TId,
  payload: unknown,
): Promise<void> {
  const schema =
    formsEventPayloadSchemas[eventId as keyof typeof formsEventPayloadSchemas]
  const validated = schema ? schema.parse(payload) : payload
  await emitFormsEvent(eventId, validated as never)
}

/**
 * Fire-and-best-effort cache invalidation. Cache failures should never block
 * a successful mutation, so any error is logged and swallowed.
 */
export async function invalidateFormsCacheTags(
  ctx: CommandRuntimeContext,
  tags: string[],
): Promise<void> {
  if (!tags.length) return
  try {
    const cacheService = ctx.container.resolve<{
      deleteByTags(tags: string[]): Promise<number>
    }>('cacheService')
    if (!cacheService || typeof cacheService.deleteByTags !== 'function') return
    await cacheService.deleteByTags(tags)
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[forms.commands.shared] cache invalidation failed', {
        tags,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * Resolve actor user ID from the runtime context. UUID-shaped subjects are
 * preserved as-is; anything else (e.g., API-key IDs) returns `null` so the
 * command writes a NULL `published_by`/`created_by` instead of a non-UUID.
 */
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/

export function resolveActorUserId(ctx: CommandRuntimeContext): string | null {
  const auth = ctx.auth
  if (!auth) return null
  if (auth.isApiKey) return null
  const sub = typeof auth.sub === 'string' ? auth.sub.trim() : ''
  if (!sub || !UUID_REGEX.test(sub)) return null
  return sub
}

/**
 * Snapshot serializers — kept outside `commands/form.ts` and
 * `commands/form-version.ts` so the undo-payload shape is documented in
 * a single place.
 */

export type FormSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  key: string
  name: string
  description: string | null
  status: 'draft' | 'active' | 'archived'
  currentPublishedVersionId: string | null
  defaultLocale: string
  supportedLocales: string[]
  createdBy: string
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export function serializeFormSnapshot(form: Form): FormSnapshot {
  return {
    id: form.id,
    organizationId: form.organizationId,
    tenantId: form.tenantId,
    key: form.key,
    name: form.name,
    description: form.description ?? null,
    status: form.status,
    currentPublishedVersionId: form.currentPublishedVersionId ?? null,
    defaultLocale: form.defaultLocale,
    supportedLocales: [...form.supportedLocales],
    createdBy: form.createdBy,
    archivedAt: form.archivedAt ? form.archivedAt.toISOString() : null,
    createdAt: form.createdAt.toISOString(),
    updatedAt: form.updatedAt.toISOString(),
  }
}

export type FormVersionSnapshot = {
  id: string
  formId: string
  organizationId: string
  tenantId: string
  versionNumber: number
  status: 'draft' | 'published' | 'archived'
  schema: Record<string, unknown>
  uiSchema: Record<string, unknown>
  roles: string[]
  schemaHash: string
  registryVersion: string
  publishedAt: string | null
  publishedBy: string | null
  changelog: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export function serializeFormVersionSnapshot(version: FormVersion): FormVersionSnapshot {
  return {
    id: version.id,
    formId: version.formId,
    organizationId: version.organizationId,
    tenantId: version.tenantId,
    versionNumber: version.versionNumber,
    status: version.status,
    schema: cloneJson(version.schema),
    uiSchema: cloneJson(version.uiSchema),
    roles: [...version.roles],
    schemaHash: version.schemaHash,
    registryVersion: version.registryVersion,
    publishedAt: version.publishedAt ? version.publishedAt.toISOString() : null,
    publishedBy: version.publishedBy ?? null,
    changelog: version.changelog ?? null,
    archivedAt: version.archivedAt ? version.archivedAt.toISOString() : null,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
  }
}

function cloneJson(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {}
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}
