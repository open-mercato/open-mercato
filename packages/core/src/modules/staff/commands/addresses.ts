import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { makeAddressCommandSet } from '@open-mercato/shared/lib/commands/timeline'
import { StaffTeamMemberAddress } from '../data/entities'
import {
  staffTeamMemberAddressCreateSchema,
  staffTeamMemberAddressUpdateSchema,
  type StaffTeamMemberAddressCreateInput,
  type StaffTeamMemberAddressUpdateInput,
} from '../data/validators'
import { staffTeamMemberAddressCrudEvents } from '../lib/crud'
import {
  applyScopeToWhere,
  commandActorScope,
  commandInputScope,
  ensureOrganizationScope,
  ensureTenantScope,
  explicitStaffCommandScope,
  requireTeamMember,
  scopedStaffSnapshotWhere,
  staffSnapshotScopeFromContext,
  staffSnapshotScopeFromSnapshot,
  type StaffSnapshotScope,
} from './shared'
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

async function loadAddressSnapshot(em: EntityManager, id: string, scope?: StaffSnapshotScope | null): Promise<AddressSnapshot | null> {
  const address = await em.findOne(StaffTeamMemberAddress, scopedStaffSnapshotWhere(id, scope))
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

const addressCommands = makeAddressCommandSet<
  StaffTeamMemberAddress,
  AddressSnapshot,
  StaffTeamMemberAddressCreateInput,
  StaffTeamMemberAddressUpdateInput
>({
  commandIds: {
    create: 'staff.team-member-addresses.create',
    update: 'staff.team-member-addresses.update',
    delete: 'staff.team-member-addresses.delete',
  },
  resourceKind: 'staff.team_member_address',
  auditLabels: {
    create: ['staff.audit.teamMemberAddresses.create', 'Create address'],
    update: ['staff.audit.teamMemberAddresses.update', 'Update address'],
    delete: ['staff.audit.teamMemberAddresses.delete', 'Delete address'],
  },
  changeKeys: [
    'memberId', 'name', 'purpose', 'companyName', 'addressLine1', 'addressLine2',
    'buildingNumber', 'flatNumber', 'city', 'region', 'postalCode', 'country',
    'latitude', 'longitude', 'isPrimary',
  ],
  messages: {
    notFound: 'Address not found',
    idRequired: 'Address id required',
    redoUnavailable: '[internal] redo snapshot unavailable for address create',
  },
  entityClass: StaffTeamMemberAddress,
  indexer: addressCrudIndexer,
  events: staffTeamMemberAddressCrudEvents,
  schemas: { create: staffTeamMemberAddressCreateSchema, update: staffTeamMemberAddressUpdateSchema },
  // Non-transactional: a failure between the row write and the demotion can leave the
  // member with two primary addresses.
  atomicWrites: false,

  // Every staff snapshot read and row lookup carries tenant/org scope (#3977).
  loadSnapshot: (em, id, ctx) => loadAddressSnapshot(em, id, staffSnapshotScopeFromContext(ctx)),
  findRowForWrite: (em, id, ctx) =>
    em.findOne(StaffTeamMemberAddress, applyScopeToWhere<StaffTeamMemberAddress>({ id }, commandActorScope(ctx))),
  findRowForRestore: ({ em, id, snapshot }) =>
    em.findOne(StaffTeamMemberAddress, scopedStaffSnapshotWhere(id, staffSnapshotScopeFromSnapshot(snapshot))),
  createUndoTargetId: ({ logEntryResourceId, after }) => after?.id ?? logEntryResourceId,

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
    const member = await requireTeamMember(
      em,
      parsed.entityId,
      commandInputScope(ctx, parsed.tenantId, parsed.organizationId),
      'Team member not found',
    )
    ensureTenantScope(ctx, member.tenantId)
    ensureOrganizationScope(ctx, member.organizationId)
    return { relations: { member }, parentId: member.id }
  },
  resolveParentForRestore: async ({ em, snapshot }) => {
    const member = await requireTeamMember(
      em,
      snapshot.memberId,
      explicitStaffCommandScope(snapshot.tenantId, snapshot.organizationId),
      'Team member not found',
    )
    return { relations: { member }, parentId: snapshot.memberId }
  },
  primaryParentIdOfEntity: (address) => (typeof address.member === 'string' ? address.member : address.member.id),
  enforcePrimary: async (em, parentId, addressId) => {
    await em.nativeUpdate(
      StaffTeamMemberAddress,
      { member: parentId, id: { $ne: addressId }, isPrimary: true },
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
      const member = await requireTeamMember(em, parsed.entityId, commandActorScope(ctx), 'Team member not found')
      ensureTenantScope(ctx, member.tenantId)
      ensureOrganizationScope(ctx, member.organizationId)
      entity.member = member
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
    parentResourceKind: 'staff.teamMember',
    parentResourceId: snapshot.memberId ?? null,
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
