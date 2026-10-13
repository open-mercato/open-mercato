import type {
  DataMapping,
  DataSyncAdapter,
  ImportBatch,
  ImportItem,
  StreamImportInput,
} from '@open-mercato/core/modules/data_sync/lib/adapter'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationOAuthGrantService } from '@open-mercato/core/modules/integrations/lib/oauth/grant-service'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createXeroApiClient } from '../api-client'
import { XERO_CONTACTS_ENTITY_TYPE, XERO_PROVIDER_KEY } from '../constants'
import { advanceXeroCursor, completeXeroFullPass, parseXeroCursor, planXeroWalk, serializeXeroCursor } from '../cursor'
import { createXeroDescriptor } from '../descriptor'
import { resolveXeroEndpoints } from '../endpoints'
import { formatContactExternalId } from '../external-ids'
import { walkXeroContacts, type XeroContactRecord } from '../keyset'
import { buildXeroGrantOwner } from '../owner'
import { parseXeroProviderData } from '../provider-data'

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))
  return chunks
}

function toSkipItem(xeroOrganisationId: string, record: XeroContactRecord): ImportItem {
  const externalId = formatContactExternalId(xeroOrganisationId, record.ContactID)
  return { externalId, action: 'skip', data: { sourceIdentifier: externalId } }
}

/**
 * The `xero.contacts` run: an explicit first token call names the Organisation, the cursor of that
 * Organisation chooses an incremental walk or a full pass, and every Contact of the keyset walk is
 * reported in batches of `batchSize`, each batch carrying the keyset of its last Contact. A drained
 * full pass commits `lastFullAt`. The run honours `signal` above every `yield`.
 */
export async function* streamXeroContacts(input: StreamImportInput): AsyncGenerator<ImportBatch> {
  if (input.entityType !== XERO_CONTACTS_ENTITY_TYPE) throw new Error(`[internal] Unsupported sync_xero entity type: ${input.entityType}`)
  const batchSize = Math.max(1, input.batchSize)
  const container = await createRequestContainer()
  const credentialsService = container.resolve<CredentialsService>('integrationCredentialsService')
  const grantService = container.resolve<IntegrationOAuthGrantService>('integrationOAuthGrantService')
  const endpoints = await resolveXeroEndpoints({ scope: input.scope, credentialsService })
  const client = createXeroApiClient({
    grantService,
    descriptor: createXeroDescriptor(endpoints),
    owner: buildXeroGrantOwner(input.scope),
    endpoints,
    budget: 'run',
    signal: input.signal,
  })

  const token = await client.getToken()
  const organisation = parseXeroProviderData(token.providerData)
  if (!organisation) throw new Error('xero.account_pending: choose the Xero Organisation on the Xero tab of the integration.')
  const xeroOrganisationId = organisation.xeroOrganisationId
  const plan = planXeroWalk({ cursor: parseXeroCursor(input.cursor, xeroOrganisationId), xeroOrganisationId, fullSync: false })
  let cursor = plan.cursor
  let passStartedAt = plan.kind === 'full' && plan.cursor.fullPassStartedAt ? new Date(plan.cursor.fullPassStartedAt) : null
  let calls = 0
  let batchIndex = 0

  try {
    for await (const page of walkXeroContacts({ client, xeroOrganisationId, startAfter: plan.startAfter, signal: input.signal })) {
      calls += 1
      if (plan.kind === 'full' && !passStartedAt) passStartedAt = page.date ?? new Date()
      const batches = chunk(page.records, batchSize)
      for (let index = 0; index < batches.length; index += 1) {
        if (input.signal?.aborted) return
        const records = batches[index]
        const final = page.drained && index === batches.length - 1
        cursor = advanceXeroCursor(plan, cursor, { lastUpdatedAt: records[records.length - 1].updatedAt, passStartedAt })
        if (final && plan.kind === 'full' && passStartedAt) cursor = completeXeroFullPass(cursor, { passStartedAt, calls })
        yield {
          items: records.map(({ record }) => toSkipItem(xeroOrganisationId, record)),
          cursor: serializeXeroCursor(cursor),
          hasMore: !final,
          processedCount: records.length,
          batchIndex: batchIndex++,
        }
      }
      if (page.drained && batches.length === 0) {
        if (input.signal?.aborted) return
        if (plan.kind === 'full' && passStartedAt) cursor = completeXeroFullPass(cursor, { passStartedAt, calls })
        yield { items: [], cursor: serializeXeroCursor(cursor), hasMore: false, processedCount: 0, batchIndex: batchIndex++ }
      }
    }
  } catch (error) {
    if (input.signal?.aborted) return
    throw error
  }
}

export const xeroContactsAdapter: DataSyncAdapter = {
  providerKey: XERO_PROVIDER_KEY,
  direction: 'import',
  supportedEntities: [XERO_CONTACTS_ENTITY_TYPE],
  operationalTelemetry: false,
  async getMapping({ entityType }): Promise<DataMapping> {
    return { entityType, fields: [], matchStrategy: 'externalId' }
  },
  describeProgressJob() {
    return { name: 'Xero contacts' }
  },
  streamImport: streamXeroContacts,
}
