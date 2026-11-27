import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { PasswordServiceError } from '../../services/PasswordService'
import '../changePassword'

function buildContext(changePassword: jest.Mock) {
  return {
    auth: { sub: 'user-1' },
    container: {
      resolve: (name: string) => {
        if (name === 'passwordService') return { changePassword }
        throw new Error(`Unexpected dependency: ${name}`)
      },
    },
  } as never
}

describe('security.password.change command', () => {
  test('maps a wrong current password to a 400 field error instead of a session-expiring 401', async () => {
    const handler = commandRegistry.get('security.password.change')
    expect(handler).toBeTruthy()
    const changePassword = jest
      .fn()
      .mockRejectedValue(new PasswordServiceError('Current password is invalid', 400, undefined, 'currentPassword'))

    const execution = handler!.execute(
      { currentPassword: 'WrongPass1!', newPassword: 'StrongPass2!' },
      buildContext(changePassword),
    )

    await expect(execution).rejects.toBeInstanceOf(CrudHttpError)
    await expect(execution).rejects.toMatchObject({
      status: 400,
      body: {
        error: 'Current password is invalid',
        issues: [{ path: ['currentPassword'], message: 'Current password is invalid' }],
      },
    })
    expect(changePassword).toHaveBeenCalledWith('user-1', 'WrongPass1!', 'StrongPass2!', undefined)
  })

  test('keeps policy violations attached to the new password field', async () => {
    const handler = commandRegistry.get('security.password.change')
    const changePassword = jest
      .fn()
      .mockRejectedValue(new PasswordServiceError('Password does not meet the requirements', 400, ['minLength'], 'newPassword'))

    await expect(
      handler!.execute({ currentPassword: 'CurrentPass1!', newPassword: 'StrongPass2!' }, buildContext(changePassword)),
    ).rejects.toMatchObject({
      status: 400,
      body: {
        error: 'Password does not meet the requirements',
        errors: ['minLength'],
        issues: [{ path: ['newPassword'], message: 'Password does not meet the requirements' }],
      },
    })
  })
})
