import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { BookingEvent, BookingEventAttendee } from '../data/entities'
import {
  bookingEventAttendeeCreateSchema,
  bookingEventAttendeeUpdateSchema,
  type BookingEventAttendeeCreateInput,
  type BookingEventAttendeeUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { E } from '@/generated/entities.ids.generated'

type AttendeeSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  eventId: string
  customerId: string | null
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
  attendeeType: string | null
  externalRef: string | null
  tags: string[]
  notes: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

type AttendeeUndoPayload = {
  before?: AttendeeSnapshot
  after?: AttendeeSnapshot
}

function mapAttendeeSnapshot(attendee: BookingEventAttendee): AttendeeSnapshot {
  return {
    id: attendee.id,
    tenantId: attendee.tenantId,
    organizationId: attendee.organizationId,
    eventId: attendee.eventId,
    customerId: attendee.customerId ?? null,
    firstName: attendee.firstName,
    lastName: attendee.lastName,
    email: attendee.email ?? null,
    phone: attendee.phone ?? null,
    addressLine1: attendee.addressLine1 ?? null,
    addressLine2: attendee.addressLine2 ?? null,
    city: attendee.city ?? null,
    region: attendee.region ?? null,
    postalCode: attendee.postalCode ?? null,
    country: attendee.country ?? null,
    attendeeType: attendee.attendeeType ?? null,
    externalRef: attendee.externalRef ?? null,
    tags: Array.isArray(attendee.tags) ? attendee.tags : [],
    notes: attendee.notes ?? null,
    createdAt: attendee.createdAt.toISOString(),
    updatedAt: attendee.updatedAt.toISOString(),
    deletedAt: attendee.deletedAt ? attendee.deletedAt.toISOString() : null,
  }
}

async function loadAttendeeSnapshot(em: EntityManager, id: string): Promise<AttendeeSnapshot | null> {
  const attendee = await findOneWithDecryption(
    em,
    BookingEventAttendee,
    { id },
    undefined,
    { tenantId: null, organizationId: null },
  )
  if (!attendee) return null
  return mapAttendeeSnapshot(attendee)
}

async function ensureEventExists(
  em: EntityManager,
  input: { eventId: string; tenantId: string; organizationId: string },
) {
  const event = await findOneWithDecryption(
    em,
    BookingEvent,
    {
      id: input.eventId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
  if (!event) {
    throw new CrudHttpError(404, { error: 'Booking event not found.' })
  }
}

async function ensureCustomerExists(
  em: EntityManager,
  input: { customerId?: string | null; tenantId: string; organizationId: string },
) {
  if (!input.customerId) return
  const customer = await findOneWithDecryption(
    em,
    CustomerEntity,
    {
      id: input.customerId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
  if (!customer) {
    throw new CrudHttpError(404, { error: 'Customer not found.' })
  }
}

const createAttendeeCommand: CommandHandler<BookingEventAttendeeCreateInput, { attendeeId: string }> = {
  id: 'booking.event-attendees.create',
  async execute(rawInput, ctx) {
    const parsed = bookingEventAttendeeCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await ensureEventExists(em, parsed)
    await ensureCustomerExists(em, {
      customerId: parsed.customerId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })

    const now = new Date()
    const attendee = em.create(BookingEventAttendee, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      eventId: parsed.eventId,
      customerId: parsed.customerId ?? null,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      email: parsed.email ?? null,
      phone: parsed.phone ?? null,
      addressLine1: parsed.addressLine1 ?? null,
      addressLine2: parsed.addressLine2 ?? null,
      city: parsed.city ?? null,
      region: parsed.region ?? null,
      postalCode: parsed.postalCode ?? null,
      country: parsed.country ?? null,
      attendeeType: parsed.attendeeType ?? null,
      externalRef: parsed.externalRef ?? null,
      tags: parsed.tags ?? [],
      notes: parsed.notes ?? null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(attendee)
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: attendee,
      identifiers: {
        id: attendee.id,
        organizationId: attendee.organizationId,
        tenantId: attendee.tenantId,
      },
    })

    return { attendeeId: attendee.id }
  },
  buildLog: async ({ result, ctx }) => {
    const attendeeId = result?.attendeeId
    if (!attendeeId) return null
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadAttendeeSnapshot(em, attendeeId)
    if (!snapshot) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.attendees.create', 'Create attendee'),
      resourceKind: 'booking.attendee',
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: {
        undo: { after: snapshot } satisfies AttendeeUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AttendeeUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const attendee = await em.findOne(BookingEventAttendee, { id: after.id })
    if (!attendee) return
    attendee.deletedAt = new Date()
    attendee.updatedAt = new Date()
    await em.flush()
  },
}

const updateAttendeeCommand: CommandHandler<BookingEventAttendeeUpdateInput, { attendeeId: string }> = {
  id: 'booking.event-attendees.update',
  async prepare(rawInput, ctx) {
    const parsed = bookingEventAttendeeUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadAttendeeSnapshot(em, parsed.id)
    if (!snapshot) return {}
    return { before: snapshot }
  },
  async execute(rawInput, ctx) {
    const parsed = bookingEventAttendeeUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const attendee = await findOneWithDecryption(
      em,
      BookingEventAttendee,
      { id: parsed.id, deletedAt: null },
      undefined,
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!attendee) throw new CrudHttpError(404, { error: 'Booking attendee not found.' })
    ensureTenantScope(ctx, attendee.tenantId)
    ensureOrganizationScope(ctx, attendee.organizationId)

    if (parsed.customerId !== undefined) {
      await ensureCustomerExists(em, {
        customerId: parsed.customerId,
        tenantId: attendee.tenantId,
        organizationId: attendee.organizationId,
      })
      attendee.customerId = parsed.customerId ?? null
    }
    if (parsed.firstName !== undefined) attendee.firstName = parsed.firstName
    if (parsed.lastName !== undefined) attendee.lastName = parsed.lastName
    if (parsed.email !== undefined) attendee.email = parsed.email ?? null
    if (parsed.phone !== undefined) attendee.phone = parsed.phone ?? null
    if (parsed.addressLine1 !== undefined) attendee.addressLine1 = parsed.addressLine1 ?? null
    if (parsed.addressLine2 !== undefined) attendee.addressLine2 = parsed.addressLine2 ?? null
    if (parsed.city !== undefined) attendee.city = parsed.city ?? null
    if (parsed.region !== undefined) attendee.region = parsed.region ?? null
    if (parsed.postalCode !== undefined) attendee.postalCode = parsed.postalCode ?? null
    if (parsed.country !== undefined) attendee.country = parsed.country ?? null
    if (parsed.attendeeType !== undefined) attendee.attendeeType = parsed.attendeeType ?? null
    if (parsed.externalRef !== undefined) attendee.externalRef = parsed.externalRef ?? null
    if (parsed.tags !== undefined) attendee.tags = parsed.tags ?? []
    if (parsed.notes !== undefined) attendee.notes = parsed.notes ?? null
    attendee.updatedAt = new Date()
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: attendee,
      identifiers: {
        id: attendee.id,
        organizationId: attendee.organizationId,
        tenantId: attendee.tenantId,
      },
    })

    return { attendeeId: attendee.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as AttendeeSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager)
    const after = await loadAttendeeSnapshot(em, before.id)
    if (!after) return null
    const changes = buildChanges(before, after, [
      'eventId',
      'customerId',
      'firstName',
      'lastName',
      'email',
      'phone',
      'addressLine1',
      'addressLine2',
      'city',
      'region',
      'postalCode',
      'country',
      'attendeeType',
      'externalRef',
      'tags',
      'notes',
    ])
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.attendees.update', 'Update attendee'),
      resourceKind: 'booking.attendee',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes,
      payload: {
        undo: { before, after } satisfies AttendeeUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AttendeeUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const attendee = await em.findOne(BookingEventAttendee, { id: before.id })
    if (!attendee) return
    attendee.eventId = before.eventId
    attendee.customerId = before.customerId ?? null
    attendee.firstName = before.firstName
    attendee.lastName = before.lastName
    attendee.email = before.email ?? null
    attendee.phone = before.phone ?? null
    attendee.addressLine1 = before.addressLine1 ?? null
    attendee.addressLine2 = before.addressLine2 ?? null
    attendee.city = before.city ?? null
    attendee.region = before.region ?? null
    attendee.postalCode = before.postalCode ?? null
    attendee.country = before.country ?? null
    attendee.attendeeType = before.attendeeType ?? null
    attendee.externalRef = before.externalRef ?? null
    attendee.tags = before.tags ?? []
    attendee.notes = before.notes ?? null
    attendee.deletedAt = before.deletedAt ? new Date(before.deletedAt) : null
    attendee.updatedAt = new Date()
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: attendee,
      identifiers: {
        id: attendee.id,
        organizationId: attendee.organizationId,
        tenantId: attendee.tenantId,
      },
    })
  },
}

const deleteAttendeeCommand: CommandHandler<{ id?: string }, { attendeeId: string }> = {
  id: 'booking.event-attendees.delete',
  async prepare(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Attendee id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadAttendeeSnapshot(em, id)
    if (!snapshot) return {}
    return { before: snapshot }
  },
  async execute(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Attendee id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const attendee = await findOneWithDecryption(
      em,
      BookingEventAttendee,
      { id, deletedAt: null },
      undefined,
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!attendee) throw new CrudHttpError(404, { error: 'Booking attendee not found.' })
    ensureTenantScope(ctx, attendee.tenantId)
    ensureOrganizationScope(ctx, attendee.organizationId)
    attendee.deletedAt = new Date()
    attendee.updatedAt = new Date()
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: attendee,
      identifiers: {
        id: attendee.id,
        organizationId: attendee.organizationId,
        tenantId: attendee.tenantId,
      },
    })

    return { attendeeId: attendee.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as AttendeeSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.attendees.delete', 'Delete attendee'),
      resourceKind: 'booking.attendee',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: { before } satisfies AttendeeUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AttendeeUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const attendee = await em.findOne(BookingEventAttendee, { id: before.id })
    if (!attendee) return
    attendee.eventId = before.eventId
    attendee.customerId = before.customerId ?? null
    attendee.firstName = before.firstName
    attendee.lastName = before.lastName
    attendee.email = before.email ?? null
    attendee.phone = before.phone ?? null
    attendee.addressLine1 = before.addressLine1 ?? null
    attendee.addressLine2 = before.addressLine2 ?? null
    attendee.city = before.city ?? null
    attendee.region = before.region ?? null
    attendee.postalCode = before.postalCode ?? null
    attendee.country = before.country ?? null
    attendee.attendeeType = before.attendeeType ?? null
    attendee.externalRef = before.externalRef ?? null
    attendee.tags = before.tags ?? []
    attendee.notes = before.notes ?? null
    attendee.deletedAt = before.deletedAt ? new Date(before.deletedAt) : null
    attendee.updatedAt = new Date()
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: attendee,
      identifiers: {
        id: attendee.id,
        organizationId: attendee.organizationId,
        tenantId: attendee.tenantId,
      },
    })
  },
}

registerCommand(createAttendeeCommand)
registerCommand(updateAttendeeCommand)
registerCommand(deleteAttendeeCommand)
