import { sql, type Kysely } from 'kysely'
import { z } from 'zod'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { assertEntityAclForRequest } from '@open-mercato/core/modules/entities/lib/entityAcl'
import { classifyRecordsEntity } from '@open-mercato/core/modules/entities/lib/entityClassification'
import { requireTranslationFeatures, type TranslationsRouteContext } from '@open-mercato/core/modules/translations/api/context'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  getTranslatableFieldExpander,
  getTranslatableFields,
} from '@open-mercato/shared/lib/localization/translatable-fields'
import { getRegisteredTextFields, resolveTranslationOwnerMetadata } from './registered-fields'

const FIELD_DEFINITION_TYPE = 'entities:custom_field_def'
const STAFF_PROJECT_TYPE = 'staff:staff_time_project'
const STAFF_TASK_STATUS_TYPE = 'staff:staff_time_task_status'
const uuidSchema = z.guid()

const translationTargetFeatures: Record<string, Record<'view' | 'manage', string>> = {
  'catalog:catalog_product_variant': { view: 'catalog.products.view', manage: 'catalog.variants.manage' },
  'catalog:catalog_offer': { view: 'sales.channels.manage', manage: 'sales.channels.manage' },
  'catalog:catalog_option_schema_template': { view: 'catalog.products.view', manage: 'catalog.settings.manage' },
  'catalog:catalog_product_tag': { view: 'catalog.products.view', manage: 'catalog.products.manage' },
  'checkout:checkout_link': { view: 'checkout.view', manage: 'checkout.edit' },
  'checkout:checkout_link_template': { view: 'checkout.view', manage: 'checkout.edit' },
  'customer_accounts:customer_role': { view: 'customer_accounts.view', manage: 'customer_accounts.roles.manage' },
  'customers:customer_dictionary_entry': { view: 'customers.settings.manage', manage: 'customers.settings.manage' },
  'dictionaries:dictionary_entry': { view: 'dictionaries.view', manage: 'dictionaries.manage' },
  'entities:custom_field_def': { view: 'entities.definitions.manage', manage: 'entities.definitions.manage' },
  'example:todo': { view: 'example.todos.view', manage: 'example.todos.manage' },
  'forms:form': { view: 'forms.view', manage: 'forms.design' },
  'forms:form_version': { view: 'forms.view', manage: 'forms.design' },
  'resources:resources_resource': { view: 'resources.view', manage: 'resources.manage_resources' },
  'resources:resources_resource_type': { view: 'resources.view', manage: 'resources.manage_resources' },
  'staff:staff_team_member': { view: 'staff.view', manage: 'staff.manage_team' },
  'staff:staff_time_project': { view: 'staff.timesheets.projects.view', manage: 'staff.timesheets.projects.manage' },
  'staff:staff_time_task_status': { view: 'staff.timesheets.tasks.view', manage: 'staff.timesheets.projects.manage' },
  'staff:staff_time_tag': { view: 'staff.timesheets.view', manage: 'staff.timesheets.tasks.manage' },
  'wms:warehouse': { view: 'wms.view', manage: 'wms.manage_warehouses' },
  'wms:warehouse_zone': { view: 'wms.view', manage: 'wms.manage_zones' },
}

type TranslationTargetDb = Kysely<Record<string, Record<string, unknown>>>

async function invalidTranslationTarget(code: string): Promise<CrudHttpError> {
  const { translate } = await resolveTranslations()
  return new CrudHttpError(400, { error: translate('api.errors.invalidPayload', 'Invalid payload.'), code })
}

async function translationTargetNotFound(): Promise<CrudHttpError> {
  const { translate } = await resolveTranslations()
  return new CrudHttpError(404, { error: translate('api.errors.notFound', 'Not found') })
}

async function findVisibleFieldDefinition(db: TranslationTargetDb, entityId: string, context: TranslationsRouteContext) {
  const separator = entityId.lastIndexOf(':')
  const definitions = await db.selectFrom('custom_field_defs')
    .select(['is_active', 'deleted_at', 'config_json'])
    .where('entity_id', '=', entityId.slice(0, separator))
    .where('key', '=', entityId.slice(separator + 1))
    .where((expression) => expression.or([
      expression('tenant_id', '=', context.tenantId),
      expression('tenant_id', 'is', null),
    ]))
    .where((expression) => expression.or([
      expression('organization_id', '=', context.organizationId),
      expression('organization_id', 'is', null),
    ]))
    .orderBy(sql<boolean>`tenant_id is null`, 'asc')
    .orderBy(sql<boolean>`organization_id is null`, 'asc')
    .orderBy('updated_at', 'desc')
    .execute()
  if (definitions.some((definition) => definition.deleted_at !== null)) return undefined
  return definitions.find((definition) => definition.is_active === true)
}

async function assertProjectTranslationVisibility(
  context: TranslationsRouteContext,
  rbac: RbacService,
  projectId: unknown,
): Promise<void> {
  if (typeof projectId !== 'string' || !context.organizationId) throw await translationTargetNotFound()

  const { MANAGE_PROJECTS_FEATURE, resolveProjectAccess } = await import('@open-mercato/core/modules/staff/lib/time-tracking/access')
  const { resolveAssignmentGraceDaysFromContainer } = await import('@open-mercato/core/modules/staff/lib/time-tracking/projectAssignment')
  const { tenantId, organizationId } = context
  const userId = context.auth.sub
  const canManageAll = await rbac.userHasAllFeatures(userId, [MANAGE_PROJECTS_FEATURE], { tenantId, organizationId })
  if (canManageAll) return

  const access = await resolveProjectAccess({
    em: context.em,
    userId,
    tenantId,
    organizationId,
    canManageAll,
    assignmentGraceDays: await resolveAssignmentGraceDaysFromContainer(context.container, tenantId),
  })
  if (!access.projectIds.includes(projectId)) throw await translationTargetNotFound()
}

export async function resolveTranslationTargetFields(
  context: TranslationsRouteContext,
  entityType: string,
  entityId: string,
  action: 'view' | 'manage',
): Promise<ReadonlySet<string>> {
  const registeredFields = getTranslatableFields(entityType)
  if (!registeredFields) throw await invalidTranslationTarget('unregistered_translation_entity')

  const { tenantId, organizationId } = context
  const classification = await classifyRecordsEntity(context.em, entityType, { tenantId, organizationId })
  if (classification.kind === 'unknown') throw await invalidTranslationTarget('unregistered_translation_entity')
  const isCustomEntity = classification.kind === 'custom'
  if (isCustomEntity) {
    await requireTranslationFeatures(context, [`entities.records.${action}`])
  }
  const rbac = context.container.resolve<RbacService>('rbacService')
  const targetFeature = translationTargetFeatures[entityType]?.[action]
  if (!isCustomEntity && targetFeature) {
    await requireTranslationFeatures(context, [targetFeature])
  } else {
    await assertEntityAclForRequest({
      auth: { ...context.auth, tenantId, orgId: organizationId },
      entityId: entityType,
      action,
      isCustomEntity,
      isRestricted: classification.restricted,
      rbac,
    })
  }

  const db: TranslationTargetDb = context.db
  const expander = getTranslatableFieldExpander(entityType)
  if (isCustomEntity) {
    const record = await db.selectFrom('custom_entities_storage')
      .select(expander ? 'doc' : 'entity_id')
      .where('entity_type', '=', entityType)
      .where('entity_id', '=', entityId)
      .where('tenant_id', '=', tenantId)
      .where(sql<boolean>`organization_id is not distinct from ${organizationId}`)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
    if (!record) throw await translationTargetNotFound()
    return getRegisteredTextFields(entityType, undefined, asRecord(record.doc))
  }

  if (entityType === FIELD_DEFINITION_TYPE && entityId.includes(':')) {
    const definition = await findVisibleFieldDefinition(db, entityId, context)
    if (!definition) throw await translationTargetNotFound()
    return getRegisteredTextFields(entityType, undefined, definition)
  }

  const owner = resolveTranslationOwnerMetadata(context.em, entityType)
  if (!owner) throw await translationTargetNotFound()
  const { metadata, source } = owner
  const primaryKey = metadata.primaryKeys.length === 1 ? metadata.properties[metadata.primaryKeys[0]] : undefined
  if (primaryKey?.fieldNames.length !== 1) throw await translationTargetNotFound()
  if (primaryKey.type === 'uuid' && !uuidSchema.safeParse(entityId).success) throw await translationTargetNotFound()

  const idColumn = primaryKey.fieldNames[0]
  const projectColumn = action === 'view' && entityType === STAFF_TASK_STATUS_TYPE
    ? metadata.properties.timeProjectId?.fieldNames[0]
    : undefined
  if (!source.tenantColumn && !source.organizationColumn) throw await translationTargetNotFound()
  let query = db.selectFrom(source.table).where(idColumn, '=', entityId)
  if (source.tenantColumn) query = query.where(source.tenantColumn, '=', tenantId)
  if (source.organizationColumn) {
    query = query.where(sql<boolean>`${sql.ref(source.organizationColumn)} is not distinct from ${organizationId}`)
  }
  const deletedAtColumn = metadata.properties.deletedAt?.fieldNames[0]
  if (deletedAtColumn) query = query.where(deletedAtColumn, 'is', null)

  const record = expander
    ? await query.selectAll().executeTakeFirst()
    : await query.select(projectColumn ? [idColumn, projectColumn] : [idColumn]).executeTakeFirst()
  if (!record) throw await translationTargetNotFound()
  if (action === 'view' && (entityType === STAFF_PROJECT_TYPE || entityType === STAFF_TASK_STATUS_TYPE)) {
    await assertProjectTranslationVisibility(
      context, rbac, entityType === STAFF_PROJECT_TYPE ? entityId : projectColumn && record[projectColumn],
    )
  }
  return getRegisteredTextFields(entityType, metadata, record)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return undefined
}

export function filterTargetTranslations(
  translations: unknown,
  allowedFields: ReadonlySet<string>,
): Record<string, Record<string, string | null>> {
  return Object.fromEntries(Object.entries(asRecord(translations) ?? {}).flatMap(([locale, translation]) => {
    const fields = asRecord(translation)
    if (!fields) return []
    const values = Object.entries(fields).flatMap(([field, value]) =>
      allowedFields.has(field) && (typeof value === 'string' || value === null) ? [[field, value] as const] : [],
    )
    return values.length > 0 || Object.keys(fields).length === 0
      ? [[locale, Object.fromEntries(values)] as const]
      : []
  }))
}

export async function assertTranslationFields(
  translations: Record<string, Record<string, string | null>>,
  allowedFields: ReadonlySet<string>,
): Promise<void> {
  for (const localizedFields of Object.values(translations)) {
    if (Object.keys(localizedFields).some((field) => !allowedFields.has(field))) {
      throw await invalidTranslationTarget('unregistered_translation_field')
    }
  }
}
