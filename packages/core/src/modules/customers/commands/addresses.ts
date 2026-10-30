import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects, buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerAddress } from '../data/entities'
import { addressCreateSchema, addressUpdateSchema, type AddressCreateInput, type AddressUpdateInput } from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  requireCustomerEntity,
  ensureSameScope,
  extractUndoPayload,
  resolveParentResourceKind,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudIndexerConfig, CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { resolveRedoSnapshot } from '@open-mercato/shared/lib/commands/redo'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

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

type DemotedPrimaryAddress = {
  id: string
  entityId: string
}

type AddressUndoPayload = {
  before?: AddressSnapshot | null
  after?: AddressSnapshot | null
  demotedPrimaryAddresses?: DemotedPrimaryAddress[]
}

type AddressCommandResult = {
  addressId: string
  demotedPrimaryAddresses?: DemotedPrimaryAddress[]
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

async function enforcePrimaryAddress(
  em: EntityManager,
  entityId: string,
  addressId: string,
): Promise<DemotedPrimaryAddress[]> {
  const otherPrimaries = { entity: entityId, id: { $ne: addressId }, isPrimary: true }
  const siblings = await em.find(CustomerAddress, otherPrimaries, { fields: ['id', 'tenantId', 'organizationId'] })
  await em.nativeUpdate(CustomerAddress, otherPrimaries, { isPrimary: false })
  return siblings.map((sibling) => ({ id: sibling.id, entityId }))
}

function resolveAddressEntityId(address: CustomerAddress): string {
  return typeof address.entity === 'string' ? address.entity : address.entity.id
}

const ADDRESS_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function readDemotedPrimaryAddressIds(demoted: unknown, entityId: string): string[] {
  if (!Array.isArray(demoted)) return []
  const ids: string[] = []
  for (const entry of demoted) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Partial<DemotedPrimaryAddress>
    if (typeof candidate.id !== 'string' || !ADDRESS_ID_PATTERN.test(candidate.id)) continue
    if (candidate.entityId !== entityId) continue
    ids.push(candidate.id)
  }
  return ids
}

/**
 * Hands the primary flag back to the addresses an undone create/update demoted. Callers only
 * invoke it when the undone address still held the flag, and it is a no-op as soon as the
 * customer has a primary address again, so a choice made after the operation is never replaced.
 * The write is native on purpose: the demotion was native too and left the sibling's
 * `updated_at` (its optimistic-lock version) untouched.
 */
async function restoreDemotedPrimaryAddresses(
  em: EntityManager,
  demoted: unknown,
  scope: { entityId: string; tenantId: string; organizationId: string },
): Promise<void> {
  const ids = readDemotedPrimaryAddressIds(demoted, scope.entityId)
  if (!ids.length) return
  const primaryCount = await em.count(CustomerAddress, { entity: scope.entityId, isPrimary: true })
  if (primaryCount > 0) return
  await em.nativeUpdate(
    CustomerAddress,
    {
      id: { $in: ids },
      entity: scope.entityId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      isPrimary: false,
    },
    { isPrimary: true },
  )
}

const createAddressCommand: CommandHandler<AddressCreateInput, AddressCommandResult> = {
  id: 'customers.addresses.create',
  async execute(rawInput, ctx) {
    const parsed = addressCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entity = await requireCustomerEntity(em, parsed.entityId, { tenantId: parsed.tenantId, organizationId: parsed.organizationId }, undefined, 'Customer not found')
    ensureSameScope(entity, parsed.organizationId, parsed.tenantId)

    const address = em.create(CustomerAddress, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      entity,
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
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    let demotedPrimaryAddresses: DemotedPrimaryAddress[] = []
    await withAtomicFlush(em, [
      async () => {
        em.persist(address)
        await em.flush()
        if (address.isPrimary) {
          demotedPrimaryAddresses = await enforcePrimaryAddress(em, entity.id, address.id)
        }
      },
    ], { transaction: true })

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: address,
      identifiers: {
        id: address.id,
        organizationId: address.organizationId,
        tenantId: address.tenantId,
      },
      indexer: addressCrudIndexer,
      events: addressCrudEvents,
    })

    return {
      addressId: address.id,
      ...(demotedPrimaryAddresses.length ? { demotedPrimaryAddresses } : {}),
    }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadAddressSnapshot(em, result.addressId)
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as AddressSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.addresses.create', 'Create address'),
      resourceKind: 'customers.address',
      resourceId: result.addressId,
      parentResourceKind: resolveParentResourceKind(snapshot?.entityKind),
      parentResourceId: snapshot?.entityId ?? null,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot ?? null,
          ...(result.demotedPrimaryAddresses?.length
            ? { demotedPrimaryAddresses: result.demotedPrimaryAddresses }
            : {}),
        } satisfies AddressUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const addressId = logEntry?.resourceId ?? null
    if (!addressId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const address = await em.findOne(CustomerAddress, { id: addressId })
    if (!address) return
    const payload = extractUndoPayload<AddressUndoPayload>(logEntry)
    const heldPrimary = address.isPrimary === true
    const scope = {
      entityId: resolveAddressEntityId(address),
      tenantId: address.tenantId,
      organizationId: address.organizationId,
    }
    await withAtomicFlush(em, [
      () => {
        em.remove(address)
      },
      async () => {
        if (heldPrimary) {
          await restoreDemotedPrimaryAddresses(em, payload?.demotedPrimaryAddresses, scope)
        }
      },
    ], { transaction: true })
  },
  redo: async ({ logEntry, ctx }) => {
    const after = resolveRedoSnapshot<AddressSnapshot>(logEntry)
    if (!after) {
      throw new CrudHttpError(400, { error: '[internal] redo snapshot unavailable for address create' })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entity = await requireCustomerEntity(em, after.entityId, { tenantId: after.tenantId, organizationId: after.organizationId }, undefined, 'Customer not found')
    let address = await findOneWithDecryption(
      em,
      CustomerAddress,
      { id: after.id },
      undefined,
      { tenantId: after.tenantId, organizationId: after.organizationId },
    )
    if (!address) {
      address = em.create(CustomerAddress, {
        id: after.id,
        organizationId: after.organizationId,
        tenantId: after.tenantId,
        entity,
        name: after.name,
        purpose: after.purpose,
        companyName: after.companyName,
        addressLine1: after.addressLine1,
        addressLine2: after.addressLine2,
        buildingNumber: after.buildingNumber,
        flatNumber: after.flatNumber,
        city: after.city,
        region: after.region,
        postalCode: after.postalCode,
        country: after.country,
        latitude: after.latitude,
        longitude: after.longitude,
        isPrimary: after.isPrimary,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(address)
    } else {
      address.entity = entity
      address.name = after.name
      address.purpose = after.purpose
      address.companyName = after.companyName
      address.addressLine1 = after.addressLine1
      address.addressLine2 = after.addressLine2
      address.buildingNumber = after.buildingNumber
      address.flatNumber = after.flatNumber
      address.city = after.city
      address.region = after.region
      address.postalCode = after.postalCode
      address.country = after.country
      address.latitude = after.latitude
      address.longitude = after.longitude
      address.isPrimary = after.isPrimary
    }
    const restoredAddress = address
    let demotedPrimaryAddresses: DemotedPrimaryAddress[] = []
    await withAtomicFlush(em, [
      async () => {
        em.persist(restoredAddress)
        await em.flush()
        if (after.isPrimary) {
          demotedPrimaryAddresses = await enforcePrimaryAddress(em, after.entityId, after.id)
        }
      },
    ], { transaction: true })

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: restoredAddress,
      identifiers: {
        id: restoredAddress.id,
        organizationId: restoredAddress.organizationId,
        tenantId: restoredAddress.tenantId,
      },
      indexer: addressCrudIndexer,
      events: addressCrudEvents,
    })

    return {
      addressId: restoredAddress.id,
      ...(demotedPrimaryAddresses.length ? { demotedPrimaryAddresses } : {}),
    }
  },
}

const updateAddressCommand: CommandHandler<AddressUpdateInput, AddressCommandResult> = {
  id: 'customers.addresses.update',
  async prepare(rawInput, ctx) {
    const parsed = addressUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadAddressSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = addressUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const address = await em.findOne(CustomerAddress, { id: parsed.id })
    if (!address) throw notFound('Address not found')
    ensureTenantScope(ctx, address.tenantId)
    ensureOrganizationScope(ctx, address.organizationId)

    if (parsed.entityId !== undefined) {
      const entity = await requireCustomerEntity(em, parsed.entityId, { tenantId: address.tenantId, organizationId: address.organizationId }, undefined, 'Customer not found')
      ensureSameScope(entity, address.organizationId, address.tenantId)
      address.entity = entity
    }

    let demotedPrimaryAddresses: DemotedPrimaryAddress[] = []
    await withAtomicFlush(em, [
      () => {
        if (parsed.name !== undefined) address.name = parsed.name ?? null
        if (parsed.purpose !== undefined) address.purpose = parsed.purpose ?? null
        if (parsed.companyName !== undefined) address.companyName = parsed.companyName ?? null
        if (parsed.addressLine1 !== undefined) address.addressLine1 = parsed.addressLine1
        if (parsed.addressLine2 !== undefined) address.addressLine2 = parsed.addressLine2 ?? null
        if (parsed.buildingNumber !== undefined) address.buildingNumber = parsed.buildingNumber ?? null
        if (parsed.flatNumber !== undefined) address.flatNumber = parsed.flatNumber ?? null
        if (parsed.city !== undefined) address.city = parsed.city ?? null
        if (parsed.region !== undefined) address.region = parsed.region ?? null
        if (parsed.postalCode !== undefined) address.postalCode = parsed.postalCode ?? null
        if (parsed.country !== undefined) address.country = parsed.country ?? null
        if (parsed.latitude !== undefined) address.latitude = parsed.latitude ?? null
        if (parsed.longitude !== undefined) address.longitude = parsed.longitude ?? null
        if (parsed.isPrimary !== undefined) address.isPrimary = parsed.isPrimary
      },
      async () => {
        if (address.isPrimary) {
          demotedPrimaryAddresses = await enforcePrimaryAddress(em, resolveAddressEntityId(address), address.id)
        }
      },
    ], { transaction: true })

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: address,
      identifiers: {
        id: address.id,
        organizationId: address.organizationId,
        tenantId: address.tenantId,
      },
      indexer: addressCrudIndexer,
      events: addressCrudEvents,
    })

    return {
      addressId: address.id,
      ...(demotedPrimaryAddresses.length ? { demotedPrimaryAddresses } : {}),
    }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadAddressSnapshot(em, result.addressId)
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as AddressSnapshot | undefined
    if (!before) return null
    const afterSnapshot = snapshots.after as AddressSnapshot | undefined
    const changes =
      afterSnapshot && before
        ? buildChanges(
            before as unknown as Record<string, unknown>,
            afterSnapshot as unknown as Record<string, unknown>,
            [
              'entityId',
              'name',
              'purpose',
              'companyName',
              'addressLine1',
              'addressLine2',
              'buildingNumber',
              'flatNumber',
              'city',
              'region',
              'postalCode',
              'country',
              'latitude',
              'longitude',
              'isPrimary',
            ]
          )
        : {}
    return {
      actionLabel: translate('customers.audit.addresses.update', 'Update address'),
      resourceKind: 'customers.address',
      resourceId: before.id,
      parentResourceKind: resolveParentResourceKind(before.entityKind),
      parentResourceId: before.entityId ?? null,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: afterSnapshot ?? null,
      changes,
      payload: {
        undo: {
          before,
          after: afterSnapshot ?? null,
          ...(result.demotedPrimaryAddresses?.length
            ? { demotedPrimaryAddresses: result.demotedPrimaryAddresses }
            : {}),
        } satisfies AddressUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AddressUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let address = await em.findOne(CustomerAddress, { id: before.id })
    const primaryHeldForEntityId = address?.isPrimary === true ? resolveAddressEntityId(address) : null
    const entity = await requireCustomerEntity(em, before.entityId, { tenantId: before.tenantId, organizationId: before.organizationId }, undefined, 'Customer not found')
    if (!address) {
      address = em.create(CustomerAddress, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        entity,
        name: before.name,
        purpose: before.purpose,
        companyName: before.companyName,
        addressLine1: before.addressLine1,
        addressLine2: before.addressLine2,
        buildingNumber: before.buildingNumber,
        flatNumber: before.flatNumber,
        city: before.city,
        region: before.region,
        postalCode: before.postalCode,
        country: before.country,
        latitude: before.latitude,
        longitude: before.longitude,
        isPrimary: before.isPrimary,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(address)
    } else {
      address.entity = entity
      address.name = before.name
      address.purpose = before.purpose
      address.companyName = before.companyName
      address.addressLine1 = before.addressLine1
      address.addressLine2 = before.addressLine2
      address.buildingNumber = before.buildingNumber
      address.flatNumber = before.flatNumber
      address.city = before.city
      address.region = before.region
      address.postalCode = before.postalCode
      address.country = before.country
      address.latitude = before.latitude
      address.longitude = before.longitude
      address.isPrimary = before.isPrimary
    }
    await withAtomicFlush(em, [
      async () => {
        em.persist(address)
        await em.flush()
        if (before.isPrimary) {
          await enforcePrimaryAddress(em, before.entityId, before.id)
        }
        if (primaryHeldForEntityId) {
          await restoreDemotedPrimaryAddresses(em, payload?.demotedPrimaryAddresses, {
            entityId: primaryHeldForEntityId,
            tenantId: before.tenantId,
            organizationId: before.organizationId,
          })
        }
      },
    ], { transaction: true })

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: address,
      identifiers: {
        id: address.id,
        organizationId: address.organizationId,
        tenantId: address.tenantId,
      },
      indexer: addressCrudIndexer,
      events: addressCrudEvents,
    })
  },
}

const deleteAddressCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { addressId: string }> =
  {
    id: 'customers.addresses.delete',
    async prepare(input, ctx) {
      const id = requireId(input, 'Address id required')
      const em = (ctx.container.resolve('em') as EntityManager)
      const snapshot = await loadAddressSnapshot(em, id)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Address id required')
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const address = await em.findOne(CustomerAddress, { id })
      if (!address) throw notFound('Address not found')
      ensureTenantScope(ctx, address.tenantId)
      ensureOrganizationScope(ctx, address.organizationId)
      em.remove(address)
      await em.flush()

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudSideEffects({
        dataEngine: de,
        action: 'deleted',
        entity: address,
        identifiers: {
          id: address.id,
          organizationId: address.organizationId,
          tenantId: address.tenantId,
        },
        indexer: addressCrudIndexer,
        events: addressCrudEvents,
      })
      return { addressId: address.id }
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as AddressSnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate('customers.audit.addresses.delete', 'Delete address'),
        resourceKind: 'customers.address',
        resourceId: before.id,
        parentResourceKind: resolveParentResourceKind(before.entityKind),
        parentResourceId: before.entityId ?? null,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        snapshotBefore: before,
        payload: {
          undo: {
            before,
          } satisfies AddressUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = extractUndoPayload<AddressUndoPayload>(logEntry)
      const before = payload?.before
      if (!before) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const entity = await requireCustomerEntity(em, before.entityId, { tenantId: before.tenantId, organizationId: before.organizationId }, undefined, 'Customer not found')
      let address = await em.findOne(CustomerAddress, { id: before.id })
      if (!address) {
        address = em.create(CustomerAddress, {
          id: before.id,
          organizationId: before.organizationId,
          tenantId: before.tenantId,
          entity,
          name: before.name,
          purpose: before.purpose,
          companyName: before.companyName,
          addressLine1: before.addressLine1,
          addressLine2: before.addressLine2,
          buildingNumber: before.buildingNumber,
          flatNumber: before.flatNumber,
          city: before.city,
          region: before.region,
          postalCode: before.postalCode,
          country: before.country,
          latitude: before.latitude,
          longitude: before.longitude,
          isPrimary: before.isPrimary,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        em.persist(address)
      } else {
        address.entity = entity
        address.name = before.name
        address.purpose = before.purpose
        address.addressLine1 = before.addressLine1
        address.addressLine2 = before.addressLine2
        address.buildingNumber = before.buildingNumber
        address.flatNumber = before.flatNumber
        address.city = before.city
        address.region = before.region
        address.postalCode = before.postalCode
        address.country = before.country
        address.latitude = before.latitude
        address.longitude = before.longitude
        address.isPrimary = before.isPrimary
      }
      await withAtomicFlush(em, [
        async () => {
          em.persist(address)
          await em.flush()
          if (before.isPrimary) {
            await enforcePrimaryAddress(em, before.entityId, before.id)
          }
        },
      ], { transaction: true })

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'created',
        entity: address,
        identifiers: {
          id: address.id,
          organizationId: address.organizationId,
          tenantId: address.tenantId,
        },
        indexer: addressCrudIndexer,
        events: addressCrudEvents,
      })
    },
  }

registerCommand(createAddressCommand)
registerCommand(updateAddressCommand)
registerCommand(deleteAddressCommand)
