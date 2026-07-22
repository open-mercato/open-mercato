import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { UserDevice } from '../data/entities'
import { registerDeviceCommandSchema, type RegisterDeviceCommandInput } from '../data/validators'
import { emitDevicesEvent } from '../events'
import {
  applySnapshot,
  deviceEvents,
  deviceIndexer,
  isDeviceUniqueViolation,
  loadExistingDevice,
  serializeDevice,
  type DeviceSnapshot,
  type DeviceUndoPayload,
} from './shared'

const registerDeviceCommand: CommandHandler<RegisterDeviceCommandInput, { id: string; deviceId: string; revived: boolean }> = {
  id: 'devices.user_devices.register',
  async prepare(rawInput, ctx) {
    const parsed = registerDeviceCommandSchema.parse(rawInput)
    // Enforce tenant scope before any DB access so prepare() can't probe across tenants.
    ensureTenantScope(ctx, parsed.tenantId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await loadExistingDevice(em, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId ?? null,
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
      organizationId: parsed.organizationId ?? null,
      userId: parsed.userId,
      deviceId: parsed.deviceId,
    })
    const now = new Date()
    const hasPushToken = parsed.pushToken !== undefined && parsed.pushToken !== null
    const wasActive = existing ? existing.deletedAt == null : false

    let device!: UserDevice
    try {
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
              if (parsed.locale !== undefined) device.locale = parsed.locale ?? null
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
                locale: parsed.locale ?? null,
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
    } catch (err) {
      if (isDeviceUniqueViolation(err)) {
        // Default English message is a fallback; device routes translate by `code` (see route POST
        // handlers), matching the customers dictionaries conflict pattern.
        throw new CrudHttpError(409, {
          code: 'device_already_registered',
          error: 'This device is already registered',
        })
      }
      throw err
    }

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
    const device = await findOneWithDecryption(em, UserDevice, { id: result.id })
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
    const device = await findOneWithDecryption(em, UserDevice, { id: after.id })
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

registerCommand(registerDeviceCommand)
