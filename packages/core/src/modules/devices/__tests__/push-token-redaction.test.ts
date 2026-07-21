export {}

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

function deviceSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: DEVICE_ID,
    tenantId: TENANT,
    organizationId: ORG,
    userId: '44444444-4444-4444-8444-444444444444',
    deviceId: 'device-install-1',
    platform: 'ios',
    clientAppVersion: '1.0.0',
    osVersion: '17.0',
    pushToken: SECRET_TOKEN,
    pushProvider: 'apns',
    pushTokenUpdatedAt: '2026-06-26T00:00:00.000Z',
    lastSeenAt: '2026-06-26T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

describe('devices command audit-log redaction', () => {
  it('redacts push_token from register snapshots while retaining it in the undo payload', async () => {
    const command = loadCommand('devices.user_devices.register')
    const before = deviceSnapshot()
    const after = deviceSnapshot({ clientAppVersion: '1.1.0' })

    const log = await command.buildLog({ result: { id: DEVICE_ID }, snapshots: { before, after } })

    expect(log).not.toBeNull()
    // Audit-log API returns snapshotBefore/snapshotAfter (and derives changesJson from them).
    expect(log!.snapshotBefore?.pushToken).toBe('[redacted]')
    expect(log!.snapshotAfter?.pushToken).toBe('[redacted]')
    expect(JSON.stringify(log!.snapshotBefore)).not.toContain(SECRET_TOKEN)
    expect(JSON.stringify(log!.snapshotAfter)).not.toContain(SECRET_TOKEN)
    // The real token survives only in the non-exposed undo payload so remove/restore is lossless.
    expect(log!.payload?.undo?.before?.pushToken).toBe(SECRET_TOKEN)
    expect(log!.payload?.undo?.after?.pushToken).toBe(SECRET_TOKEN)
  })

  it('keeps a null push_token as null (not "[redacted]") in register snapshots', async () => {
    const command = loadCommand('devices.user_devices.register')
    const after = deviceSnapshot({ pushToken: null })

    const log = await command.buildLog({ result: { id: DEVICE_ID }, snapshots: { after } })

    expect(log!.snapshotBefore).toBeNull()
    expect(log!.snapshotAfter?.pushToken).toBeNull()
  })

  it('redacts push_token from update snapshots while retaining it in the undo payload', async () => {
    const command = loadCommand('devices.user_devices.update')
    const before = deviceSnapshot()
    const after = deviceSnapshot({ pushToken: 'rotated-secret-token-9876543210fedcba' })

    const log = await command.buildLog({ result: { id: DEVICE_ID }, snapshots: { before, after } })

    expect(log!.snapshotBefore?.pushToken).toBe('[redacted]')
    expect(log!.snapshotAfter?.pushToken).toBe('[redacted]')
    expect(JSON.stringify({ a: log!.snapshotBefore, b: log!.snapshotAfter })).not.toContain(SECRET_TOKEN)
    expect(JSON.stringify({ a: log!.snapshotBefore, b: log!.snapshotAfter })).not.toContain(
      'rotated-secret-token-9876543210fedcba',
    )
    expect(log!.payload?.undo?.before?.pushToken).toBe(SECRET_TOKEN)
    expect(log!.payload?.undo?.after?.pushToken).toBe('rotated-secret-token-9876543210fedcba')
  })

  it('redacts push_token from the deactivate before-snapshot', async () => {
    const command = loadCommand('devices.user_devices.deactivate')
    const before = deviceSnapshot()

    const log = await command.buildLog({ result: { id: DEVICE_ID }, snapshots: { before } })

    expect(log!.snapshotBefore?.pushToken).toBe('[redacted]')
    expect(JSON.stringify(log!.snapshotBefore)).not.toContain(SECRET_TOKEN)
    expect(log!.payload?.undo?.before?.pushToken).toBe(SECRET_TOKEN)
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
