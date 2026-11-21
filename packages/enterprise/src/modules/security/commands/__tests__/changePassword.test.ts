import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import '../changePassword'

describe('security.password.change session binding', () => {
  test.each(['caller-session', undefined])('uses the authenticated session (%s), ignoring request session ids', async (sid) => {
    const changePassword = jest.fn().mockResolvedValue(undefined)
    const handler = commandRegistry.get('security.password.change')!

    await handler.execute(
      { currentPassword: 'CurrentPass1!', newPassword: 'StrongPass2!', currentSessionId: 'attacker-session' },
      {
        auth: { sub: 'user-1', sid },
        container: { resolve: () => ({ changePassword }) },
      } as never,
    )

    expect(changePassword).toHaveBeenCalledWith('user-1', 'CurrentPass1!', 'StrongPass2!', sid)
  })
})
