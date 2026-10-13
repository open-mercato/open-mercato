import type { EntityManager } from '@mikro-orm/postgresql'
import type { ImportItem } from '@open-mercato/core/modules/data_sync/lib/adapter'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { ZodError } from 'zod'
import { XERO_INTEGRATION_ID } from '../constants'
import { formatContactExternalId } from '../external-ids'
import type { XeroContactRecord } from '../keyset'
import type { XeroScope } from '../owner'
import { XERO_MERGED_INTO_FIELD } from '../field-definitions'
import { claimCompanyMapping } from './claim'
import { buildCompanyCreateInput, diffCompanyUpdate, resolveCompanyStatus, type CompanySnapshot, type CompanyWriteInput } from './compare'
import { parseXeroContact, type XeroContact } from './contact'
import { loadXeroCompanyIndexSources, normalizeTaxNumber, type XeroCompanyIndexes } from './indexes'
import { mapXeroContactToCompany, type MappedXeroCompany, type XeroValueWarning } from './mapping'
import { findXeroOrphanedCompanies } from './orphans'
import { loadCompanySnapshots, loadXeroRunIndex, type XeroRunIndex } from './preload'
import { classifyXeroContact } from './rules'

const MAX_CLAIM_ATTEMPTS = 20

export type XeroItemLogCode =
  | 'xero.company_deleted_in_om'
  | 'xero.company_match_ambiguous'
  | 'xero.company_matched_by_tax_number'
  | 'xero.company_duplicate_risk'
  | 'xero.tax_number_shared'
  | 'xero.company_claim_cleanup_refused'
  | 'xero.contact_merged'
  | 'xero.company_orphaned'
  | XeroValueWarning['code']

/** One fixed English sentence per code; a row names Contacts and Companies by id only, never by personal data. */
export const XERO_ITEM_LOG_MESSAGES: Record<XeroItemLogCode, string> = {
  'xero.company_deleted_in_om': 'The Xero Contact is mapped to a Company that was deleted in Open Mercato, so it was not written.',
  'xero.company_match_ambiguous': 'Several Companies carry the Contact\'s tax or registration number; the oldest one was used.',
  'xero.company_matched_by_tax_number': 'The Contact was matched to an existing Company by its tax or registration number.',
  'xero.company_duplicate_risk': 'A Company was created for the Contact although Companies with the same name exist.',
  'xero.tax_number_shared': 'Another Contact already holds the same tax number.',
  'xero.company_claim_cleanup_refused': 'A Company created for a Contact another import had already mapped could not be deleted, because people or deals are linked to it.',
  'xero.contact_merged': 'The Xero Contact was merged into another Contact; only the merge was recorded on its Company.',
  'xero.company_orphaned': 'A Company carries the Xero mark of a Contact that is mapped to another Company or to none; it was not changed.',
  'xero.value_left_out': 'A Xero value Open Mercato does not accept was left out.',
  'xero.value_truncated': 'A Xero value longer than Open Mercato allows was truncated.',
}

const CONTACT_INVALID_MESSAGE = 'The Xero Contact could not be written as a Company.'

export type XeroContactWriterDeps = {
  em: EntityManager
  scope: XeroScope
  xeroOrganisationId: string
  runId?: string
  commandBus: Pick<CommandBus, 'execute'>
  commandContext: CommandRuntimeContext
  logService: Pick<IntegrationLogService, 'write'>
  runIndex: XeroRunIndex
  indexes: () => Promise<XeroCompanyIndexes>
}

export type XeroContactWriter = {
  preparePage(records: XeroContactRecord[]): Promise<void>
  write(record: XeroContactRecord): Promise<ImportItem>
  /** After a drained full pass: logs every orphaned marked Company, never fails the run. */
  reportOrphans(now?: Date): Promise<void>
}

/** The system-actor context `sync_excel` builds, tagged with `syncOrigin`. */
export function buildXeroCommandContext(container: AppContainer, scope: XeroScope): CommandRuntimeContext {
  return {
    container,
    auth: null,
    organizationScope: {
      selectedId: scope.organizationId,
      filterIds: [scope.organizationId],
      allowedIds: [scope.organizationId],
      tenantId: scope.tenantId,
    },
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    syncOrigin: XERO_INTEGRATION_ID,
  }
}

function isRejectedInput(error: unknown): boolean {
  if (error instanceof ZodError) return true
  return isCrudHttpError(error) && error.status >= 400 && error.status < 500
}

/**
 * Writes Xero Contacts as Companies (App Spec § 6.1, § 6.2, § 6.2a). A mapped Contact updates its
 * Company only where a Xero-owned value differs; an unmapped one is matched by its marker, then by
 * its tax or registration number among unmapped Companies, else created, and the mapping is claimed
 * under the organization's lock. Item `data` carries ids and codes only.
 */
export function createXeroContactWriter(deps: XeroContactWriterDeps): XeroContactWriter {
  const { scope, xeroOrganisationId } = deps
  let pageSnapshots = new Map<string, CompanySnapshot>()

  async function log(level: 'info' | 'warn', code: XeroItemLogCode, payload: Record<string, unknown>): Promise<void> {
    try {
      await deps.logService.write(
        { integrationId: XERO_INTEGRATION_ID, runId: deps.runId, level, code, message: XERO_ITEM_LOG_MESSAGES[code], payload },
        scope,
      )
    } catch (error) {
      getTelemetryRuntime()?.reportError(error, { module: 'sync_xero', code: 'sync_xero.log_write_failed' })
    }
  }

  async function logValueWarnings(company: MappedXeroCompany, externalId: string, entityId: string): Promise<void> {
    for (const warning of company.warnings) {
      await log('warn', warning.code, { sourceIdentifier: externalId, entityIds: [entityId], field: warning.field })
    }
  }

  async function snapshotOf(entityId: string): Promise<CompanySnapshot | null> {
    const cached = pageSnapshots.get(entityId)
    if (cached) return cached
    return (await loadCompanySnapshots(deps.em.fork(), scope, [entityId])).get(entityId) ?? null
  }

  async function execute<TResult>(commandId: string, input: Record<string, unknown>): Promise<TResult> {
    const { result } = await deps.commandBus.execute<Record<string, unknown>, TResult>(commandId, { input, ctx: deps.commandContext })
    return result
  }

  function companyInput(input: CompanyWriteInput): Record<string, unknown> {
    return { organizationId: scope.organizationId, tenantId: scope.tenantId, ...input }
  }

  function item(externalId: string, action: ImportItem['action'], data: Record<string, unknown> = {}): ImportItem {
    return { externalId, action, data: { ...data, sourceIdentifier: externalId } }
  }

  async function updateCompany(company: MappedXeroCompany, externalId: string, entityId: string): Promise<ImportItem> {
    const current = await snapshotOf(entityId)
    if (!current) return refuseDeleted(externalId, entityId)
    const update = diffCompanyUpdate(company, externalId, current)
    if (!update) return item(externalId, 'skip', { localId: entityId })
    await execute('customers.companies.update', { id: entityId, ...companyInput(update) })
    pageSnapshots.delete(entityId)
    await logValueWarnings(company, externalId, entityId)
    return item(externalId, 'update', { localId: entityId })
  }

  async function refuseDeleted(externalId: string, entityId: string): Promise<ImportItem> {
    await log('warn', 'xero.company_deleted_in_om', { sourceIdentifier: externalId, entityIds: [entityId] })
    return item(externalId, 'skip', { localId: entityId, errorCode: 'xero.company_deleted_in_om' })
  }

  async function markMerged(externalId: string, contactId: string, entityId: string, survivingContactId: string): Promise<ImportItem> {
    const current = await snapshotOf(entityId)
    if (!current) return refuseDeleted(externalId, entityId)
    if (current.custom[XERO_MERGED_INTO_FIELD] !== survivingContactId) {
      await execute('customers.companies.update', { id: entityId, ...companyInput({ customFields: { [XERO_MERGED_INTO_FIELD]: survivingContactId } }) })
      pageSnapshots.delete(entityId)
    }
    const survivorEntityId = deps.runIndex.lookup(formatContactExternalId(xeroOrganisationId, survivingContactId))
    await log('warn', 'xero.contact_merged', {
      sourceIdentifier: externalId,
      entityIds: survivorEntityId ? [entityId, survivorEntityId] : [entityId],
      contactIds: [contactId, survivingContactId],
    })
    return item(externalId, 'skip', { localId: entityId, errorCode: 'xero.contact_merged' })
  }

  async function flipStatusOnly(externalId: string, entityId: string): Promise<ImportItem> {
    const current = await snapshotOf(entityId)
    if (!current) return refuseDeleted(externalId, entityId)
    const status = resolveCompanyStatus('GDPRREQUEST', current)!
    if (status.status === current.status && status.isActive === current.isActive) return item(externalId, 'skip', { localId: entityId })
    await execute('customers.companies.update', { id: entityId, ...companyInput(status) })
    pageSnapshots.delete(entityId)
    return item(externalId, 'update', { localId: entityId })
  }

  async function deleteCreatedCompany(entityId: string, externalId: string): Promise<void> {
    try {
      await execute('customers.companies.delete', { id: entityId })
    } catch (error) {
      if (!isCrudHttpError(error) || error.status !== 422) throw error
      await log('warn', 'xero.company_claim_cleanup_refused', { sourceIdentifier: externalId, entityIds: [entityId] })
    }
  }

  async function writeFirstSync(company: MappedXeroCompany, contact: XeroContact, externalId: string): Promise<ImportItem> {
    const indexes = await deps.indexes()
    const contactId = contact.ContactID
    const taxKey = normalizeTaxNumber(company.taxNumber)
    const registrationKey = normalizeTaxNumber(contact.CompanyNumber)
    const sharedWith = taxKey ? indexes.taxNumberClaimedBy(taxKey) : null
    if (sharedWith && sharedWith !== contactId) {
      await log('warn', 'xero.tax_number_shared', { sourceIdentifier: externalId, contactIds: [sharedWith, contactId] })
    }
    let ambiguityReported = false

    for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
      let candidate = indexes.findMarked(externalId)
      let matchedByNumber = false
      if (!candidate) {
        for (const key of [taxKey, registrationKey]) {
          if (!key) continue
          const candidates = indexes.findByTaxNumber(key)
          if (candidates.length === 0) continue
          if (candidates.length > 1 && !ambiguityReported) {
            ambiguityReported = true
            await log('warn', 'xero.company_match_ambiguous', { sourceIdentifier: externalId, entityIds: candidates })
          }
          candidate = candidates[0]
          matchedByNumber = true
          break
        }
      }

      let created = false
      if (!candidate) {
        const namesakes = indexes.findByName(company.displayName)
        const result = await execute<{ entityId: string }>('customers.companies.create', companyInput(buildCompanyCreateInput(company, externalId)))
        candidate = result.entityId
        created = true
        indexes.addCompanyName(candidate, company.displayName)
        if (namesakes.length > 0) {
          await log('warn', 'xero.company_duplicate_risk', { sourceIdentifier: externalId, entityIds: [candidate, ...namesakes] })
        }
      }

      const claim = await claimCompanyMapping({ em: deps.em, scope, xeroOrganisationId, contactId, candidateEntityId: candidate })
      if (claim.outcome === 'won') {
        deps.runIndex.add(externalId, candidate)
        indexes.markClaimed(candidate)
        if (taxKey) indexes.recordTaxNumberClaim(taxKey, contactId)
        if (created) {
          await logValueWarnings(company, externalId, candidate)
          return item(externalId, 'create', { localId: candidate })
        }
        if (matchedByNumber) {
          await log('info', 'xero.company_matched_by_tax_number', { sourceIdentifier: externalId, entityIds: [candidate] })
        }
        return updateCompany(company, externalId, candidate)
      }

      indexes.markClaimed(candidate)
      if (created) await deleteCreatedCompany(candidate, externalId)
      if (claim.winnerEntityId) {
        deps.runIndex.add(externalId, claim.winnerEntityId)
        if (claim.winnerDeleted) return refuseDeleted(externalId, claim.winnerEntityId)
        return updateCompany(company, externalId, claim.winnerEntityId)
      }
    }
    throw new Error(`[internal] sync_xero could not claim a Company after ${MAX_CLAIM_ATTEMPTS} attempts`)
  }

  return {
    async preparePage(records) {
      const mapped = records
        .map((record) => deps.runIndex.lookup(formatContactExternalId(xeroOrganisationId, record.ContactID)))
        .filter((entityId): entityId is string => entityId !== null)
      pageSnapshots = await loadCompanySnapshots(deps.em.fork(), scope, mapped)
    },

    async write(record) {
      const externalId = formatContactExternalId(xeroOrganisationId, record.ContactID)
      const invalid = () => item(externalId, 'failed', { errorCode: 'xero.contact_invalid', errorMessage: CONTACT_INVALID_MESSAGE })
      const contact = parseXeroContact(record)
      if (!contact) return invalid()
      try {
        const mappedEntityId = deps.runIndex.lookup(externalId)
        const decision = classifyXeroContact(contact, mappedEntityId !== null)
        if (decision.kind === 'skip') return item(externalId, 'skip')
        if (mappedEntityId && decision.kind === 'merge_mark') {
          return await markMerged(externalId, contact.ContactID, mappedEntityId, decision.survivingContactId)
        }
        if (mappedEntityId && decision.kind === 'status_only') return await flipStatusOnly(externalId, mappedEntityId)
        const mapping = mapXeroContactToCompany(contact)
        if (!mapping.ok) return invalid()
        if (mappedEntityId) return await updateCompany(mapping.company, externalId, mappedEntityId)
        return await writeFirstSync(mapping.company, contact, externalId)
      } catch (error) {
        if (!isRejectedInput(error)) throw error
        return invalid()
      }
    },

    async reportOrphans(now = new Date()) {
      try {
        const [sources, mappings] = await Promise.all([
          loadXeroCompanyIndexSources(deps.em.fork(), scope),
          loadXeroRunIndex(deps.em.fork(), scope),
        ])
        for (const orphan of findXeroOrphanedCompanies(sources, mappings, now)) {
          await log('warn', 'xero.company_orphaned', {
            sourceIdentifier: orphan.marker,
            entityIds: orphan.mappedEntityId ? [orphan.entityId, orphan.mappedEntityId] : [orphan.entityId],
          })
        }
      } catch (error) {
        getTelemetryRuntime()?.reportError(error, { module: 'sync_xero', code: 'sync_xero.orphan_report_failed' })
      }
    },
  }
}
