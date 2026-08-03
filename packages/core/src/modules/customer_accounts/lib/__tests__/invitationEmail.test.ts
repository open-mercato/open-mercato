/** @jest-environment node */

import * as React from 'react'

const mockResolveTranslations = jest.fn()
const mockSendEmail = jest.fn()
const mockUrlForCustomerOrg = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: (...args: unknown[]) => mockResolveTranslations(...args),
}))

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerUrl', () => ({
  urlForCustomerOrg: (...args: unknown[]) => mockUrlForCustomerOrg(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/emails/CustomerInvitationEmail', () => ({
  __esModule: true,
  default: (props: unknown) => React.createElement('customer-invitation-email', props),
}))

describe('sendCustomerInvitationEmail', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveTranslations.mockResolvedValue({
      translate: (key: string, fallback: string) => `${key}:${fallback}`,
    })
    mockUrlForCustomerOrg.mockResolvedValue('https://acme.example/portal/invite?token=raw%20token%2B%2F%3D')
    mockSendEmail.mockResolvedValue(undefined)
  })

  it('builds a portal invite link with the raw one-time token and sends the invite email', async () => {
    const { sendCustomerInvitationEmail } = await import('../invitationEmail')
    const container = { resolve: jest.fn() }

    await sendCustomerInvitationEmail({
      container,
      organizationId: 'org-1',
      email: 'buyer@example.com',
      rawToken: 'raw token+/=',
    })

    expect(mockUrlForCustomerOrg).toHaveBeenCalledWith(
      'org-1',
      '/invite?token=raw%20token%2B%2F%3D',
      { container },
    )
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'buyer@example.com',
      subject: expect.stringContaining('customer_accounts.invitation.email.subject'),
      react: expect.objectContaining({
        props: expect.objectContaining({
          inviteUrl: 'https://acme.example/portal/invite?token=raw%20token%2B%2F%3D',
          copy: expect.objectContaining({
            cta: expect.stringContaining('customer_accounts.invitation.email.cta'),
          }),
        }),
      }),
    })
  })
})
