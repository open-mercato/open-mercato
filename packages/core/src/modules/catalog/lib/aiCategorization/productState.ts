import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { loadCustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import { E } from '#generated/entities.ids.generated'
import { CatalogProduct, CatalogProductTagAssignment } from '../../data/entities'

const DESCRIPTION_MAX_CHARS = 4000
const CUSTOM_FIELD_VALUE_MAX_CHARS = 500
const MAX_CUSTOM_FIELDS = 50

export type CatalogProductOptionState = {
  name: string
  values: string[]
}

/**
 * D6 model input, with D9 exclusions already applied: custom fields whose
 * definition has `configJson.encrypted: true`, and product columns listed in
 * the tenant's EncryptionMap for `catalog:catalog_product`. Trimmed per the
 * spec's limits so a single product never blows the port's payload budget.
 */
export type CatalogProductState = {
  title: string
  subtitle: string | null
  description: string | null
  sku: string | null
  productType: string
  tags: string[]
  options: CatalogProductOptionState[]
  custom: Record<string, unknown>
}

export type BuildProductStateInput = {
  productId: string
  tenantId: string
  organizationId: string
}

function trimText(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

/**
 * Loads the product (through `findWithDecryption`) and builds the trimmed,
 * privacy-filtered state sent to the decision model. Returns `null` when the
 * product does not exist (or is soft-deleted / out of scope).
 */
export async function buildProductState(
  em: EntityManager,
  input: BuildProductStateInput,
): Promise<CatalogProductState | null> {
  const product = await findOneWithDecryption(
    em,
    CatalogProduct,
    { id: input.productId, organizationId: input.organizationId, tenantId: input.tenantId, deletedAt: null },
    { populate: ['optionSchemaTemplate'] },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
  if (!product) return null

  const tagAssignments = await findWithDecryption(
    em,
    CatalogProductTagAssignment,
    { product: product.id },
    { populate: ['tag'] },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
  const tags = tagAssignments
    .map((assignment) => (typeof assignment.tag === 'string' ? null : assignment.tag?.label ?? null))
    .filter((label): label is string => typeof label === 'string' && label.trim().length > 0)

  const optionSchemaTemplate = product.optionSchemaTemplate
  const schema = typeof optionSchemaTemplate === 'string' ? null : (optionSchemaTemplate?.schema ?? null)
  const options: CatalogProductOptionState[] = Array.isArray(schema?.options)
    ? schema!.options.map((option) => ({
        name: (option.label && option.label.trim()) || option.code,
        values: (option.choices ?? [])
          .map((choice) => (choice.label && choice.label.trim()) || choice.code)
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
      }))
    : []

  const encryptionService = resolveTenantEncryptionService(em)
  const encryptedColumns = new Set(
    encryptionService
      ? await encryptionService.getEncryptedFieldNames(
          E.catalog.catalog_product,
          input.tenantId,
          input.organizationId,
          { ignoreRuntimeHealth: true, em },
        )
      : [],
  )

  const rawCustom = await loadCustomFieldSnapshot(em, {
    entityId: E.catalog.catalog_product,
    recordId: product.id,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  })

  const customFieldDefs = await em.find(CustomFieldDef, {
    entityId: E.catalog.catalog_product,
    $or: [{ tenantId: input.tenantId }, { tenantId: null }],
  })
  const encryptedCustomFieldKeys = new Set(
    customFieldDefs
      .filter((def) => Boolean((def.configJson as { encrypted?: boolean } | null | undefined)?.encrypted))
      .map((def) => def.key),
  )

  const custom: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(rawCustom)) {
    if (Object.keys(custom).length >= MAX_CUSTOM_FIELDS) break
    if (encryptedCustomFieldKeys.has(key)) continue
    if (value === null || value === undefined) continue
    custom[key] = typeof value === 'string' ? trimText(value, CUSTOM_FIELD_VALUE_MAX_CHARS) : value
  }

  return {
    title: encryptedColumns.has('title') ? '' : product.title,
    subtitle: encryptedColumns.has('subtitle') ? null : (product.subtitle ?? null),
    description: encryptedColumns.has('description') ? null : trimText(product.description, DESCRIPTION_MAX_CHARS),
    sku: encryptedColumns.has('sku') ? null : (product.sku ?? null),
    productType: product.productType,
    tags,
    options,
    custom,
  }
}
