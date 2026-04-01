import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type {
  DataMapping,
  DataSyncAdapter,
  FieldMapping,
  ImportBatch,
  ImportItem,
  TenantScope,
} from '../../../data_sync/lib/adapter'
import type { ExternalIdMappingService } from '../../../data_sync/lib/id-mapping'
import { SyncMapping } from '../../../data_sync/data/entities'
import { CustomerEntity } from '../../../customers/data/entities'
import { Attachment } from '../../../attachments/data/entities'
import { SyncExcelUpload } from '../../data/entities'
import { parseCsvDocument, type CsvPreviewRow } from '../parser'
import { readSyncExcelUploadBuffer } from '../upload-storage'

type SyncExcelCursor = {
  uploadId: string
  offset: number
}

type Container = Awaited<ReturnType<typeof createRequestContainer>>

type PersonFieldValues = {
  externalId?: string | null
  firstName?: string | null
  lastName?: string | null
  displayName?: string | null
  primaryEmail?: string | null
  primaryPhone?: string | null
  jobTitle?: string | null
  status?: string | null
  source?: string | null
  description?: string | null
}

type PersonRowValues = {
  values: PersonFieldValues
  customFields: Record<string, unknown>
}

type BuiltPersonPayload = {
  values: PersonFieldValues
  customFields: Record<string, unknown>
  createInput: {
    organizationId: string
    tenantId: string
    firstName: string
    lastName: string
    displayName: string
    primaryEmail?: string
    primaryPhone?: string
    jobTitle?: string
    status?: string
    source?: string
    description?: string
    customFields?: Record<string, unknown>
  } | null
  updateInput: {
    organizationId: string
    tenantId: string
    primaryEmail?: string
    primaryPhone?: string
    jobTitle?: string
    status?: string
    source?: string
    description?: string
    firstName?: string
    lastName?: string
    displayName?: string
    customFields?: Record<string, unknown>
  }
  sourceIdentifier: string | null
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeEmail(value: unknown): string | null {
  const normalized = normalizeOptionalString(value)
  return normalized ? normalized.toLowerCase() : null
}

function buildCommandContext(container: Container, scope: TenantScope): CommandRuntimeContext {
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
  }
}

function createCursor(uploadId: string, offset: number): string {
  return JSON.stringify({ uploadId, offset })
}

export function parseCursor(value: string | null | undefined): SyncExcelCursor | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<SyncExcelCursor> | null
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.uploadId !== 'string' || parsed.uploadId.trim().length === 0) return null
    if (typeof parsed.offset !== 'number' || !Number.isFinite(parsed.offset) || parsed.offset < 0) return null
    return {
      uploadId: parsed.uploadId,
      offset: parsed.offset,
    }
  } catch {
    return null
  }
}

function mapRowValues(row: CsvPreviewRow, fields: FieldMapping[]): PersonRowValues {
  const values: PersonFieldValues = {}
  const customFields: Record<string, unknown> = {}

  for (const field of fields) {
    if (field.mappingKind === 'ignore') continue
    const rawValue = row[field.externalField]
    if (rawValue === undefined || rawValue === null) continue
    if (field.mappingKind === 'custom_field' || field.localField.startsWith('cf:')) {
      const customFieldKey = field.localField.startsWith('cf:') ? field.localField.slice(3) : field.localField
      if (customFieldKey.trim().length > 0) {
        customFields[customFieldKey] = rawValue
      }
      continue
    }

    if (field.localField === 'person.externalId') {
      values.externalId = normalizeOptionalString(rawValue)
      continue
    }
    if (field.localField === 'person.firstName') {
      values.firstName = normalizeOptionalString(rawValue)
      continue
    }
    if (field.localField === 'person.lastName') {
      values.lastName = normalizeOptionalString(rawValue)
      continue
    }
    if (field.localField === 'person.displayName') {
      values.displayName = normalizeOptionalString(rawValue)
      continue
    }
    if (field.localField === 'person.primaryEmail') {
      values.primaryEmail = normalizeEmail(rawValue)
      continue
    }
    if (field.localField === 'person.primaryPhone') {
      values.primaryPhone = normalizeOptionalString(rawValue)
      continue
    }
    if (field.localField === 'person.jobTitle') {
      values.jobTitle = normalizeOptionalString(rawValue)
      continue
    }
    if (field.localField === 'person.status') {
      values.status = normalizeOptionalString(rawValue)
      continue
    }
    if (field.localField === 'person.source') {
      values.source = normalizeOptionalString(rawValue)
      continue
    }
    if (field.localField === 'person.description') {
      values.description = normalizeOptionalString(rawValue)
    }
  }

  return {
    values,
    customFields,
  }
}

function derivePersonNames(values: PersonFieldValues): { firstName: string; lastName: string; displayName: string } | null {
  const firstName = values.firstName ?? null
  const lastName = values.lastName ?? null
  const explicitDisplayName = values.displayName ?? null

  if (firstName && lastName) {
    return {
      firstName,
      lastName,
      displayName: explicitDisplayName ?? `${firstName} ${lastName}`.trim(),
    }
  }

  if (explicitDisplayName) {
    const parts = explicitDisplayName.split(/\s+/).filter((part) => part.length > 0)
    if (parts.length >= 2) {
      return {
        firstName: firstName ?? parts.slice(0, -1).join(' '),
        lastName: lastName ?? parts.at(-1) ?? explicitDisplayName,
        displayName: explicitDisplayName,
      }
    }
    return {
      firstName: firstName ?? explicitDisplayName,
      lastName: lastName ?? explicitDisplayName,
      displayName: explicitDisplayName,
    }
  }

  return null
}

export function buildPersonPayload(row: CsvPreviewRow, mapping: DataMapping, scope: TenantScope): BuiltPersonPayload {
  const { values, customFields } = mapRowValues(row, mapping.fields)
  const derivedNames = derivePersonNames(values)
  const sourceIdentifier = values.externalId ?? values.primaryEmail ?? values.displayName ?? null

  const updateInput: BuiltPersonPayload['updateInput'] = {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  }

  if (values.primaryEmail) updateInput.primaryEmail = values.primaryEmail
  if (values.primaryPhone) updateInput.primaryPhone = values.primaryPhone
  if (values.jobTitle) updateInput.jobTitle = values.jobTitle
  if (values.status) updateInput.status = values.status
  if (values.source) updateInput.source = values.source
  if (values.description) updateInput.description = values.description
  if (derivedNames?.firstName) updateInput.firstName = derivedNames.firstName
  if (derivedNames?.lastName) updateInput.lastName = derivedNames.lastName
  if (derivedNames?.displayName) updateInput.displayName = derivedNames.displayName

  if (!derivedNames) {
    return {
      values,
      customFields,
      createInput: null,
      updateInput,
      sourceIdentifier,
    }
  }

  return {
    values,
    customFields,
    createInput: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      firstName: derivedNames.firstName,
      lastName: derivedNames.lastName,
      displayName: derivedNames.displayName,
      ...(values.primaryEmail ? { primaryEmail: values.primaryEmail } : {}),
      ...(values.primaryPhone ? { primaryPhone: values.primaryPhone } : {}),
      ...(values.jobTitle ? { jobTitle: values.jobTitle } : {}),
      ...(values.status ? { status: values.status } : {}),
      ...(values.source ? { source: values.source } : {}),
      ...(values.description ? { description: values.description } : {}),
    },
    updateInput,
    sourceIdentifier,
  }
}

async function loadStoredMapping(em: EntityManager, entityType: string, scope: TenantScope): Promise<DataMapping> {
  const stored = await em.findOne(SyncMapping, {
    integrationId: 'sync_excel',
    entityType,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })

  if (stored?.mapping && typeof stored.mapping === 'object') {
    return stored.mapping as unknown as DataMapping
  }

  return {
    entityType,
    fields: [],
    matchStrategy: 'custom',
  }
}

async function resolveUpload(em: EntityManager, runId: string | undefined, cursor: SyncExcelCursor | null, scope: TenantScope): Promise<SyncExcelUpload | null> {
  if (runId) {
    const uploadByRun = await em.findOne(SyncExcelUpload, {
      syncRunId: runId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    if (uploadByRun) return uploadByRun
  }

  if (cursor?.uploadId) {
    return em.findOne(SyncExcelUpload, {
      id: cursor.uploadId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
  }

  return null
}

async function resolveExistingPersonId(params: {
  externalIdMappingService: ExternalIdMappingService
  em: EntityManager
  externalId: string | null | undefined
  email: string | null | undefined
  scope: TenantScope
}): Promise<string | null> {
  if (params.externalId) {
    const mappedLocalId = await params.externalIdMappingService.lookupLocalId(
      'sync_excel',
      'customers.person',
      params.externalId,
      params.scope,
    )
    if (mappedLocalId) return mappedLocalId
  }

  if (!params.email) return null

  const existing = await findOneWithDecryption(
    params.em,
    CustomerEntity,
    {
      kind: 'person',
      primaryEmail: params.email,
      organizationId: params.scope.organizationId,
      tenantId: params.scope.tenantId,
      deletedAt: null,
    },
    undefined,
    params.scope,
  )

  return existing?.id ?? null
}

function isEmptyRow(row: CsvPreviewRow): boolean {
  return !Object.values(row).some((value) => normalizeOptionalString(value))
}

async function processRow(params: {
  row: CsvPreviewRow
  rowNumber: number
  mapping: DataMapping
  scope: TenantScope
  commandBus: CommandBus
  commandContext: CommandRuntimeContext
  externalIdMappingService: ExternalIdMappingService
  em: EntityManager
}): Promise<ImportItem> {
  if (isEmptyRow(params.row)) {
    return {
      externalId: `row:${params.rowNumber}`,
      action: 'skip',
      data: {
        rowNumber: params.rowNumber,
        reason: 'empty_row',
      },
    }
  }

  const payload = buildPersonPayload(params.row, params.mapping, params.scope)
  const externalId = payload.values.externalId ?? null
  const sourceIdentifier = payload.sourceIdentifier ?? `row:${params.rowNumber}`
  const existingId = await resolveExistingPersonId({
    externalIdMappingService: params.externalIdMappingService,
    em: params.em,
    externalId,
    email: payload.values.primaryEmail,
    scope: params.scope,
  })

  if (!existingId && !payload.createInput) {
    return {
      externalId: externalId ?? sourceIdentifier,
      action: 'failed',
      data: {
        rowNumber: params.rowNumber,
        sourceIdentifier,
        errorMessage: 'Import row is missing a usable person name mapping.',
      },
    }
  }

  try {
    if (existingId) {
      const updateInput = {
        id: existingId,
        ...payload.updateInput,
        ...(Object.keys(payload.customFields).length > 0 ? { customFields: payload.customFields } : {}),
      }
      await params.commandBus.execute('customers.people.update', {
        input: updateInput,
        ctx: params.commandContext,
      })

      if (externalId) {
        await params.externalIdMappingService.storeExternalIdMapping(
          'sync_excel',
          'customers.person',
          existingId,
          externalId,
          params.scope,
        )
      }

      return {
        externalId: externalId ?? sourceIdentifier,
        action: 'update',
        data: {
          localId: existingId,
          rowNumber: params.rowNumber,
          sourceIdentifier,
        },
      }
    }

    const commandResult = await params.commandBus.execute<
      NonNullable<BuiltPersonPayload['createInput']>,
      { entityId: string; personId: string }
    >('customers.people.create', {
      input: {
        ...payload.createInput!,
        ...(Object.keys(payload.customFields).length > 0 ? { customFields: payload.customFields } : {}),
      },
      ctx: params.commandContext,
    })

    if (externalId) {
      await params.externalIdMappingService.storeExternalIdMapping(
        'sync_excel',
        'customers.person',
        commandResult.result.entityId,
        externalId,
        params.scope,
      )
    }

    return {
      externalId: externalId ?? sourceIdentifier,
      action: 'create',
      data: {
        localId: commandResult.result.entityId,
        personId: commandResult.result.personId,
        rowNumber: params.rowNumber,
        sourceIdentifier,
      },
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Import row failed'
    return {
      externalId: externalId ?? sourceIdentifier,
      action: 'failed',
      data: {
        rowNumber: params.rowNumber,
        sourceIdentifier,
        errorMessage,
      },
    }
  }
}

export const syncExcelCustomersAdapter: DataSyncAdapter = {
  providerKey: 'excel',
  direction: 'import',
  supportedEntities: ['customers.person'],

  async getMapping(input): Promise<DataMapping> {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    return loadStoredMapping(em, input.entityType, input.scope)
  },

  async *streamImport(input): AsyncIterable<ImportBatch> {
    if (input.entityType !== 'customers.person') {
      throw new Error(`Unsupported sync_excel entity type: ${input.entityType}`)
    }

    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const commandBus = container.resolve('commandBus') as CommandBus
    const externalIdMappingService = container.resolve('externalIdMappingService') as ExternalIdMappingService
    const cursor = parseCursor(input.cursor)
    const upload = await resolveUpload(em, input.runId, cursor, input.scope)

    if (!upload) {
      throw new Error('CSV upload session was not found for this sync run.')
    }

    if (input.runId) {
      upload.syncRunId = input.runId
    }
    upload.status = 'importing'
    await em.flush()

    try {
      const attachment = await em.findOne(Attachment, {
        id: upload.attachmentId,
        organizationId: input.scope.organizationId,
        tenantId: input.scope.tenantId,
      })

      if (!attachment) {
        throw new Error('CSV upload attachment could not be found.')
      }

      const fileBuffer = await readSyncExcelUploadBuffer(attachment)
      const document = parseCsvDocument(fileBuffer)
      const startOffset = cursor?.uploadId === upload.id ? cursor.offset : 0
      const commandContext = buildCommandContext(container, input.scope)

      for (let offset = startOffset, batchIndex = 0; offset < document.rows.length; offset += input.batchSize, batchIndex += 1) {
        const batchRows = document.rows.slice(offset, offset + input.batchSize)
        const items: ImportItem[] = []

        for (let index = 0; index < batchRows.length; index += 1) {
          items.push(await processRow({
            row: batchRows[index],
            rowNumber: offset + index + 1,
            mapping: input.mapping,
            scope: input.scope,
            commandBus,
            commandContext,
            externalIdMappingService,
            em,
          }))
        }

        const nextOffset = offset + batchRows.length
        yield {
          items,
          cursor: createCursor(upload.id, nextOffset),
          hasMore: nextOffset < document.rows.length,
          totalEstimate: document.totalRows,
          processedCount: batchRows.length,
          batchIndex,
          message: `Processed ${nextOffset} of ${document.totalRows} CSV rows`,
        }
      }

      upload.status = 'completed'
      await em.flush()
    } catch (error) {
      upload.status = 'failed'
      await em.flush()
      throw error
    }
  },
}
