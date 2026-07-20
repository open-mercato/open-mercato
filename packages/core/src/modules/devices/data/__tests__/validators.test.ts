import {
  registerDeviceSchema,
  registerDeviceAdminSchema,
  updateDeviceSchema,
} from '../validators'

const VALID_REGISTER = {
  deviceId: 'device-abc',
  platform: 'ios' as const,
}

describe('registerDeviceSchema', () => {
  it('accepts a minimal valid registration and trims string fields', () => {
    const parsed = registerDeviceSchema.parse({ deviceId: '  device-abc  ', platform: 'android' })
    expect(parsed.deviceId).toBe('device-abc')
    expect(parsed.platform).toBe('android')
  })

  it('rejects an unknown platform', () => {
    expect(() => registerDeviceSchema.parse({ ...VALID_REGISTER, platform: 'tizen' })).toThrow()
  })

  it('rejects an empty deviceId (after trim)', () => {
    expect(() => registerDeviceSchema.parse({ ...VALID_REGISTER, deviceId: '   ' })).toThrow()
  })

  it('rejects a deviceId longer than 255 chars', () => {
    expect(() => registerDeviceSchema.parse({ ...VALID_REGISTER, deviceId: 'x'.repeat(256) })).toThrow()
  })

  it('rejects a pushToken longer than 4096 chars', () => {
    expect(() => registerDeviceSchema.parse({ ...VALID_REGISTER, pushToken: 'x'.repeat(4097) })).toThrow()
  })

  it('rejects an empty pushToken (min 1 when not null)', () => {
    expect(() => registerDeviceSchema.parse({ ...VALID_REGISTER, pushToken: '' })).toThrow()
  })

  it('rejects a locale shorter than 2 chars', () => {
    expect(() => registerDeviceSchema.parse({ ...VALID_REGISTER, locale: 'e' })).toThrow()
  })

  it('rejects unknown fields (strict mode)', () => {
    expect(() => registerDeviceSchema.parse({ ...VALID_REGISTER, isAdmin: true })).toThrow()
  })

  it('allows null for optional push fields', () => {
    const parsed = registerDeviceSchema.parse({ ...VALID_REGISTER, pushToken: null, pushProvider: null })
    expect(parsed.pushToken).toBeNull()
    expect(parsed.pushProvider).toBeNull()
  })
})

describe('registerDeviceAdminSchema', () => {
  it('requires a valid uuid userId', () => {
    expect(() => registerDeviceAdminSchema.parse({ ...VALID_REGISTER, userId: 'not-a-uuid' })).toThrow()
  })

  it('accepts a valid uuid userId', () => {
    const parsed = registerDeviceAdminSchema.parse({
      ...VALID_REGISTER,
      userId: '11111111-1111-4111-8111-111111111111',
    })
    expect(parsed.userId).toBe('11111111-1111-4111-8111-111111111111')
  })
})

describe('updateDeviceSchema', () => {
  it('distinguishes an omitted push field from an explicit null (tri-state)', () => {
    const cleared = updateDeviceSchema.parse({ pushToken: null })
    expect(Object.prototype.hasOwnProperty.call(cleared, 'pushToken')).toBe(true)
    expect(cleared.pushToken).toBeNull()

    const untouched = updateDeviceSchema.parse({ clientAppVersion: '1.2.3' })
    expect(Object.prototype.hasOwnProperty.call(untouched, 'pushToken')).toBe(false)
  })

  it('coerces lastSeenAt into a Date', () => {
    const parsed = updateDeviceSchema.parse({ lastSeenAt: '2026-01-01T00:00:00.000Z' })
    expect(parsed.lastSeenAt).toBeInstanceOf(Date)
  })

  it('rejects unknown fields (strict mode)', () => {
    expect(() => updateDeviceSchema.parse({ tenantId: '00000000-0000-0000-0000-000000000001' })).toThrow()
  })

  it('accepts an empty partial update', () => {
    expect(updateDeviceSchema.parse({})).toEqual({})
  })
})
