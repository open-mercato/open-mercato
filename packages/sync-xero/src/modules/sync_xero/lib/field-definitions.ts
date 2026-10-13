import type { EntityManager } from '@mikro-orm/postgresql'
import { invalidateDefinitionsCache } from '@open-mercato/core/modules/entities/api/definitions.cache'
import {
  ensureCustomFieldDefinitions,
  type EnsureFieldDefinitionsResult,
} from '@open-mercato/core/modules/entities/lib/field-definitions'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { CustomFieldDefinition } from '@open-mercato/shared/modules/entities'
import { XERO_INTEGRATION_ID } from './constants'
import type { XeroScope } from './owner'

/** The literal id App Spec § 10 #5 names: a package cannot import the app's generated entity ids. */
export const XERO_COMPANY_FIELDS_ENTITY_ID = 'customers:customer_company_profile'
export const XERO_CONTACT_MARKER_FIELD = 'xero_contact_id'
export const XERO_TAX_NUMBER_FIELD = 'xero_tax_number'
export const XERO_MERGED_INTO_FIELD = 'xero_merged_into'

/** Field definitions take no i18n keys, so the labels are plain strings. */
export const XERO_COMPANY_FIELD_DEFINITIONS: CustomFieldDefinition[] = [
  {
    key: XERO_CONTACT_MARKER_FIELD,
    kind: 'text',
    label: 'Xero contact',
    description: 'The Xero Organisation and Contact this Company is synced from. Set by the Xero integration.',
    formEditable: false,
    filterable: false,
    listVisible: false,
  },
  {
    key: XERO_TAX_NUMBER_FIELD,
    kind: 'text',
    label: 'Tax number (Xero)',
    description: 'The Contact\'s tax number in Xero. Fill it in before the first sync so the sync matches this Company.',
    encrypted: true,
    formEditable: true,
    filterable: false,
  },
  {
    key: XERO_MERGED_INTO_FIELD,
    kind: 'text',
    label: 'Merged into Xero contact',
    description: 'The Xero Contact this one was merged into. Set by the Xero integration.',
    formEditable: false,
    filterable: true,
  },
]

type DefinitionsCache = Parameters<typeof invalidateDefinitionsCache>[0]

export type EnsureXeroFieldDefinitionsInput = {
  em: EntityManager
  cache: DefinitionsCache
  scope: XeroScope
}

/** Creates or repairs the three Company fields of an organization; the form cache drops only when one changed. */
export async function ensureXeroFieldDefinitions(input: EnsureXeroFieldDefinitionsInput): Promise<EnsureFieldDefinitionsResult> {
  const result = await ensureCustomFieldDefinitions(
    input.em,
    [{ entity: XERO_COMPANY_FIELDS_ENTITY_ID, fields: XERO_COMPANY_FIELD_DEFINITIONS, source: XERO_INTEGRATION_ID }],
    { organizationId: input.scope.organizationId, tenantId: input.scope.tenantId },
  )
  if (result.created > 0 || result.updated > 0) {
    await invalidateDefinitionsCache(input.cache, {
      organizationId: input.scope.organizationId,
      tenantId: input.scope.tenantId,
      entityIds: [XERO_COMPANY_FIELDS_ENTITY_ID],
    })
  }
  return result
}

function resolveDefinitionsCache(container: AppContainer): DefinitionsCache {
  try {
    return container.resolve<DefinitionsCache>('cache')
  } catch {
    return undefined
  }
}

/** The Organisation-save paths call this: a failure is reported and never undoes the save. */
export async function ensureXeroFieldDefinitionsAfterSave(container: AppContainer, scope: XeroScope): Promise<boolean> {
  try {
    await ensureXeroFieldDefinitions({
      em: container.resolve<EntityManager>('em').fork(),
      cache: resolveDefinitionsCache(container),
      scope,
    })
    return true
  } catch (error) {
    getTelemetryRuntime()?.reportError(error, { module: 'sync_xero', code: 'sync_xero.field_definitions_failed' })
    return false
  }
}
