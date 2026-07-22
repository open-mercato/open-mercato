import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { assertFound } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { UserDevice } from '../data/entities'
import { deactivateDeviceCommandSchema, type DeactivateDeviceCommandInput } from '../data/validators'
import { emitDevicesEvent } from '../events'
import {
  applySnapshot,
  deviceEvents,
  deviceIndexer,
  serializeDevice,
  type DeviceSnapshot,
  type DeviceUndoPayload,
} from './shared'

const deactivateDeviceCommand: CommandHandler<DeactivateDeviceCommandInput, { id: string }> = {
  id: 'devices.user_devices.deactivate',
  async prepare(rawInput, ctx) {
    const parsed = deactivateDeviceCommandSchema.parse(rawInput)
    // Enforce tenant scope and constrain the snapshot lookup to the caller's tenant.
    ensureTenantScope(ctx, parsed.tenantId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    // No fallback decryption scope: `UserDevice` always carries its own organization_id, which
    // `decryptEntitiesWithFallbackScope` resolves first — matching loadExistingDevice in shared.ts.
    const device = await findOneWithDecryption(
      em,
      UserDevice,
      { id: parsed.id, tenantId: parsed.tenantId, deletedAt: null },
    )
    return device ? { before: serializeDevice(device) } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = deactivateDeviceCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    // Scope the load to the caller's tenant (mirroring `prepare`) instead of loading by id alone — a
    // bare id lookup would let a cross-tenant id resolve a row before the post-load tenant check runs.
    const device = assertFound(
      await findOneWithDecryption(em, UserDevice, { id: parsed.id, tenantId: parsed.tenantId, deletedAt: null }),
      'Device not found',
    )
    ensureTenantScope(ctx, device.tenantId)
    // Enforce the ORGANIZATION scope the caller handed us instead of leaving it unread. Without this the
    // org context threaded through the push "unregister null-org" path — and any org-scoped admin
    // dispatch — is silently ignored, so a caller scoped to org A could deactivate an org-B device in
    // the same tenant. Guard on a non-null org: tenant-scoped devices (org = null) have nothing to
    // constrain, and the system/worker path passes `selectedOrganizationId = device.organizationId`,
    // which `ensureOrganizationScope` accepts.
    if (device.organizationId) ensureOrganizationScope(ctx, device.organizationId)

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
    const device = await findOneWithDecryption(em, UserDevice, { id: before.id })
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

registerCommand(deactivateDeviceCommand)
