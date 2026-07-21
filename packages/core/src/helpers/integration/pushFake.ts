import path from 'node:path'
import { expect, type APIRequestContext } from '@playwright/test'
import {
  findFakePush,
  resolveQueueBaseDir,
  uniquePushTokenTail,
  type FakePushEntry,
  type FakePushProvider,
} from '../../modules/push_notifications/lib/fake-provider-recorder'
import { apiRequest } from './api'
import { resolveAppRoot } from './appRoot'
import { deleteEntityByPathIfExists, expectId, readJsonSafe } from './generalFixtures'
import { withClient } from './dbFixtures'

/**
 * Harness for the `OM_PUSH_FAKE_PROVIDERS` integration specs (TC-PUSH-004+, TC-CHANNEL-PUSH-005+).
 *
 * The fake replaces each provider's SDK client, so the REAL adapter runs and records the
 * provider-native message it built. The worker does that in a different process than the spec, so the
 * message travels through a JSONL sink under the queue's own base dir rather than the delivery row —
 * no adapter returns `metadata` on success, and APNs deliberately reports an empty `externalMessageId`.
 */
/**
 * The Playwright process runs from the repo root, so its `cwd` is not the app root. Pin `QUEUE_BASE_DIR`
 * once, before anything resolves it, so the spec, the worker, and the drain child all agree on the queue
 * dir and the sink inside it. Never overrides a dir the harness already chose (the ephemeral runner
 * sets its own).
 */
if (!process.env.QUEUE_BASE_DIR?.trim()) {
  process.env.QUEUE_BASE_DIR = path.resolve(resolveAppRoot(), '.mercato/queue')
}

/** Re-exported so specs never hand-roll a second, divergent fallback (see TC-PUSH-008). */
export { resolveQueueBaseDir, uniquePushTokenTail }

/** The canonical channel teardown — API-based, not raw SQL. Re-exported so specs import one module. */
export { deleteChannelIfExists } from './communicationChannelsFixtures'

export const TENANT_CONNECT_PATH = '/api/communication_channels/channels/connect/tenant-credentials'
export const DEVICES_PATH = '/api/devices'
export const NOTIFICATIONS_PATH = '/api/notifications'

/** A push token whose last 8 chars are unique to this run — the sink and delivery row are keyed on them. */
export function makeFakePushToken(provider: FakePushProvider): { pushToken: string; tokenTail: string } {
  const tokenTail = uniquePushTokenTail()
  return { pushToken: `qa-${provider}-token-${tokenTail}`, tokenTail }
}

/** A push token that drives the given branch, keeping the run-unique tail. */
export function makeFakePushTokenFor(
  provider: FakePushProvider,
  sentinel: 'unregistered' | 'fail',
): { pushToken: string; tokenTail: string } {
  const tokenTail = uniquePushTokenTail()
  return { pushToken: `qa-${provider}-${sentinel}-token-${tokenTail}`, tokenTail }
}

export type PushDeliveryRow = {
  status: string
  token_snapshot: string
  organization_id: string | null
  provider: string
  attempts: number
  silent: boolean
  sent_at: string | null
  last_error: string | null
  provider_response: Record<string, unknown> | null
}

/** Valid-*shaped* fake credentials. `validateCredentials` is schema-only; real parsing lives in the faked SDK client. */
export const FAKE_PUSH_CREDENTIALS: Record<FakePushProvider, Record<string, unknown>> = {
  fcm: {
    serviceAccountJson: JSON.stringify({
      project_id: 'om-fake-project',
      client_email: 'fake@om-fake-project.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nom-fake-key\n-----END PRIVATE KEY-----\n',
    }),
  },
  apns: {
    p8Key: '-----BEGIN PRIVATE KEY-----\nom-fake-p8\n-----END PRIVATE KEY-----\n',
    keyId: 'FAKEKEYID1',
    teamId: 'FAKETEAMID',
    bundleId: 'com.openmercato.fake',
    production: false,
  },
  expo: {
    accessToken: 'om-fake-expo-token',
  },
}

/**
 * Connect a tenant-wide push channel through the real credential-connect route.
 *
 * Not `seedConnectedChannel` from `communicationChannelsFixtures`: that seeds the `__test_seed__`
 * provider, whereas these specs must drive the real `fcm`/`apns`/`expo` connect path so the adapter's own
 * `validateCredentials` runs. Tear down with `deleteChannelIfExists` from that same module.
 */
export async function connectFakePushChannel(
  request: APIRequestContext,
  token: string,
  provider: FakePushProvider,
  displayName: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', TENANT_CONNECT_PATH, {
    token,
    data: { providerKey: provider, displayName, credentials: FAKE_PUSH_CREDENTIALS[provider] },
  })
  expect(response.status(), `connect ${provider} channel`).toBe(201)
  const body = await readJsonSafe<{ channelId?: string }>(response)
  return expectId(body?.channelId, `connect ${provider} response should include channelId`)
}

/**
 * Register a device routed to `provider`. The token tail keys both the delivery row's
 * `token_snapshot` and the recorded native message, isolating concurrent specs.
 */
export async function registerFakePushDevice(
  request: APIRequestContext,
  token: string,
  provider: FakePushProvider,
  pushToken: string,
  deviceId: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', DEVICES_PATH, {
    token,
    data: { deviceId, platform: provider === 'apns' ? 'ios' : 'android', pushToken, pushProvider: provider },
  })
  expect(response.status(), `register ${provider} device`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, `register ${provider} device response should include id`)
}

/** Teardown counterpart to {@link registerFakePushDevice}. */
export async function deleteFakePushDevice(
  request: APIRequestContext,
  token: string | null,
  userDeviceId: string | null,
): Promise<void> {
  if (!userDeviceId) return
  await deleteEntityByPathIfExists(request, token, `${DEVICES_PATH}/${userDeviceId}`)
}

export async function deleteDeliveriesForDevice(userDeviceId: string | null): Promise<void> {
  if (!userDeviceId) return
  await withClient(async (client) => {
    await client.query('delete from push_notification_deliveries where user_device_id = $1', [userDeviceId])
  }).catch(() => undefined)
}

export async function readLatestDelivery(tenantId: string, userDeviceId: string): Promise<PushDeliveryRow | null> {
  return withClient(async (client) => {
    const res = await client.query(
      `select status, token_snapshot, organization_id, provider, attempts, silent, sent_at, last_error, provider_response
         from push_notification_deliveries
        where tenant_id = $1 and user_device_id = $2
        order by created_at desc
        limit 1`,
      [tenantId, userDeviceId],
    )
    return (res.rows[0] as PushDeliveryRow | undefined) ?? null
  })
}

/**
 * True once the device has been soft-deleted (the `device_unregistered` contract).
 *
 * A MISSING row returns `false`, not `true`: soft-delete keeps the row, so an absent one means the
 * device was never created or a neighbouring teardown hard-deleted it. Returning `true` there would let
 * the central assertion of TC-PUSH-004/008 pass vacuously.
 */
export async function isDeviceSoftDeleted(userDeviceId: string): Promise<boolean> {
  return withClient(async (client) => {
    const res = await client.query('select deleted_at from user_devices where id = $1', [userDeviceId])
    if (res.rows.length === 0) return false
    return res.rows[0].deleted_at != null
  })
}

/** The provider-native message the REAL adapter handed the faked SDK client. */
export function readNativeMessage(
  provider: FakePushProvider,
  tokenTail: string,
  sinceIso?: string,
): FakePushEntry | undefined {
  return findFakePush(provider, tokenTail, sinceIso)
}

/**
 * Wait for the message this run's worker recorded. Pass `sinceIso` to reject entries from an earlier
 * run — the sink is append-only and the reused-environment path never truncates it. The default
 * (epoch) accepts every recorded entry.
 */
export async function expectNativeMessage(
  provider: FakePushProvider,
  tokenTail: string,
  sinceIso: string = new Date(0).toISOString(),
): Promise<Record<string, unknown>> {
  await expect
    .poll(() => readNativeMessage(provider, tokenTail, sinceIso)?.native ?? null, { timeout: 30_000 })
    .not.toBeNull()
  return readNativeMessage(provider, tokenTail, sinceIso)!.native
}
