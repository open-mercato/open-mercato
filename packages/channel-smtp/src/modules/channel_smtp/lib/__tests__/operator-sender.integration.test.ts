import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { sendSystemEmail } from '@open-mercato/core/modules/communication_channels/lib/system-email'
import { getSmtpChannelAdapter } from '../adapter'
import { registerSmtpSystemEmailConfigResolver } from '../system-email-config'
import { setSmtpTransport } from '../transport'

describe('operator sender through the system email hub', () => {
  const originalEnv = process.env

  afterEach(() => {
    process.env = originalEnv
    setSmtpTransport(null)
  })

  it('pins an explicit caller sender after resolving operator credentials and converting the message', async () => {
    process.env = {
      ...originalEnv,
      SYSTEM_EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'relay.example.com',
      SMTP_USER: 'operator',
      SMTP_PASSWORD: 'operator-password',
      NOTIFICATIONS_EMAIL_FROM: 'approved@example.com',
    }
    registerSmtpSystemEmailConfigResolver()
    const send = jest.fn().mockResolvedValue({ messageId: 'sent-1' })
    setSmtpTransport({ send, async verify() {} })
    const adapter = getSmtpChannelAdapter()
    const container = {
      resolve(name: string) {
        if (name === 'em') return { fork: () => ({}) }
        if (name === 'channelAdapterRegistry') return { get: () => adapter }
        throw new Error('[internal] Unexpected dependency')
      },
    } as unknown as AppContainer

    await sendSystemEmail(container, {
      to: 'recipient@example.com',
      from: 'security@another-tenant.example',
      subject: 'Hello',
      text: 'Body',
    })

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ password: 'operator-password' }),
      expect.objectContaining({ from: 'approved@example.com', to: ['recipient@example.com'] }),
    )
  })
})
