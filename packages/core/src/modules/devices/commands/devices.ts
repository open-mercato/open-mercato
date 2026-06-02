import type { EntityManager } from '@mikro-orm/postgresql'
import {
  registerCommand,
  type CommandHandler,
} from '@open-mercato/shared/lib/commands'
import { ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { assertFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { E } from '#generated/entities.ids.generated'
import { UserDevice } from '../data/entities'
import {
  registerDeviceCommandSchema,
  updateDeviceCommandSchema,
  deactivateDeviceCommandSchema,
  type RegisterDeviceCommandInput,
  type UpdateDeviceCommandInput,
  type DeactivateDeviceCommandInput,
} from '../data/validators'
import { emitDevicesEvent } from '../events'

type DeviceSnapshot = {
  id: string
  tenantId: string
  organizationId: string | null
  userId: string
  deviceId: string
  platform: string
  clientAppVersion: string | null
  osVersion: string | null
  pushToken: string | null
  pushProvider: string | null
  pushTokenUpdatedAt: string | null
  lastSeenAt: string
  deletedAt: string | null
}

type DeviceUndoPayload = {
  before?: DeviceSnapshot | null
  after?: DeviceSnapshot | null
}

const deviceIndexer: CrudIndexerConfig<UserDevice> = {
  entityType: E.devices.user_device,
}

const deviceEvents: CrudEventsConfig<UserDevice> = {
  module: 'devices',
  entity: 'user_device',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function serializeDevice(device: UserDevice): DeviceSnapshot {
  return {
    id: device.id,
    tenantId: device.tenantId,
    organizationId: device.organizationId ?? null,
    userId: device.userId,
    deviceId: device.deviceId,
    platform: device.platform,
    clientAppVersion: device.clientAppVersion ?? null,
    osVersion: device.osVersion ?? null,
    pushToken: device.pushToken ?? null,
    pushProvider: device.pushProvider ?? null,
    pushTokenUpdatedAt: device.pushTokenUpdatedAt ? device.pushTokenUpdatedAt.toISOString() : null,
    lastSeenAt: device.lastSeenAt.toISOString(),
    deletedAt: device.deletedAt ? device.deletedAt.toISOString() : null,
  }
}

function applySnapshot(device: UserDevice, snapshot: DeviceSnapshot): void {
  device.platform = snapshot.platform as UserDevice['platform']
  device.clientAppVersion = snapshot.clientAppVersion
  device.osVersion = snapshot.osVersion
  device.pushToken = snapshot.pushToken
  device.pushProvider = snapshot.pushProvider
  device.pushTokenUpdatedAt = toDate(snapshot.pushTokenUpdatedAt)
  device.lastSeenAt = toDate(snapshot.lastSeenAt) ?? new Date()
  device.deletedAt = toDate(snapshot.deletedAt)
}

async function loadExistingDevice(
  em: EntityManager,
  scope: { tenantId: string; userId: string; deviceId: string },
): Promise<UserDevice | null> {
  const active = await em.findOne(UserDevice, { ...scope, deletedAt: null })
  if (active) return active
  return em.findOne(UserDevice, scope, { orderBy: { createdAt: 'desc' } })
}

const registerDeviceCommand: CommandHandler<RegisterDeviceCommandInput, { id: string; deviceId: string; revived: boolean }> = {
  id: 'devices.devices.register',
  async prepare(rawInput, ctx) {
    const parsed = registerDeviceCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await loadExistingDevice(em, {
      tenantId: parsed.tenantId,
      userId: parsed.userId,
      deviceId: parsed.deviceId,
    })
    return existing ? { before: serializeDevice(existing) } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = registerDeviceCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await loadExistingDevice(em, {
      tenantId: parsed.tenantId,
      userId: parsed.userId,
      deviceId: parsed.deviceId,
    })
    const now = new Date()
    const hasPushToken = parsed.pushToken !== undefined && parsed.pushToken !== null
    const wasActive = existing ? existing.deletedAt == null : false

    let device!: UserDevice
    await withAtomicFlush(
      em,
      [
        () => {
          if (existing) {
            device = existing
            device.platform = parsed.platform
            device.organizationId = parsed.organizationId ?? device.organizationId ?? null
            if (parsed.clientAppVersion !== undefined) device.clientAppVersion = parsed.clientAppVersion ?? null
            if (parsed.osVersion !== undefined) device.osVersion = parsed.osVersion ?? null
            if (hasPushToken) {
              device.pushToken = parsed.pushToken ?? null
              device.pushProvider = parsed.pushProvider ?? device.pushProvider ?? null
              device.pushTokenUpdatedAt = now
            }
            device.lastSeenAt = now
            device.deletedAt = null
          } else {
            device = em.create(UserDevice, {
              tenantId: parsed.tenantId,
              organizationId: parsed.organizationId ?? null,
              userId: parsed.userId,
              deviceId: parsed.deviceId,
              platform: parsed.platform,
              clientAppVersion: parsed.clientAppVersion ?? null,
              osVersion: parsed.osVersion ?? null,
              pushToken: hasPushToken ? parsed.pushToken ?? null : null,
              pushProvider: hasPushToken ? parsed.pushProvider ?? null : null,
              pushTokenUpdatedAt: hasPushToken ? now : null,
              lastSeenAt: now,
            })
            em.persist(device)
          }
        },
      ],
      { transaction: true },
    )

    const revived = Boolean(existing) && !wasActive
    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: existing ? 'updated' : 'created',
      entity: device,
      identifiers: {
        id: device.id,
        tenantId: device.tenantId,
        organizationId: device.organizationId ?? null,
      },
      indexer: deviceIndexer,
      events: deviceEvents,
    })
    await emitDevicesEvent(
      'devices.user_device.registered',
      {
        id: device.id,
        tenantId: device.tenantId,
        organizationId: device.organizationId ?? null,
        userId: device.userId,
        deviceId: device.deviceId,
        platform: device.platform,
        revived,
      },
      { persistent: true },
    )

    return { id: device.id, deviceId: device.deviceId, revived }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const device = await em.findOne(UserDevice, { id: result.id })
    return device ? serializeDevice(device) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const before = (snapshots.before as DeviceSnapshot | undefined) ?? null
    const after = (snapshots.after as DeviceSnapshot | undefined) ?? null
    return {
      actionLabel: before ? 'Update device' : 'Register device',
      resourceKind: 'devices.user_device',
      resourceId: result.id,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: {
        undo: { before, after } satisfies DeviceUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<DeviceUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const before = payload?.before ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const device = await em.findOne(UserDevice, { id: after.id })
    if (!device) return

    await withAtomicFlush(
      em,
      [
        () => {
          if (before) {
            // Upsert/revive: restore the prior row state.
            applySnapshot(device, before)
          } else {
            // Fresh registration: undo by soft-deleting the created row.
            device.deletedAt = new Date()
          }
        },
      ],
      { transaction: true },
    )

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: before ? 'updated' : 'deleted',
      entity: device,
      identifiers: {
        id: device.id,
        tenantId: device.tenantId,
        organizationId: device.organizationId ?? null,
      },
      indexer: deviceIndexer,
      events: deviceEvents,
    })
  },
}

const updateDeviceCommand: CommandHandler<UpdateDeviceCommandInput, { id: string }> = {
  id: 'devices.devices.update',
  async prepare(rawInput, ctx) {
    const parsed = updateDeviceCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const device = await em.findOne(UserDevice, { id: parsed.id, deletedAt: null })
    return device ? { before: serializeDevice(device) } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = updateDeviceCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const device = assertFound(
      await em.findOne(UserDevice, { id: parsed.id, deletedAt: null }),
      'Device not found',
    )
    ensureTenantScope(ctx, device.tenantId)

    const now = new Date()
    await withAtomicFlush(
      em,
      [
        () => {
          if (Object.prototype.hasOwnProperty.call(parsed, 'clientAppVersion')) {
            device.clientAppVersion = parsed.clientAppVersion ?? null
          }
          if (Object.prototype.hasOwnProperty.call(parsed, 'osVersion')) {
            device.osVersion = parsed.osVersion ?? null
          }
          if (Object.prototype.hasOwnProperty.call(parsed, 'pushToken')) {
            device.pushToken = parsed.pushToken ?? null
            device.pushTokenUpdatedAt = now
          }
          if (Object.prototype.hasOwnProperty.call(parsed, 'pushProvider')) {
            device.pushProvider = parsed.pushProvider ?? null
          }
          device.lastSeenAt = parsed.lastSeenAt ?? now
        },
      ],
      { transaction: true },
    )

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: device,
      identifiers: {
        id: device.id,
        tenantId: device.tenantId,
        organizationId: device.organizationId ?? null,
      },
      indexer: deviceIndexer,
      events: deviceEvents,
    })

    return { id: device.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const device = await em.findOne(UserDevice, { id: result.id })
    return device ? serializeDevice(device) : null
  },
  buildLog: async ({ snapshots }) => {
    const before = (snapshots.before as DeviceSnapshot | undefined) ?? null
    if (!before) return null
    const after = (snapshots.after as DeviceSnapshot | undefined) ?? null
    return {
      actionLabel: 'Update device',
      resourceKind: 'devices.user_device',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: {
        undo: { before, after } satisfies DeviceUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<DeviceUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const device = await em.findOne(UserDevice, { id: before.id })
    if (!device) return

    await withAtomicFlush(em, [() => applySnapshot(device, before)], { transaction: true })

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: device,
      identifiers: {
        id: device.id,
        tenantId: device.tenantId,
        organizationId: device.organizationId ?? null,
      },
      indexer: deviceIndexer,
      events: deviceEvents,
    })
  },
}

const deactivateDeviceCommand: CommandHandler<DeactivateDeviceCommandInput, { id: string }> = {
  id: 'devices.devices.deactivate',
  async prepare(rawInput, ctx) {
    const parsed = deactivateDeviceCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const device = await em.findOne(UserDevice, { id: parsed.id, deletedAt: null })
    return device ? { before: serializeDevice(device) } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = deactivateDeviceCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const device = assertFound(
      await em.findOne(UserDevice, { id: parsed.id, deletedAt: null }),
      'Device not found',
    )
    ensureTenantScope(ctx, device.tenantId)

    await withAtomicFlush(em, [() => { device.deletedAt = new Date() }], { transaction: true })

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: device,
      identifiers: {
        id: device.id,
        tenantId: device.tenantId,
        organizationId: device.organizationId ?? null,
      },
      indexer: deviceIndexer,
      events: deviceEvents,
    })
    await emitDevicesEvent(
      'devices.user_device.deactivated',
      {
        id: device.id,
        tenantId: device.tenantId,
        organizationId: device.organizationId ?? null,
        userId: device.userId,
        deviceId: device.deviceId,
      },
      { persistent: true },
    )

    return { id: device.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = (snapshots.before as DeviceSnapshot | undefined) ?? null
    if (!before) return null
    return {
      actionLabel: 'Deactivate device',
      resourceKind: 'devices.user_device',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: { before } satisfies DeviceUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<DeviceUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const device = await em.findOne(UserDevice, { id: before.id })
    if (!device) return

    await withAtomicFlush(em, [() => applySnapshot(device, before)], { transaction: true })

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'created',
      entity: device,
      identifiers: {
        id: device.id,
        tenantId: device.tenantId,
        organizationId: device.organizationId ?? null,
      },
      indexer: deviceIndexer,
      events: deviceEvents,
    })
  },
}

registerCommand(registerDeviceCommand)
registerCommand(updateDeviceCommand)
registerCommand(deactivateDeviceCommand)
