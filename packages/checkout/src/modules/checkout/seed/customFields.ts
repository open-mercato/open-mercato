import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomFieldEntityConfig } from '@open-mercato/core/modules/entities/data/entities'
import { ensureCustomFieldDefinitions } from '@open-mercato/core/modules/entities/lib/field-definitions'
import { CHECKOUT_ENTITY_IDS } from '../lib/constants'
import { CHECKOUT_LINK_CUSTOM_FIELDS, CHECKOUT_LINK_FIELDSETS } from '../lib/customFields'

type CheckoutCustomFieldScope = {
  tenantId: string
  organizationId: string
}

async function ensureFieldsetConfig(
  em: EntityManager,
  scope: CheckoutCustomFieldScope,
  entityId: string,
) {
  const now = new Date()
  let config = await em.findOne(CustomFieldEntityConfig, {
    entityId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (!config) {
    config = em.create(CustomFieldEntityConfig, {
      entityId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
  }

  const currentConfig =
    config.configJson && typeof config.configJson === 'object' && !Array.isArray(config.configJson)
      ? { ...(config.configJson as Record<string, unknown>) }
      : {}
  const existingFieldsets = Array.isArray(currentConfig.fieldsets)
    ? currentConfig.fieldsets
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    : []
  const mergedFieldsetsByCode = new Map<string, Record<string, unknown>>()

  for (const fieldset of existingFieldsets) {
    const code = typeof fieldset.code === 'string' ? fieldset.code.trim() : ''
    if (!code) continue
    mergedFieldsetsByCode.set(code, { ...fieldset })
  }

  for (const fieldset of CHECKOUT_LINK_FIELDSETS) {
    const existingFieldset = mergedFieldsetsByCode.get(fieldset.code) ?? {}
    mergedFieldsetsByCode.set(fieldset.code, {
      ...existingFieldset,
      ...fieldset,
      groups: Array.isArray(fieldset.groups)
        ? fieldset.groups.map((group) => ({ ...group }))
        : existingFieldset.groups,
    })
  }

  config.configJson = {
    ...currentConfig,
    fieldsets: Array.from(mergedFieldsetsByCode.values()),
    singleFieldsetPerRecord:
      typeof currentConfig.singleFieldsetPerRecord === 'boolean'
        ? currentConfig.singleFieldsetPerRecord
        : true,
  }
  config.isActive = true
  config.updatedAt = now
  em.persist(config)
}

export async function ensureCheckoutFieldsetsAndDefinitions(
  em: EntityManager,
  scope: CheckoutCustomFieldScope,
) {
  await ensureFieldsetConfig(em, scope, CHECKOUT_ENTITY_IDS.link)
  await ensureFieldsetConfig(em, scope, CHECKOUT_ENTITY_IDS.template)
  await ensureCustomFieldDefinitions(
    em,
    [
      { entity: CHECKOUT_ENTITY_IDS.link, fields: CHECKOUT_LINK_CUSTOM_FIELDS },
      { entity: CHECKOUT_ENTITY_IDS.template, fields: CHECKOUT_LINK_CUSTOM_FIELDS },
    ],
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    },
  )
  await em.flush()
}
