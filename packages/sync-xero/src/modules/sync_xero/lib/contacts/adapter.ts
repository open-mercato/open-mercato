import type {
  DataMapping,
  DataSyncAdapter,
  ImportBatch,
  ImportItem,
  StreamImportInput,
} from '@open-mercato/core/modules/data_sync/lib/adapter'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationOAuthGrantService } from '@open-mercato/core/modules/integrations/lib/oauth/grant-service'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { createXeroApiClient } from '../api-client'
import { XERO_CONTACTS_ENTITY_TYPE, XERO_INTEGRATION_ID, XERO_PROVIDER_KEY } from '../constants'
import { advanceXeroCursor, completeXeroFullPass, parseXeroCursor, planXeroWalk, serializeXeroCursor } from '../cursor'
import { createXeroDescriptor } from '../descriptor'
import { resolveXeroEndpoints } from '../endpoints'
import { formatContactExternalId } from '../external-ids'
import { walkXeroContacts, type XeroContactRecord } from '../keyset'
import { buildXeroGrantOwner } from '../owner'
import {
  checkRunOrganisation,
  classifyXeroRunError,
  createGrantPresenceCheck,
  resolveXeroRunOrigin,
  XERO_RUN_MESSAGES,
  type XeroQuietEndCode,
  type XeroRunOrigin,
} from '../run-guard'

type RunService = { getRun(runId: string, scope: StreamImportInput['scope']): Promise<{ triggeredBy?: string | null } | null> }

class XeroQuietEnd extends Error {
  constructor(readonly code: XeroQuietEndCode) {
    super(`[internal] ${code}`)
    this.name = 'XeroQuietEnd'
  }
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))
  return chunks
}

function toSkipItem(xeroOrganisationId: string, record: XeroContactRecord): ImportItem {
  const externalId = formatContactExternalId(xeroOrganisationId, record.ContactID)
  return { externalId, action: 'skip', data: { sourceIdentifier: externalId } }
}

function organisationOf(providerData: Record<string, unknown> | null, expected: string | null, origin: XeroRunOrigin): string {
  const check = checkRunOrganisation(providerData, { expected, origin })
  if (check.kind === 'ok') return check.xeroOrganisationId
  if (check.kind === 'quiet') throw new XeroQuietEnd(check.code)
  throw check.failure
}

/**
 * The `xero.contacts` run: an explicit first token call names the Organisation, the cursor of that
 * Organisation chooses an incremental walk or a full pass, and every Contact of the keyset walk is
 * reported in batches of `batchSize`, each batch carrying the keyset of its last Contact. A drained
 * full pass commits `lastFullAt`. Grant failures end the run quietly or fail it with a `xero.*`
 * message (the grant-state table of the feature spec); a missing grant before an item stops it
 * within about one second. The run honours `signal` above every `yield`.
 */
export async function* streamXeroContacts(input: StreamImportInput): AsyncGenerator<ImportBatch> {
  if (input.entityType !== XERO_CONTACTS_ENTITY_TYPE) throw new Error(`[internal] Unsupported sync_xero entity type: ${input.entityType}`)
  const batchSize = Math.max(1, input.batchSize)
  const container = await createRequestContainer()
  const logService = container.resolve<IntegrationLogService>('integrationLogService')
  const grantService = container.resolve<IntegrationOAuthGrantService>('integrationOAuthGrantService')
  const origin = await resolveXeroRunOrigin(container.resolve<RunService>('dataSyncRunService'), input.runId, input.scope)

  try {
    const credentialsService = container.resolve<CredentialsService>('integrationCredentialsService')
    const endpoints = await resolveXeroEndpoints({ scope: input.scope, credentialsService })
    const client = createXeroApiClient({
      grantService,
      descriptor: createXeroDescriptor(endpoints),
      owner: buildXeroGrantOwner(input.scope),
      endpoints,
      budget: 'run',
      signal: input.signal,
    })
    const grantPresent = createGrantPresenceCheck(grantService, input.scope)

    const xeroOrganisationId = organisationOf((await client.getToken()).providerData, null, origin)
    const plan = planXeroWalk({ cursor: parseXeroCursor(input.cursor, xeroOrganisationId), xeroOrganisationId, fullSync: false })
    let cursor = plan.cursor
    let passStartedAt = plan.kind === 'full' && plan.cursor.fullPassStartedAt ? new Date(plan.cursor.fullPassStartedAt) : null
    let calls = 0
    let batchIndex = 0

    for await (const page of walkXeroContacts({ client, xeroOrganisationId, startAfter: plan.startAfter, signal: input.signal })) {
      calls += 1
      organisationOf(page.providerData, xeroOrganisationId, origin)
      if (plan.kind === 'full' && !passStartedAt) passStartedAt = page.date ?? new Date()
      const batches = chunk(page.records, batchSize)
      for (let index = 0; index < batches.length; index += 1) {
        const records = batches[index]
        const items: ImportItem[] = []
        for (const { record } of records) {
          if (input.signal?.aborted) return
          if (!(await grantPresent())) throw new XeroQuietEnd('xero.run_stopped_not_connected')
          items.push(toSkipItem(xeroOrganisationId, record))
        }
        if (input.signal?.aborted) return
        const final = page.drained && index === batches.length - 1
        cursor = advanceXeroCursor(plan, cursor, { lastUpdatedAt: records[records.length - 1].updatedAt, passStartedAt })
        if (final && plan.kind === 'full' && passStartedAt) cursor = completeXeroFullPass(cursor, { passStartedAt, calls })
        yield { items, cursor: serializeXeroCursor(cursor), hasMore: !final, processedCount: items.length, batchIndex: batchIndex++ }
      }
      if (page.drained && batches.length === 0) {
        if (input.signal?.aborted) return
        if (plan.kind === 'full' && passStartedAt) cursor = completeXeroFullPass(cursor, { passStartedAt, calls })
        yield { items: [], cursor: serializeXeroCursor(cursor), hasMore: false, processedCount: 0, batchIndex: batchIndex++ }
      }
    }
  } catch (error) {
    if (input.signal?.aborted) return
    const outcome = error instanceof XeroQuietEnd ? { kind: 'quiet' as const, code: error.code } : classifyXeroRunError(error, origin)
    if (!outcome) throw error
    if (outcome.kind === 'fail') throw outcome.failure
    try {
      await logService.write(
        {
          integrationId: XERO_INTEGRATION_ID,
          runId: input.runId,
          level: 'warn',
          message: XERO_RUN_MESSAGES[outcome.code],
          code: outcome.code,
          payload: { entityType: input.entityType, origin },
        },
        input.scope,
      )
    } catch (logError) {
      getTelemetryRuntime()?.reportError(logError, { module: 'sync_xero', code: 'sync_xero.log_write_failed' })
    }
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
