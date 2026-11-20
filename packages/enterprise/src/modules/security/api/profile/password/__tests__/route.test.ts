import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { PasswordServiceError } from '../../../../services/PasswordService'
import '../../../../commands/changePassword'

const spanishTranslations: Record<string, string> = {
  'api.errors.unauthorized': 'No autorizado',
  'api.errors.invalidPayload': 'Carga útil no válida.',
  'security.api.errors.currentPasswordInvalid': 'La contraseña actual es incorrecta.',
  'security.profile.password.form.errors.passwordPolicy': 'La contraseña no cumple los requisitos.',
}

const mockGetAuthFromRequest = jest.fn()
const mockChangePassword = jest.fn()
const mockExecute = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback: string) => spanishTranslations[key] ?? fallback,
  }),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => {
    const container = {
      resolve: (name: string) => {
        if (name === 'passwordService') return { changePassword: mockChangePassword }
        if (name === 'commandBus') return { execute: mockExecute }
        throw new Error(`[internal] Unexpected dependency: ${name}`)
      },
    }
    return container
  },
}))

import { PUT } from '../route'

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/security/profile/password', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PUT /api/security/profile/password', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    mockExecute.mockImplementation(async (commandId: string, options: { input: unknown; ctx: never }) => {
      const handler = commandRegistry.get(commandId)
      if (!handler) throw new Error(`[internal] Missing command: ${commandId}`)
      return handler.execute(options.input, options.ctx)
    })
  })

  test('keeps a missing session as 401 without reaching the password change', async () => {
    mockGetAuthFromRequest.mockResolvedValue(null)

    const response = await PUT(buildRequest({ currentPassword: 'CurrentPass1!', newPassword: 'StrongPass2!' }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'No autorizado' })
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockChangePassword).not.toHaveBeenCalled()
  })

  test('answers a wrong current password with a localized 400 field error', async () => {
    mockChangePassword.mockRejectedValue(
      new PasswordServiceError('Current password is invalid', 400, undefined, 'currentPassword'),
    )

    const response = await PUT(buildRequest({ currentPassword: 'WrongPass1!', newPassword: 'StrongPass2!' }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'La contraseña actual es incorrecta.',
      issues: [{ path: ['currentPassword'], message: 'La contraseña actual es incorrecta.' }],
    })
    expect(mockChangePassword).toHaveBeenCalledWith('user-1', 'WrongPass1!', 'StrongPass2!')
  })

  test('localizes the schema password policy rejection before the command runs', async () => {
    const response = await PUT(buildRequest({ currentPassword: 'CurrentPass1!', newPassword: 'abc' }))

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string; issues: Array<{ path: string[]; message: string }> }
    expect(body.error).toBe('Carga útil no válida.')
    const newPasswordMessages = body.issues
      .filter((issue) => issue.path[0] === 'newPassword')
      .map((issue) => issue.message)
    expect(newPasswordMessages.length).toBeGreaterThan(0)
    expect(newPasswordMessages.every((message) => message === 'La contraseña no cumple los requisitos.')).toBe(true)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  test('changes the password when the current password is correct', async () => {
    mockChangePassword.mockResolvedValue(undefined)

    const response = await PUT(buildRequest({ currentPassword: 'CurrentPass1!', newPassword: 'StrongPass2!' }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(mockChangePassword).toHaveBeenCalledWith('user-1', 'CurrentPass1!', 'StrongPass2!')
  })
})
