// @ts-nocheck

import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  documentAddressCreateSchema,
  documentAddressDeleteSchema,
  documentAddressUpdateSchema,
  type DocumentAddressCreateInput,
  type DocumentAddressDeleteInput,
  type DocumentAddressUpdateInput,
} from '../data/validators'
import { SalesDocumentAddress, SalesOrder, SalesQuote } from '../data/entities'
import { ensureOrganizationScope, ensureSameScope, ensureTenantScope, assertFound, extractUndoPayload } from './shared'
import { loadSalesSettings } from './settings'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'

const DOCUMENT_ADDRESS_ENTITY_TYPE = E.sales.sales_document_address

type DocumentAddressSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  documentId: string
  documentKind: 'order' | 'quote'
  customerAddressId: string | null
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

function snapshotDocumentAddress(entity: SalesDocumentAddress): DocumentAddressSnapshot {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    tenantId: entity.tenantId,
    documentId: entity.documentId,
    documentKind: entity.documentKind as 'order' | 'quote',
    customerAddressId: entity.customerAddressId ?? null,
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
  id: string
): Promise<DocumentAddressSnapshot | null> {
  const entity = await em.findOne(SalesDocumentAddress, { id })
  return entity ? snapshotDocumentAddress(entity) : null
}

function applyDocumentAddressSnapshot(em: EntityManager, entity: SalesDocumentAddress, snapshot: DocumentAddressSnapshot): void {
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
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity: snapshot,
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
  const doc = await em.findOne(repo, { id, organizationId, tenantId })
  if (!doc) {
    throw new CrudHttpError(404, { error: 'sales.document.not_found' })
  }
  return doc
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

const createDocumentAddress: CommandHandler<DocumentAddressCreateInput, { id: string }> = {
  id: 'sales.document-addresses.create',
  async execute(rawInput, ctx) {
    const input = documentAddressCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const document = await requireDocument(em, input.documentKind, input.documentId, input.organizationId, input.tenantId)
    if (input.documentKind === 'order') {
      await assertAddressEditable(em, {
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        status: (document as SalesOrder).status ?? null,
      })
    }

    const entity = em.create(SalesDocumentAddress, {
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
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return result?.id ? loadDocumentAddressSnapshot(em, result.id) : null
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
    const entity = await em.findOne(SalesDocumentAddress, { id: after.id })
    if (!entity) return
    await em.remove(entity).flush()
    await emitDocumentAddressIndexSideEffects(ctx, 'deleted', after)
  },
}

const updateDocumentAddress: CommandHandler<DocumentAddressUpdateInput, { id: string }> = {
  id: 'sales.document-addresses.update',
  async prepare(rawInput, ctx) {
    const parsed = documentAddressUpdateSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadDocumentAddressSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const input = documentAddressUpdateSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entity = assertFound(
      await em.findOne(SalesDocumentAddress, { id: input.id }),
      'sales.document.address.not_found'
    )
    ensureSameScope(entity, input.organizationId, input.tenantId)
    const document = await requireDocument(em, input.documentKind, input.documentId, input.organizationId, input.tenantId)
    if (input.documentKind === 'order') {
      await assertAddressEditable(em, {
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        status: (document as SalesOrder).status ?? null,
      })
    }

    entity.documentId = input.documentId
    entity.documentKind = input.documentKind
    entity.customerAddressId = input.customerAddressId ?? null
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

    await em.flush()
    return { id: entity.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return result?.id ? loadDocumentAddressSnapshot(em, result.id) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as DocumentAddressSnapshot | undefined
    const after = snapshots.after as DocumentAddressSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.document_addresses.update', 'Update document address'),
      resourceKind: 'sales.document_address',
      resourceId: result.id,
      parentResourceKind: after.documentKind === 'order' ? 'sales.order' : 'sales.quote',
      parentResourceId: after.documentId,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? null,
      snapshotAfter: after,
      payload: { undo: { before: before ?? null, after } satisfies DocumentAddressUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<DocumentAddressUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entity =
      (await em.findOne(SalesDocumentAddress, { id: before.id })) ??
      em.create(SalesDocumentAddress, { id: before.id } as Partial<SalesDocumentAddress>)
    applyDocumentAddressSnapshot(em, entity, before)
    await em.persist(entity).flush()
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
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadDocumentAddressSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const input = documentAddressDeleteSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entity = assertFound(
      await em.findOne(SalesDocumentAddress, { id: input.id }),
      'sales.document.address.not_found'
    )
    ensureSameScope(entity, input.organizationId, input.tenantId)
    const document = await requireDocument(em, input.documentKind, input.documentId, input.organizationId, input.tenantId)
    if (input.documentKind === 'order') {
      await assertAddressEditable(em, {
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        status: (document as SalesOrder).status ?? null,
      })
    }
    await em.remove(entity).flush()
    return { ok: true, id: input.id }
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
    const existing = await em.findOne(SalesDocumentAddress, { id: before.id })
    const entity = existing ?? em.create(SalesDocumentAddress, { id: before.id } as Partial<SalesDocumentAddress>)
    applyDocumentAddressSnapshot(em, entity, before)
    await em.persist(entity).flush()
    await emitDocumentAddressIndexSideEffects(ctx, 'created', before)
  },
}

export const documentAddressCommands = [createDocumentAddress, updateDocumentAddress, deleteDocumentAddress]

registerCommand(createDocumentAddress)
registerCommand(updateDocumentAddress)
registerCommand(deleteDocumentAddress)
