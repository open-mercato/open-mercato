import { readSignInActivityConfig } from '../sign-in-activity-config'

const originalEnvironment = process.env
afterEach(() => { process.env = originalEnvironment })

test.each([
  ['', 90],
  ['-4', 1],
  ['732', 730],
  ['5.9', 5],
  ['invalid', 90],
])('clamps retention for %s', (setting, days) => {
  process.env = { ...originalEnvironment, OM_SECURITY_SIGN_IN_RETENTION_DAYS: setting }
  expect(readSignInActivityConfig()).toMatchObject({ retentionDays: days, retentionMs: days * 86_400_000 })
})

test('reads disabled feature and alert switches independently', () => {
  process.env = {
    ...originalEnvironment,
    OM_SECURITY_SIGN_IN_ACTIVITY: 'off',
    OM_SECURITY_SIGN_IN_NOTIFY_NEW_DEVICE: 'false',
  }
  expect(readSignInActivityConfig()).toMatchObject({ enabled: false, notifyNewDevice: false })
})
