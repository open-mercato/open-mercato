const translations: Record<string, string> = {
  'security.api.errors.currentPasswordInvalid': 'La contraseña actual es incorrecta.',
  'security.api.errors.newPasswordSameAsCurrent': 'La nueva contraseña debe ser diferente de la contraseña actual.',
  'security.profile.password.form.errors.passwordPolicy': 'La contraseña no cumple los requisitos.',
}

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback: string) => translations[key] ?? fallback,
  }),
}))

import { localizeSecurityApiBody } from '../i18n'

describe('localizeSecurityApiBody password change errors', () => {
  test('translates the wrong current password error and its field issue', async () => {
    const body = await localizeSecurityApiBody({
      error: 'Current password is invalid',
      issues: [{ path: ['currentPassword'], message: 'Current password is invalid' }],
    })

    expect(body).toEqual({
      error: 'La contraseña actual es incorrecta.',
      issues: [{ path: ['currentPassword'], message: 'La contraseña actual es incorrecta.' }],
    })
  })

  test.each([
    ['New password must be different from current password', 'La nueva contraseña debe ser diferente de la contraseña actual.'],
    ['Password does not meet the requirements', 'La contraseña no cumple los requisitos.'],
  ])('translates "%s"', async (message, expected) => {
    const body = await localizeSecurityApiBody({ error: message })
    expect(body.error).toBe(expected)
  })

  test('leaves unknown issue messages untouched', async () => {
    const issues = [{ path: ['name'], message: 'Custom validator message' }]
    const body = await localizeSecurityApiBody({ error: 'Invalid payload', issues })
    expect(body.issues).toEqual(issues)
  })
})
