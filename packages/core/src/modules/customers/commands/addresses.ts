import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CrudIndexerConfig, CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { makeAddressCommandSet } from '@open-mercato/shared/lib/commands/timeline'
import { CustomerAddress } from '../data/entities'
import { addressCreateSchema, addressUpdateSchema, type AddressCreateInput, type AddressUpdateInput } from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  requireCustomerEntity,
  ensureSameScope,
  resolveParentResourceKind,
} from './shared'
import { E } from '#generated/entities.ids.generated'

const addressCrudIndexer: CrudIndexerConfig<CustomerAddress> = {
  entityType: E.customers.customer_address,
}

const addressCrudEvents: CrudEventsConfig = {
  module: 'customers',
  entity: 'address',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type AddressSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  entityId: string
  entityKind: string | null
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
  isPrimary: boolean
}

async function loadAddressSnapshot(em: EntityManager, id: string): Promise<AddressSnapshot | null> {
  const address = await em.findOne(CustomerAddress, { id }, { populate: ['entity'] })
  if (!address) return null
  const entityRef = address.entity
  const entityKind = (typeof entityRef === 'object' && entityRef !== null && 'kind' in entityRef)
    ? (entityRef as { kind: string }).kind
    : null
  return {
    id: address.id,
    organizationId: address.organizationId,
    tenantId: address.tenantId,
    entityId: typeof entityRef === 'string' ? entityRef : entityRef.id,
    entityKind,
    name: address.name ?? null,
    purpose: address.purpose ?? null,
    companyName: address.companyName ?? null,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2 ?? null,
    buildingNumber: address.buildingNumber ?? null,
    flatNumber: address.flatNumber ?? null,
    city: address.city ?? null,
    region: address.region ?? null,
    postalCode: address.postalCode ?? null,
    country: address.country ?? null,
    latitude: address.latitude ?? null,
    longitude: address.longitude ?? null,
    isPrimary: address.isPrimary,
  }
}

const addressCommands = makeAddressCommandSet<
  CustomerAddress,
  AddressSnapshot,
  AddressCreateInput,
  AddressUpdateInput
>({
  commandIds: {
    create: 'customers.addresses.create',
    update: 'customers.addresses.update',
    delete: 'customers.addresses.delete',
  },
  resourceKind: 'customers.address',
  auditLabels: {
    create: ['customers.audit.addresses.create', 'Create address'],
    update: ['customers.audit.addresses.update', 'Update address'],
    delete: ['customers.audit.addresses.delete', 'Delete address'],
  },
  changeKeys: [
    'entityId', 'name', 'purpose', 'companyName', 'addressLine1', 'addressLine2',
    'buildingNumber', 'flatNumber', 'city', 'region', 'postalCode', 'country',
    'latitude', 'longitude', 'isPrimary',
  ],
  messages: {
    notFound: 'Address not found',
    idRequired: 'Address id required',
    redoUnavailable: '[internal] redo snapshot unavailable for address create',
  },
  entityClass: CustomerAddress,
  indexer: addressCrudIndexer,
  events: addressCrudEvents,
  schemas: { create: addressCreateSchema, update: addressUpdateSchema },
  atomicWrites: true,

  loadSnapshot: (em, id) => loadAddressSnapshot(em, id),
  findRowForWrite: (em, id) => em.findOne(CustomerAddress, { id }),
  createUndoTargetId: ({ logEntryResourceId }) => logEntryResourceId,

  seedFromSnapshot: (snapshot) => ({
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    name: snapshot.name,
    purpose: snapshot.purpose,
    companyName: snapshot.companyName,
    addressLine1: snapshot.addressLine1,
    addressLine2: snapshot.addressLine2,
    buildingNumber: snapshot.buildingNumber,
    flatNumber: snapshot.flatNumber,
    city: snapshot.city,
    region: snapshot.region,
    postalCode: snapshot.postalCode,
    country: snapshot.country,
    latitude: snapshot.latitude,
    longitude: snapshot.longitude,
    isPrimary: snapshot.isPrimary,
  }),
  assignFromSnapshot: (address, snapshot) => {
    address.name = snapshot.name
    address.purpose = snapshot.purpose
    address.companyName = snapshot.companyName
    address.addressLine1 = snapshot.addressLine1
    address.addressLine2 = snapshot.addressLine2
    address.buildingNumber = snapshot.buildingNumber
    address.flatNumber = snapshot.flatNumber
    address.city = snapshot.city
    address.region = snapshot.region
    address.postalCode = snapshot.postalCode
    address.country = snapshot.country
    address.latitude = snapshot.latitude
    address.longitude = snapshot.longitude
    address.isPrimary = snapshot.isPrimary
  },

  resolveParentForCreate: async ({ em, parsed, ctx }) => {
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const entity = await requireCustomerEntity(em, parsed.entityId, { tenantId: parsed.tenantId, organizationId: parsed.organizationId }, undefined, 'Customer not found')
    ensureSameScope(entity, parsed.organizationId, parsed.tenantId)
    return { relations: { entity }, parentId: entity.id }
  },
  resolveParentForRestore: async ({ em, snapshot }) => {
    const entity = await requireCustomerEntity(em, snapshot.entityId, { tenantId: snapshot.tenantId, organizationId: snapshot.organizationId }, undefined, 'Customer not found')
    return { relations: { entity }, parentId: snapshot.entityId }
  },
  primaryParentIdOfEntity: (address) => (typeof address.entity === 'string' ? address.entity : address.entity.id),
  enforcePrimary: async (em, parentId, addressId) => {
    await em.nativeUpdate(
      CustomerAddress,
      { entity: parentId, id: { $ne: addressId }, isPrimary: true },
      { isPrimary: false },
    )
  },

  buildCreateData: ({ parsed, relations }) => ({
    organizationId: parsed.organizationId,
    tenantId: parsed.tenantId,
    ...relations,
    name: parsed.name ?? null,
    purpose: parsed.purpose ?? null,
    companyName: parsed.companyName ?? null,
    addressLine1: parsed.addressLine1,
    addressLine2: parsed.addressLine2 ?? null,
    buildingNumber: parsed.buildingNumber ?? null,
    flatNumber: parsed.flatNumber ?? null,
    city: parsed.city ?? null,
    region: parsed.region ?? null,
    postalCode: parsed.postalCode ?? null,
    country: parsed.country ?? null,
    latitude: parsed.latitude ?? null,
    longitude: parsed.longitude ?? null,
    isPrimary: parsed.isPrimary ?? false,
  }),
  applyUpdateFields: async ({ em, ctx, entity, parsed }) => {
    if (parsed.entityId !== undefined) {
      const parent = await requireCustomerEntity(em, parsed.entityId, { tenantId: entity.tenantId, organizationId: entity.organizationId }, undefined, 'Customer not found')
      ensureSameScope(parent, entity.organizationId, entity.tenantId)
      entity.entity = parent
    }
    if (parsed.name !== undefined) entity.name = parsed.name ?? null
    if (parsed.purpose !== undefined) entity.purpose = parsed.purpose ?? null
    if (parsed.companyName !== undefined) entity.companyName = parsed.companyName ?? null
    if (parsed.addressLine1 !== undefined) entity.addressLine1 = parsed.addressLine1
    if (parsed.addressLine2 !== undefined) entity.addressLine2 = parsed.addressLine2 ?? null
    if (parsed.buildingNumber !== undefined) entity.buildingNumber = parsed.buildingNumber ?? null
    if (parsed.flatNumber !== undefined) entity.flatNumber = parsed.flatNumber ?? null
    if (parsed.city !== undefined) entity.city = parsed.city ?? null
    if (parsed.region !== undefined) entity.region = parsed.region ?? null
    if (parsed.postalCode !== undefined) entity.postalCode = parsed.postalCode ?? null
    if (parsed.country !== undefined) entity.country = parsed.country ?? null
    if (parsed.latitude !== undefined) entity.latitude = parsed.latitude ?? null
    if (parsed.longitude !== undefined) entity.longitude = parsed.longitude ?? null
    if (parsed.isPrimary !== undefined) entity.isPrimary = parsed.isPrimary
  },

  logMeta: (snapshot) => ({
    parentResourceKind: resolveParentResourceKind(snapshot.entityKind),
    parentResourceId: snapshot.entityId ?? null,
  }),
  ensureRowInScope: (ctx, address) => {
    ensureTenantScope(ctx, address.tenantId)
    ensureOrganizationScope(ctx, address.organizationId)
  },
  buildResult: {
    create: (address) => ({ addressId: address.id }),
    update: (address) => ({ addressId: address.id }),
    delete: (address) => ({ addressId: address.id }),
  },
})

registerCommand(addressCommands.create)
registerCommand(addressCommands.update)
registerCommand(addressCommands.delete)
