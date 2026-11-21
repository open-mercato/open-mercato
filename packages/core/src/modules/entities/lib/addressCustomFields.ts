import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { validateValuesAgainstDefs } from '@open-mercato/shared/modules/entities/validation'
import { CustomFieldDef } from '../data/entities'
import {
  acceptsAddressCustomFieldValue,
  CUSTOMER_ADDRESS_FIELD_HOST,
  isSupportedAddressCustomField,
  SALES_ADDRESS_FIELD_HOST,
} from './addressCustomFieldPolicy'
import { createVisibleDefinitionScopeClause } from './definition-scope-where'
import { selectVisibleDefinitionWinner } from './definition-scope'
import { sanitizeCustomFieldHtmlRichTextValuesServer } from './htmlRichTextSanitizer'
import { addressCustomValuesSchema } from './addressCustomValuesSchema'

export { addressCustomValuesSchema } from './addressCustomValuesSchema'

type AddressValues = Record<string, unknown>
type AddressScope = { tenantId: string; organizationId: string }
type ScopedAddressHost = AddressScope & { entityId: string }

export function readAddressCustomValues(value: unknown): AddressValues | null {
  if (value == null) return null
  const parsed = addressCustomValuesSchema.safeParse(value)
  if (!parsed.success) {
    throw new CrudHttpError(503, { code: 'address_custom_values_unavailable' })
  }
  return parsed.data
}

export async function loadAddressCustomFieldDefinitions(
  em: EntityManager,
  scope: ScopedAddressHost,
): Promise<Map<string, CustomFieldDef>> {
  const definitions = await em.find(CustomFieldDef, {
    entityId: scope.entityId,
    ...createVisibleDefinitionScopeClause(scope),
  })
  const grouped = new Map<string, CustomFieldDef[]>()
  for (const definition of definitions) {
    const existing = grouped.get(definition.key)
    if (existing) existing.push(definition)
    else grouped.set(definition.key, [definition])
  }
  const winners = new Map<string, CustomFieldDef>()
  for (const [key, candidates] of grouped) {
    const definition = selectVisibleDefinitionWinner(candidates)
    if (definition?.isActive && !definition.deletedAt && isSupportedAddressCustomField(key, definition.kind)) {
      winners.set(key, definition)
    }
  }
  return winners
}

export function filterAddressCustomValues(value: unknown, definitions: ReadonlyMap<string, unknown>): AddressValues | null {
  const stored = readAddressCustomValues(value)
  if (!stored) return null
  const visible = Object.entries(stored).filter(([key]) => definitions.has(key))
  return visible.length ? Object.fromEntries(visible) : null
}

export async function applyAddressCustomValues(
  em: EntityManager,
  input: ScopedAddressHost & {
    previous: AddressValues | null | undefined
    patch: AddressValues | undefined
    definitions?: ReadonlyMap<string, CustomFieldDef>
  },
): Promise<AddressValues | null> {
  if (input.patch === undefined) return input.previous ?? null
  const definitions = input.definitions ?? await loadAddressCustomFieldDefinitions(em, input)
  const { translate } = await resolveTranslations()
  const invalid = translate('entities.customFields.address.invalidValue', 'Enter a valid address field value.')
  const fieldErrors: Record<string, string> = {}
  const next = { ...input.previous }
  for (const [key, value] of Object.entries(input.patch)) {
    const definition = definitions.get(key)
    if (!definition || definition.configJson?.formEditable === false || !acceptsAddressCustomFieldValue(definition.kind, definition.configJson ?? {}, value)) {
      fieldErrors[`cf_${key}`] = invalid
    } else if (value === null) {
      delete next[key]
    } else {
      next[key] = value
    }
  }
  const activeDefinitions = Array.from(definitions.values()).filter((definition) => definition.configJson?.formEditable !== false)
  const activeValues = Object.fromEntries(activeDefinitions.map(({ key }) => [key, next[key]]))
  const validation = validateValuesAgainstDefs(activeValues, activeDefinitions, { rejectUndeclaredKeys: true })
  Object.assign(fieldErrors, validation.fieldErrors)
  for (const definition of activeDefinitions) {
    const value = activeValues[definition.key]
    if (definition.configJson?.required === true && (value == null || value === '' || (Array.isArray(value) && value.length === 0))) {
      fieldErrors[`cf_${definition.key}`] ??= invalid
    }
  }
  if (Object.keys(fieldErrors).length || !addressCustomValuesSchema.safeParse(next).success) {
    throw new CrudHttpError(400, { error: invalid, fieldErrors })
  }
  if (!Object.keys(next).length) return null
  return sanitizeCustomFieldHtmlRichTextValuesServer(em, { ...input, values: next })
}

export async function copyAddressCustomValues(
  em: EntityManager,
  scope: AddressScope & {
    sourceValues: AddressValues | null | undefined
    targetDefinitions?: ReadonlyMap<string, CustomFieldDef>
  },
): Promise<AddressValues | null> {
  if (!scope.sourceValues) return null
  const [source, target] = await Promise.all([
    loadAddressCustomFieldDefinitions(em, { ...scope, entityId: CUSTOMER_ADDRESS_FIELD_HOST }),
    scope.targetDefinitions ?? loadAddressCustomFieldDefinitions(em, { ...scope, entityId: SALES_ADDRESS_FIELD_HOST }),
  ])
  const matching = Object.entries(scope.sourceValues).filter(([key, value]) => {
    const sourceDefinition = source.get(key)
    const targetDefinition = target.get(key)
    if (!sourceDefinition || !targetDefinition || sourceDefinition.kind !== targetDefinition.kind) return false
    if (sourceDefinition.configJson?.formEditable === false || targetDefinition.configJson?.formEditable === false) return false
    if (sourceDefinition.configJson?.optionsUrl !== targetDefinition.configJson?.optionsUrl) return false
    if (sourceDefinition.configJson?.dictionaryId !== targetDefinition.configJson?.dictionaryId) return false
    if (sourceDefinition.configJson?.relatedEntityId !== targetDefinition.configJson?.relatedEntityId) return false
    return acceptsAddressCustomFieldValue(targetDefinition.kind, targetDefinition.configJson ?? {}, value)
      && validateValuesAgainstDefs({ [key]: value }, [targetDefinition]).ok
  })
  return matching.length ? Object.fromEntries(matching) : null
}

export async function sealAddressCustomValues(
  container: Pick<AwilixContainer, 'resolve'>,
  input: ScopedAddressHost & {
    column: 'customValues' | 'addressCustomValues'
    values: AddressValues | null
    em?: EntityManager
  },
): Promise<AddressValues | string | null> {
  if (input.values === null || !isTenantDataEncryptionEnabled()) return input.values
  const service = container.resolve<TenantDataEncryptionService>('tenantEncryptionService')
  const payload = await service.encryptEntityPayload(
    input.entityId, { [input.column]: input.values }, input.tenantId, input.organizationId, { em: input.em },
  )
  const encrypted = payload[input.column]
  if (!isEncryptedPayloadShape(encrypted)) {
    throw new CrudHttpError(503, { code: 'address_custom_values_unavailable' })
  }
  return encrypted
}
