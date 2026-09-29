import { applySnapshot, serializeDevice, type DeviceSnapshot } from '../commands/shared'
import type { UserDevice } from '../data/entities'

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

const SECRET_TOKEN = 'super-secret-provider-token-abcdef0123456789'
const TENANT = '33333333-3333-4333-8333-333333333333'
const ORG = '22222222-2222-4222-8222-222222222222'
const DEVICE_ID = '11111111-1111-4111-8111-111111111111'

type CommandLike = {
  id: string
  buildLog: (args: { result: { id: string }; snapshots: Record<string, unknown> }) => Promise<{
    snapshotBefore: Record<string, unknown> | null
    snapshotAfter?: Record<string, unknown> | null
    payload?: { undo?: { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null } }
  } | null>
}

function loadCommand(id: string): CommandLike {
  let command: unknown
  jest.isolateModules(() => {
    require('../commands/index')
    command = registerCommand.mock.calls.find(([cmd]) => cmd.id === id)?.[0]
  })
  if (!command) throw new Error(`command ${id} not registered`)
  return command as CommandLike
}

function makeDevice(overrides: Partial<UserDevice> = {}): UserDevice {
  return {
    id: DEVICE_ID,
    tenantId: TENANT,
    organizationId: ORG,
    userId: '44444444-4444-4444-8444-444444444444',
    deviceId: 'device-install-1',
    platform: 'ios',
    clientAppVersion: '1.0.0',
    osVersion: '17.0',
    locale: 'en-US',
    pushToken: SECRET_TOKEN,
    pushProvider: 'apns',
    pushTokenUpdatedAt: new Date('2026-06-26T00:00:00.000Z'),
    lastSeenAt: new Date('2026-06-26T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as unknown as UserDevice
}

describe('device snapshots never carry the plaintext push_token', () => {
  it('serializeDevice stores only the last-8 fingerprint, never the token', () => {
    const snap = serializeDevice(makeDevice())
    expect(snap.pushTokenFingerprint).toBe(SECRET_TOKEN.slice(-8))
    expect('pushToken' in snap).toBe(false)
    expect(JSON.stringify(snap)).not.toContain(SECRET_TOKEN)
  })

  it('serializeDevice maps a null token to a null fingerprint', () => {
    expect(serializeDevice(makeDevice({ pushToken: null })).pushTokenFingerprint).toBeNull()
  })

  it.each([
    'devices.user_devices.register',
    'devices.user_devices.update',
    'devices.user_devices.deactivate',
  ])('%s buildLog leaks the token into neither the snapshots nor the undo payload', async (id) => {
    const command = loadCommand(id)
    const before = serializeDevice(makeDevice())
    const after = serializeDevice(makeDevice({ clientAppVersion: '1.1.0' }))

    const log = await command.buildLog({ result: { id: DEVICE_ID }, snapshots: { before, after } })

    expect(log).not.toBeNull()
    // The full blob covers snapshotBefore/After (client-facing) AND payload.undo (internal, persisted
    // to action_logs with no TTL) — the token must appear in none of them.
    expect(JSON.stringify(log)).not.toContain(SECRET_TOKEN)
    // Only the safe last-8 fingerprint survives, in both the snapshot and the undo payload.
    expect(log!.snapshotBefore?.pushTokenFingerprint).toBe(SECRET_TOKEN.slice(-8))
    expect(log!.payload?.undo?.before?.pushTokenFingerprint).toBe(SECRET_TOKEN.slice(-8))
  })
})

describe('applySnapshot preserves the live push credential (never restores it from audit data)', () => {
  it('restores metadata but keeps the device’s current token/provider', () => {
    const device = makeDevice({ pushToken: 'LIVE-TOKEN-abcdefgh', pushProvider: 'fcm', platform: 'android', locale: 'de-DE' })
    const snapshot = serializeDevice(makeDevice({ pushToken: SECRET_TOKEN, pushProvider: 'apns', platform: 'ios', locale: 'en-US' }))

    applySnapshot(device, snapshot)

    expect(device.platform).toBe('ios') // metadata reverted
    expect(device.locale).toBe('en-US') // metadata reverted
    expect(device.pushToken).toBe('LIVE-TOKEN-abcdefgh') // credential preserved, NOT restored to the snapshot's
    expect(device.pushProvider).toBe('fcm')
  })

  it('cannot brick the token even when a snapshot carries a placeholder fingerprint', () => {
    // Simulates a legacy/undecryptable payload whose fingerprint field holds junk — undo must still
    // leave the live token intact rather than writing the placeholder into the credential column (M7).
    const device = makeDevice({ pushToken: 'LIVE-TOKEN-abcdefgh' })
    applySnapshot(device, { ...serializeDevice(makeDevice()), pushTokenFingerprint: '[redacted]' } as DeviceSnapshot)
    expect(device.pushToken).toBe('LIVE-TOKEN-abcdefgh')
  })
})

describe('devices mutation-guard payload redaction', () => {
  it('strips push_token from the mutation-guard payload but keeps other fields', () => {
    const { redactMutationPayload } = require('../api/deviceOps') as {
      redactMutationPayload: (
        payload: Record<string, unknown> | undefined,
      ) => Record<string, unknown> | undefined
    }

    const redacted = redactMutationPayload({
      platform: 'ios',
      pushToken: SECRET_TOKEN,
      pushProvider: 'apns',
    })

    expect(redacted && 'pushToken' in redacted).toBe(false)
    expect(JSON.stringify(redacted)).not.toContain(SECRET_TOKEN)
    expect(redacted).toMatchObject({ platform: 'ios', pushProvider: 'apns' })
  })

  it('returns payloads without a push_token untouched', () => {
    const { redactMutationPayload } = require('../api/deviceOps') as {
      redactMutationPayload: (
        payload: Record<string, unknown> | undefined,
      ) => Record<string, unknown> | undefined
    }

    expect(redactMutationPayload(undefined)).toBeUndefined()
    const payload = { platform: 'android' }
    expect(redactMutationPayload(payload)).toBe(payload)
  })
})
