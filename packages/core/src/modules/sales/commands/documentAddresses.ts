// @ts-nocheck

import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  documentAddressCreateSchema,
  documentAddressDeleteSchema,
  documentAddressUpdateSchema,
  type DocumentAddressCreateInput,
  type DocumentAddressUpdateInput,
} from '../data/validators'
import { SalesDocumentAddress, SalesOrder, SalesQuote } from '../data/entities'
import { ensureOrganizationScope, ensureSameScope, ensureTenantScope, assertFound } from './shared'
import { loadSalesSettings } from './settings'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

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
    await em.persistAndFlush(entity)
    return { id: entity.id }
  },
}

const updateDocumentAddress: CommandHandler<DocumentAddressUpdateInput, { id: string }> = {
  id: 'sales.document-addresses.update',
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
}

const deleteDocumentAddress: CommandHandler<
  { id: string; documentId: string; documentKind: 'order' | 'quote'; organizationId: string; tenantId: string },
  { ok: true }
> = {
  id: 'sales.document-addresses.delete',
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
    await em.removeAndFlush(entity)
    return { ok: true }
  },
}

export const documentAddressCommands = [createDocumentAddress, updateDocumentAddress, deleteDocumentAddress]

registerCommand(createDocumentAddress)
registerCommand(updateDocumentAddress)
registerCommand(deleteDocumentAddress)
