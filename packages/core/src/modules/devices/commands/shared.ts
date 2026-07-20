import type { EntityManager } from '@mikro-orm/postgresql'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'
import { UserDevice } from '../data/entities'

export type DeviceSnapshot = {
  id: string
  tenantId: string
  organizationId: string | null
  userId: string
  deviceId: string
  platform: string
  clientAppVersion: string | null
  osVersion: string | null
  locale: string | null
  pushToken: string | null
  pushProvider: string | null
  pushTokenUpdatedAt: string | null
  lastSeenAt: string
  deletedAt: string | null
}

export type DeviceUndoPayload = {
  before?: DeviceSnapshot | null
  after?: DeviceSnapshot | null
}

export const deviceIndexer: CrudIndexerConfig<UserDevice> = {
  entityType: E.devices.user_device,
}

export const deviceEvents: CrudEventsConfig<UserDevice> = {
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

export function serializeDevice(device: UserDevice): DeviceSnapshot {
  return {
    id: device.id,
    tenantId: device.tenantId,
    organizationId: device.organizationId ?? null,
    userId: device.userId,
    deviceId: device.deviceId,
    platform: device.platform,
    clientAppVersion: device.clientAppVersion ?? null,
    osVersion: device.osVersion ?? null,
    locale: device.locale ?? null,
    pushToken: device.pushToken ?? null,
    pushProvider: device.pushProvider ?? null,
    pushTokenUpdatedAt: device.pushTokenUpdatedAt ? device.pushTokenUpdatedAt.toISOString() : null,
    lastSeenAt: device.lastSeenAt.toISOString(),
    deletedAt: device.deletedAt ? device.deletedAt.toISOString() : null,
  }
}

// push_token is a secret (see AGENTS.md). The audit-logs API returns snapshotBefore/snapshotAfter
// (and the changesJson it derives from them) to clients, so the token is stripped from the snapshots
// stored on the log entry. The real token stays in payload.undo — which the audit API never exposes
// and the undo handlers read from via extractUndoPayload — so remove/restore puts it back unchanged.
export function redactSnapshot(snapshot: DeviceSnapshot | null): DeviceSnapshot | null {
  if (!snapshot) return null
  return { ...snapshot, pushToken: snapshot.pushToken === null ? null : '[redacted]' }
}

export function applySnapshot(device: UserDevice, snapshot: DeviceSnapshot): void {
  device.platform = snapshot.platform as UserDevice['platform']
  device.clientAppVersion = snapshot.clientAppVersion
  device.osVersion = snapshot.osVersion
  device.locale = snapshot.locale
  device.pushToken = snapshot.pushToken
  device.pushProvider = snapshot.pushProvider
  device.pushTokenUpdatedAt = toDate(snapshot.pushTokenUpdatedAt)
  device.lastSeenAt = toDate(snapshot.lastSeenAt) ?? new Date()
  device.deletedAt = toDate(snapshot.deletedAt)
}

export async function loadExistingDevice(
  em: EntityManager,
  // organizationId is part of the device identity (a null value matches IS NULL, mirroring the
  // coalesce(...) bucket in the unique index), so a device is looked up per (tenant, org, user, device).
  scope: { tenantId: string; organizationId: string | null; userId: string; deviceId: string },
): Promise<UserDevice | null> {
  // push_token is encrypted at rest; decrypt on read so snapshots/undo payloads keep the plaintext.
  const dscope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  const active = await findOneWithDecryption(em, UserDevice, { ...scope, deletedAt: null }, undefined, dscope)
  if (active) return active
  return findOneWithDecryption(em, UserDevice, scope, { orderBy: { createdAt: 'desc' } }, dscope)
}

// Postgres SQLSTATE for unique_violation. MikroORM doesn't re-export pg error codes, so name it here.
const PG_UNIQUE_VIOLATION = '23505'

// A concurrent first-registration of the same (tenant, org, user, device_id) loses the race against the
// partial unique index. Surface it as a 409 conflict instead of a raw 500 — the endpoint is an
// idempotent upsert, so the caller can simply re-issue the request to land on the existing row.
export function isDeviceUniqueViolation(error: unknown): boolean {
  if (error instanceof UniqueConstraintViolationException) return true
  if (!error || typeof error !== 'object') return false
  if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) return true
  const message = (error as { message?: string }).message
  return typeof message === 'string' && message.toLowerCase().includes('duplicate key')
}
