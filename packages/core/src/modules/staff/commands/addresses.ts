import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects, buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { StaffTeamMemberAddress } from '../data/entities'
import {
  staffTeamMemberAddressCreateSchema,
  staffTeamMemberAddressUpdateSchema,
  type StaffTeamMemberAddressCreateInput,
  type StaffTeamMemberAddressUpdateInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  requireTeamMember,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'

const addressCrudIndexer: CrudIndexerConfig<StaffTeamMemberAddress> = {
  entityType: E.staff.staff_team_member_address,
}

type AddressSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  memberId: string
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

type AddressUndoPayload = {
  before?: AddressSnapshot | null
  after?: AddressSnapshot | null
}

async function loadAddressSnapshot(em: EntityManager, id: string): Promise<AddressSnapshot | null> {
  const address = await em.findOne(StaffTeamMemberAddress, { id })
  if (!address) return null
  return {
    id: address.id,
    organizationId: address.organizationId,
    tenantId: address.tenantId,
    memberId: typeof address.member === 'string' ? address.member : address.member.id,
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

async function enforcePrimaryAddress(em: EntityManager, memberId: string, addressId: string): Promise<void> {
  await em.nativeUpdate(
    StaffTeamMemberAddress,
    { member: memberId, id: { $ne: addressId }, isPrimary: true },
    { isPrimary: false }
  )
}

const createAddressCommand: CommandHandler<StaffTeamMemberAddressCreateInput, { addressId: string }> = {
  id: 'staff.team-member-addresses.create',
  async execute(rawInput, ctx) {
    const parsed = staffTeamMemberAddressCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const member = await requireTeamMember(em, parsed.entityId, 'Team member not found')
    ensureTenantScope(ctx, member.tenantId)
    ensureOrganizationScope(ctx, member.organizationId)

    const address = em.create(StaffTeamMemberAddress, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      member,
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
    em.persist(address)
    await em.flush()

    if (address.isPrimary) {
      await enforcePrimaryAddress(em, member.id, address.id)
      await em.flush()
    }

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
    })

    return { addressId: address.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadAddressSnapshot(em, result.addressId)
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as AddressSnapshot | undefined
    return {
      actionLabel: translate('staff.audit.teamMemberAddresses.create', 'Create address'),
      resourceKind: 'staff.team_member_address',
      resourceId: result.addressId,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot ?? null,
        } satisfies AddressUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const addressId = logEntry?.resourceId ?? null
    if (!addressId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const address = await em.findOne(StaffTeamMemberAddress, { id: addressId })
    if (address) {
      em.remove(address)
      await em.flush()
    }
  },
}

const updateAddressCommand: CommandHandler<StaffTeamMemberAddressUpdateInput, { addressId: string }> = {
  id: 'staff.team-member-addresses.update',
  async prepare(rawInput, ctx) {
    const parsed = staffTeamMemberAddressUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadAddressSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = staffTeamMemberAddressUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const address = await em.findOne(StaffTeamMemberAddress, { id: parsed.id })
    if (!address) throw new CrudHttpError(404, { error: 'Address not found' })
    ensureTenantScope(ctx, address.tenantId)
    ensureOrganizationScope(ctx, address.organizationId)

    if (parsed.entityId !== undefined) {
      const member = await requireTeamMember(em, parsed.entityId, 'Team member not found')
      ensureTenantScope(ctx, member.tenantId)
      ensureOrganizationScope(ctx, member.organizationId)
      address.member = member
    }
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

    await em.flush()

    if (address.isPrimary) {
      await enforcePrimaryAddress(em, typeof address.member === 'string' ? address.member : address.member.id, address.id)
      await em.flush()
    }

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
    })

    return { addressId: address.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadAddressSnapshot(em, result.addressId)
  },
  buildLog: async ({ snapshots }) => {
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
              'memberId',
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
            ],
          )
        : {}
    return {
      actionLabel: translate('staff.audit.teamMemberAddresses.update', 'Update address'),
      resourceKind: 'staff.team_member_address',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: afterSnapshot ?? null,
      changes,
      payload: {
        undo: {
          before,
          after: afterSnapshot ?? null,
        } satisfies AddressUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AddressUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let address = await em.findOne(StaffTeamMemberAddress, { id: before.id })
    const member = await requireTeamMember(em, before.memberId, 'Team member not found')

    if (!address) {
      address = em.create(StaffTeamMemberAddress, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        member,
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
      address.member = member
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
    await em.flush()
    if (before.isPrimary) {
      await enforcePrimaryAddress(em, before.memberId, before.id)
      await em.flush()
    }

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
    })
  },
}

const deleteAddressCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { addressId: string }> =
  {
    id: 'staff.team-member-addresses.delete',
    async prepare(input, ctx) {
      const id = requireId(input, 'Address id required')
      const em = (ctx.container.resolve('em') as EntityManager)
      const snapshot = await loadAddressSnapshot(em, id)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Address id required')
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const address = await em.findOne(StaffTeamMemberAddress, { id })
      if (!address) throw new CrudHttpError(404, { error: 'Address not found' })
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
      })
      return { addressId: address.id }
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as AddressSnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate('staff.audit.teamMemberAddresses.delete', 'Delete address'),
        resourceKind: 'staff.team_member_address',
        resourceId: before.id,
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
      const member = await requireTeamMember(em, before.memberId, 'Team member not found')
      let address = await em.findOne(StaffTeamMemberAddress, { id: before.id })
      if (!address) {
        address = em.create(StaffTeamMemberAddress, {
          id: before.id,
          organizationId: before.organizationId,
          tenantId: before.tenantId,
          member,
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
        address.member = member
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
      await em.flush()
      if (before.isPrimary) {
        await enforcePrimaryAddress(em, before.memberId, before.id)
        await em.flush()
      }

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
      })
    },
  }

registerCommand(createAddressCommand)
registerCommand(updateAddressCommand)
registerCommand(deleteAddressCommand)
