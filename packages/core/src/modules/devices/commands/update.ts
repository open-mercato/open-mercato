import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { assertFound } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { UserDevice } from '../data/entities'
import { updateDeviceCommandSchema, type UpdateDeviceCommandInput } from '../data/validators'
import {
  applySnapshot,
  deviceEvents,
  deviceIndexer,
  serializeDevice,
  type DeviceSnapshot,
  type DeviceUndoPayload,
} from './shared'

const updateDeviceCommand: CommandHandler<UpdateDeviceCommandInput, { id: string }> = {
  id: 'devices.user_devices.update',
  async prepare(rawInput, ctx) {
    const parsed = updateDeviceCommandSchema.parse(rawInput)
    // Enforce tenant scope and constrain the snapshot lookup to the caller's tenant.
    ensureTenantScope(ctx, parsed.tenantId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    // No fallback decryption scope: `UserDevice` always carries its own organization_id, which
    // `decryptEntitiesWithFallbackScope` resolves first — matching the scope-less lookup in execute().
    const device = await findOneWithDecryption(
      em,
      UserDevice,
      { id: parsed.id, tenantId: parsed.tenantId, deletedAt: null },
    )
    return device ? { before: serializeDevice(device) } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = updateDeviceCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const device = assertFound(
      await findOneWithDecryption(em, UserDevice, { id: parsed.id, deletedAt: null }),
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
          if (Object.prototype.hasOwnProperty.call(parsed, 'locale')) {
            device.locale = parsed.locale ?? null
          }
          if (Object.prototype.hasOwnProperty.call(parsed, 'pushToken')) {
            device.pushToken = parsed.pushToken ?? null
            device.pushTokenUpdatedAt = now
          }
          if (Object.prototype.hasOwnProperty.call(parsed, 'pushProvider')) {
            device.pushProvider = parsed.pushProvider ?? null
          }
          // Only a client-supplied lastSeenAt advances presence. Metadata-only edits (e.g. an admin
          // changing push_provider) must NOT bump last_seen_at — device presence is maintained by the
          // register heartbeat, not by edits.
          if (Object.prototype.hasOwnProperty.call(parsed, 'lastSeenAt') && parsed.lastSeenAt) {
            device.lastSeenAt = parsed.lastSeenAt
          }
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
    const device = await findOneWithDecryption(em, UserDevice, { id: result.id })
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
    const device = await findOneWithDecryption(em, UserDevice, { id: before.id })
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

registerCommand(updateDeviceCommand)
