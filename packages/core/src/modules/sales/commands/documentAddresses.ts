// @ts-nocheck

import { isDeepStrictEqual } from 'node:util'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import {
  documentAddressCreateSchema,
  documentAddressDeleteSchema,
  documentAddressUpdateSchema,
  type DocumentAddressCreateInput,
  type DocumentAddressDeleteInput,
  type DocumentAddressUpdateInput,
} from '../data/validators'
import { SalesDocumentAddress, SalesOrder, SalesQuote } from '../data/entities'
import { ensureOrganizationScope, ensureTenantScope, assertFound, extractUndoPayload, enforceSalesDocumentOptimisticLock, lockSalesDocumentRow } from './shared'
import { loadSalesSettings } from './settings'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { applyAddressCustomValues, loadAddressCustomFieldDefinitions, readAddressCustomValues, sealAddressCustomValues } from '@open-mercato/core/modules/entities/lib/addressCustomFields'
import { readCopiedAddressValues } from '../lib/addressCustomValues'

const DOCUMENT_ADDRESS_ENTITY_TYPE = E.sales.sales_document_address
const DOCUMENT_ADDRESS_RESOURCE_KIND = 'sales.document_address'

type DocumentAddressSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  documentId: string
  documentKind: 'order' | 'quote'
  customerAddressId: string | null
  addressCustomValues?: Record<string, unknown>
  name: string | null
  purpose: string | null
  companyName: string | null
  addressLine1: string
  addressLine2: string | null
  buildingNumber: string | null
  flatNumber: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
}

type DocumentAddressUndoPayload = {
  before?: DocumentAddressSnapshot | null
  after?: DocumentAddressSnapshot | null
}

const lockedAddressUpdates = new WeakMap<{ id: string }, {
  before: DocumentAddressSnapshot
  after: DocumentAddressSnapshot
}>()

function snapshotDocumentAddress(entity: SalesDocumentAddress): DocumentAddressSnapshot {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    tenantId: entity.tenantId,
    documentId: entity.documentId,
    documentKind: entity.documentKind as 'order' | 'quote',
    customerAddressId: entity.customerAddressId ?? null,
    ...(entity.customValues == null ? {} : { addressCustomValues: readAddressCustomValues(entity.customValues) ?? undefined }),
    name: entity.name ?? null,
    purpose: entity.purpose ?? null,
    companyName: entity.companyName ?? null,
    addressLine1: entity.addressLine1,
    addressLine2: entity.addressLine2 ?? null,
    buildingNumber: entity.buildingNumber ?? null,
    flatNumber: entity.flatNumber ?? null,
    city: entity.city ?? null,
    region: entity.region ?? null,
    postalCode: entity.postalCode ?? null,
    country: entity.country ?? null,
    latitude: entity.latitude ?? null,
    longitude: entity.longitude ?? null,
  }
}

async function loadDocumentAddressSnapshot(
  em: EntityManager,
  id: string,
  { tenantId, organizationId, documentId, documentKind }: {
    tenantId: string
    organizationId: string
    documentId: string
    documentKind: 'order' | 'quote'
  },
): Promise<DocumentAddressSnapshot | null> {
  const scope = { tenantId, organizationId }
  const entity = await findOneWithDecryption(em, SalesDocumentAddress, { id, documentId, documentKind, deletedAt: null, ...scope }, {}, scope)
  return entity ? snapshotDocumentAddress(entity) : null
}

async function applyDocumentAddressSnapshot(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  entity: SalesDocumentAddress,
  snapshot: DocumentAddressSnapshot,
  restoreCustomValues = false,
) {
  if (restoreCustomValues) {
    entity.customValues = await sealAddressCustomValues(ctx.container, {
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      entityId: DOCUMENT_ADDRESS_ENTITY_TYPE,
      column: 'customValues',
      values: snapshot.addressCustomValues ?? null,
      em,
    })
  }
  entity.organizationId = snapshot.organizationId
  entity.tenantId = snapshot.tenantId
  entity.documentId = snapshot.documentId
  entity.documentKind = snapshot.documentKind
  entity.customerAddressId = snapshot.customerAddressId
  entity.name = snapshot.name
  entity.purpose = snapshot.purpose
  entity.companyName = snapshot.companyName
  entity.addressLine1 = snapshot.addressLine1
  entity.addressLine2 = snapshot.addressLine2
  entity.buildingNumber = snapshot.buildingNumber
  entity.flatNumber = snapshot.flatNumber
  entity.city = snapshot.city
  entity.region = snapshot.region
  entity.postalCode = snapshot.postalCode
  entity.country = snapshot.country
  entity.latitude = snapshot.latitude
  entity.longitude = snapshot.longitude
  entity.order = snapshot.documentKind === 'order' ? em.getReference(SalesOrder, snapshot.documentId) : null
  entity.quote = snapshot.documentKind === 'quote' ? em.getReference(SalesQuote, snapshot.documentId) : null
}

async function emitDocumentAddressIndexSideEffects(
  ctx: { container: { resolve: (name: string) => unknown } },
  action: 'created' | 'updated' | 'deleted',
  snapshot: DocumentAddressSnapshot
): Promise<void> {
  let dataEngine: DataEngine | null = null
  try {
    dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  } catch {
    dataEngine = null
  }
  if (!dataEngine) return
  const { addressCustomValues, ...address } = snapshot
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity: address,
    identifiers: {
      id: snapshot.id,
      organizationId: snapshot.organizationId,
      tenantId: snapshot.tenantId,
    },
    indexer: { entityType: DOCUMENT_ADDRESS_ENTITY_TYPE },
  })
}

async function requireDocument(
  em: EntityManager,
  kind: 'order' | 'quote',
  id: string,
  organizationId: string,
  tenantId: string
): Promise<SalesOrder | SalesQuote> {
  const repo = kind === 'order' ? SalesOrder : SalesQuote
  const scope = { tenantId, organizationId }
  const table = kind === 'order' ? 'sales_orders' : 'sales_quotes'
  if (!await lockSalesDocumentRow(em, table, id, scope)) {
    throw notFound('sales.document.not_found')
  }
  const doc = await findOneWithDecryption(em, repo, { id, deletedAt: null, ...scope }, {}, scope)
  if (!doc) {
    throw notFound('sales.document.not_found')
  }
  if (kind === 'order') {
    await assertAddressEditable(em, { ...scope, status: doc.status ?? null })
  }
  return doc
}

async function lockDocumentAddress(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  input: DocumentAddressUpdateInput | DocumentAddressDeleteInput,
) {
  const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const entity = assertFound(await findOneWithDecryption(
    em, SalesDocumentAddress,
    { id: input.id, documentId: input.documentId, documentKind: input.documentKind, deletedAt: null, ...scope },
    { lockMode: LockMode.PESSIMISTIC_WRITE }, scope,
  ), 'sales.document.address.not_found')
  await enforceSalesDocumentOptimisticLock(ctx, entity, DOCUMENT_ADDRESS_RESOURCE_KIND)
  return entity
}

async function assertAddressEditable(
  em: EntityManager,
  params: { organizationId: string; tenantId: string; status: string | null }
): Promise<void> {
  const settings = await loadSalesSettings(em, {
    tenantId: params.tenantId,
    organizationId: params.organizationId,
  })
  const allowed = settings?.orderAddressEditableStatuses ?? null
  if (!Array.isArray(allowed)) return
  const { translate } = await resolveTranslations()
  if (allowed.length === 0) {
    throw new CrudHttpError(400, { error: translate('sales.orders.edit_addresses_blocked', 'Addresses cannot be changed for the current status.') })
  }
  if (!params.status || !allowed.includes(params.status)) {
    throw new CrudHttpError(400, { error: translate('sales.orders.edit_addresses_blocked', 'Addresses cannot be changed for the current status.') })
  }
}

async function resolveAdditionalAddressValues(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  document: SalesOrder | SalesQuote,
  input: DocumentAddressCreateInput | DocumentAddressUpdateInput,
  nextAddressId: string | null,
  existing?: SalesDocumentAddress,
) {
  const copy = input.copyCustomerAddressCustomValues === true
  const valuesEdited = copy || input.customValues !== undefined
  const changed = (existing?.customerAddressId ?? null)?.toLowerCase() !== nextAddressId?.toLowerCase()
  if (!valuesEdited) return changed && existing?.customValues != null ? null : undefined

  const scope = { tenantId: document.tenantId, organizationId: document.organizationId }
  const host = { ...scope, entityId: DOCUMENT_ADDRESS_ENTITY_TYPE }
  const definitions = await loadAddressCustomFieldDefinitions(em, host)
  const stored = readAddressCustomValues(existing?.customValues)
  const previous = copy
    ? await readCopiedAddressValues(em, ctx, scope, document.customerEntityId, input.customerAddressId, definitions)
    : changed ? null : stored
  const values = await applyAddressCustomValues(em, { ...host, previous, patch: input.customValues ?? {}, definitions })
  return sealAddressCustomValues(ctx.container, { ...host, column: 'customValues', values, em })
}

const createDocumentAddress: CommandHandler<DocumentAddressCreateInput, { id: string }> = {
  id: 'sales.document-addresses.create',
  async execute(rawInput, ctx) {
    const input = documentAddressCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const rootEm = (ctx.container.resolve('em') as EntityManager).fork()
    return rootEm.transactional(async (em) => {
      const document = await requireDocument(em, input.documentKind, input.documentId, input.organizationId, input.tenantId)
      const customValues = await resolveAdditionalAddressValues(em, ctx, document, input, input.customerAddressId ?? null)
      const entity = em.create(SalesDocumentAddress, {
        ...(customValues !== undefined ? { customValues } : {}),
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        documentId: input.documentId,
        documentKind: input.documentKind,
        customerAddressId: input.customerAddressId ?? null,
        name: input.name ?? null,
        purpose: input.purpose ?? null,
        companyName: input.companyName ?? null,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2 ?? null,
        buildingNumber: input.buildingNumber ?? null,
        flatNumber: input.flatNumber ?? null,
        city: input.city ?? null,
        region: input.region ?? null,
        postalCode: input.postalCode ?? null,
        country: input.country ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        order: input.documentKind === 'order' ? (document as SalesOrder) : null,
        quote: input.documentKind === 'quote' ? (document as SalesQuote) : null,
      })
      await em.persist(entity).flush()
      return { id: entity.id }
    })
  },
  captureAfter: async (input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return result?.id ? loadDocumentAddressSnapshot(em, result.id, input) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as DocumentAddressSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.document_addresses.create', 'Add document address'),
      resourceKind: 'sales.document_address',
      resourceId: result.id,
      parentResourceKind: after.documentKind === 'order' ? 'sales.order' : 'sales.quote',
      parentResourceId: after.documentId,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } satisfies DocumentAddressUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<DocumentAddressUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    ensureTenantScope(ctx, after.tenantId)
    ensureOrganizationScope(ctx, after.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: after.tenantId, organizationId: after.organizationId }
    const entity = await findOneWithDecryption(em, SalesDocumentAddress, { id: after.id, ...scope }, {}, scope)
    if (!entity) return
    await em.remove(entity).flush()
    await emitDocumentAddressIndexSideEffects(ctx, 'deleted', after)
  },
}

const updateDocumentAddress: CommandHandler<DocumentAddressUpdateInput, { id: string }> = {
  id: 'sales.document-addresses.update',
  async execute(rawInput, ctx) {
    const input = documentAddressUpdateSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const rootEm = (ctx.container.resolve('em') as EntityManager).fork()
    return rootEm.transactional(async (em) => {
      const document = await requireDocument(em, input.documentKind, input.documentId, input.organizationId, input.tenantId)
      const entity = await lockDocumentAddress(em, ctx, input)
      const before = snapshotDocumentAddress(entity)
      const nextAddressId = input.addressLine1 === undefined && input.customerAddressId === undefined
        ? entity.customerAddressId ?? null
        : input.customerAddressId ?? null
      const customValues = await resolveAdditionalAddressValues(em, ctx, document, input, nextAddressId, entity)
      if (customValues !== undefined) {
        entity.customValues = customValues
        entity.updatedAt = new Date()
      }
      entity.customerAddressId = nextAddressId
      if (input.addressLine1 !== undefined) {
        entity.name = input.name ?? null
        entity.purpose = input.purpose ?? null
        entity.companyName = input.companyName ?? null
        entity.addressLine1 = input.addressLine1
        entity.addressLine2 = input.addressLine2 ?? null
        entity.buildingNumber = input.buildingNumber ?? null
        entity.flatNumber = input.flatNumber ?? null
        entity.city = input.city ?? null
        entity.region = input.region ?? null
        entity.postalCode = input.postalCode ?? null
        entity.country = input.country ?? null
        entity.latitude = input.latitude ?? null
        entity.longitude = input.longitude ?? null
      }
      await em.flush()
      const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
      const refreshed = assertFound(await findOneWithDecryption(
        em, SalesDocumentAddress, { id: entity.id, ...scope }, { refresh: true }, scope,
      ), 'sales.document.address.not_found')
      const result = { id: entity.id }
      lockedAddressUpdates.set(result, { before, after: snapshotDocumentAddress(refreshed) })
      return result
    })
  },
  captureAfter: async (_input, result) => lockedAddressUpdates.get(result)?.after ?? null,
  buildLog: async ({ result }) => {
    const snapshots = lockedAddressUpdates.get(result)
    if (!snapshots) return null
    const { before, after } = snapshots
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.document_addresses.update', 'Update document address'),
      resourceKind: 'sales.document_address',
      resourceId: result.id,
      parentResourceKind: after.documentKind === 'order' ? 'sales.order' : 'sales.quote',
      parentResourceId: after.documentId,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: { undo: { before, after } satisfies DocumentAddressUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<DocumentAddressUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    const scope = { tenantId: before.tenantId, organizationId: before.organizationId }
    const after = payload?.after
    const changed = after != null && !isDeepStrictEqual(before.addressCustomValues ?? null, after.addressCustomValues ?? null)
    const rootEm = (ctx.container.resolve('em') as EntityManager).fork()
    await rootEm.transactional(async (em) => {
      const table = before.documentKind === 'order' ? 'sales_orders' : 'sales_quotes'
      const locked = await lockSalesDocumentRow(em, table, before.documentId, scope)
      const existing = locked
        ? await findOneWithDecryption(
            em, SalesDocumentAddress,
            { id: before.id, documentId: before.documentId, documentKind: before.documentKind, deletedAt: null, ...scope },
            { lockMode: LockMode.PESSIMISTIC_WRITE }, scope,
          )
        : null
      if (!locked || (changed && (!existing || !isDeepStrictEqual(readAddressCustomValues(existing.customValues), after?.addressCustomValues ?? null)))) {
        const { translate } = await resolveTranslations()
        const key = before.documentKind === 'order' ? 'sales.documents.errors.undoStaleOrder' : 'sales.documents.errors.undoStaleQuote'
        throw new CrudHttpError(409, { error: translate(key) })
      }
      const entity = existing ?? em.create(SalesDocumentAddress, { id: before.id } as Partial<SalesDocumentAddress>)
      await applyDocumentAddressSnapshot(em, ctx, entity, before, changed)
      await em.persist(entity).flush()
    })
    await emitDocumentAddressIndexSideEffects(ctx, 'updated', before)
  },
}

const deleteDocumentAddress: CommandHandler<
  DocumentAddressDeleteInput,
  { ok: true; id: string }
> = {
  id: 'sales.document-addresses.delete',
  async prepare(rawInput, ctx) {
    const parsed = documentAddressDeleteSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadDocumentAddressSnapshot(em, parsed.id, parsed)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const input = documentAddressDeleteSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const rootEm = (ctx.container.resolve('em') as EntityManager).fork()
    return rootEm.transactional(async (em) => {
      await requireDocument(em, input.documentKind, input.documentId, input.organizationId, input.tenantId)
      const entity = await lockDocumentAddress(em, ctx, input)
      await em.remove(entity).flush()
      return { ok: true, id: input.id }
    })
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as DocumentAddressSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.document_addresses.delete', 'Remove document address'),
      resourceKind: 'sales.document_address',
      resourceId: result.id,
      parentResourceKind: before.documentKind === 'order' ? 'sales.order' : 'sales.quote',
      parentResourceId: before.documentId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } satisfies DocumentAddressUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<DocumentAddressUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: before.tenantId, organizationId: before.organizationId }
    const existing = await findOneWithDecryption(em, SalesDocumentAddress, { id: before.id, ...scope }, {}, scope)
    const entity = existing ?? em.create(SalesDocumentAddress, { id: before.id } as Partial<SalesDocumentAddress>)
    await applyDocumentAddressSnapshot(em, ctx, entity, before, before.addressCustomValues !== undefined)
    await em.persist(entity).flush()
    await emitDocumentAddressIndexSideEffects(ctx, 'created', before)
  },
}

export const documentAddressCommands = [createDocumentAddress, updateDocumentAddress, deleteDocumentAddress]

registerCommand(createDocumentAddress)
registerCommand(updateDocumentAddress)
registerCommand(deleteDocumentAddress)
