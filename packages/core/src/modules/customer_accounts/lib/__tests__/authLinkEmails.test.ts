/** @jest-environment node */

import * as React from 'react'

const mockLoadDictionary = jest.fn()
const mockCreateFallbackTranslator = jest.fn()
const mockSendEmail = jest.fn()
const mockUrlForCustomerOrg = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  loadDictionary: (...args: unknown[]) => mockLoadDictionary(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/translate', () => ({
  createFallbackTranslator: (...args: unknown[]) => mockCreateFallbackTranslator(...args),
}))

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerUrl', () => ({
  urlForCustomerOrg: (...args: unknown[]) => mockUrlForCustomerOrg(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/emails/CustomerAuthLinkEmail', () => ({
  __esModule: true,
  default: (props: unknown) => React.createElement('customer-auth-link-email', props),
}))

const input = {
  container: { resolve: jest.fn() },
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  email: 'buyer@example.com',
  rawToken: 'raw token+/=',
  locale: 'en' as const,
}

describe('customer auth link emails', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLoadDictionary.mockResolvedValue({})
    mockCreateFallbackTranslator.mockReturnValue((key: string, fallback: string) => `${key}:${fallback}`)
    mockUrlForCustomerOrg.mockImplementation(async (_orgId: string, path: string) => `https://acme.example/portal${path}`)
    mockSendEmail.mockResolvedValue(undefined)
  })

  it('sends a password reset email linking to the portal reset-password page with the raw token', async () => {
    const { sendCustomerPasswordResetEmail } = await import('../authLinkEmails')

    await sendCustomerPasswordResetEmail(input)

    expect(mockLoadDictionary).toHaveBeenCalledWith('en')
    expect(mockUrlForCustomerOrg).toHaveBeenCalledWith(
      'org-1',
      '/reset-password?token=raw%20token%2B%2F%3D',
      { container: input.container },
    )
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'buyer@example.com',
      subject: expect.stringContaining('customer_accounts.passwordReset.email.subject'),
      react: expect.objectContaining({
        props: expect.objectContaining({
          linkUrl: 'https://acme.example/portal/reset-password?token=raw%20token%2B%2F%3D',
          copy: expect.objectContaining({
            cta: expect.stringContaining('customer_accounts.passwordReset.email.cta'),
          }),
        }),
      }),
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })

  it('sends a magic link email linking to the portal magic-link page with the raw token', async () => {
    const { sendCustomerMagicLinkEmail } = await import('../authLinkEmails')

    await sendCustomerMagicLinkEmail(input)

    expect(mockLoadDictionary).toHaveBeenCalledWith('en')
    expect(mockUrlForCustomerOrg).toHaveBeenCalledWith(
      'org-1',
      '/magic-link?token=raw%20token%2B%2F%3D',
      { container: input.container },
    )
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'buyer@example.com',
      subject: expect.stringContaining('customer_accounts.magicLink.email.subject'),
      react: expect.objectContaining({
        props: expect.objectContaining({
          linkUrl: 'https://acme.example/portal/magic-link?token=raw%20token%2B%2F%3D',
          copy: expect.objectContaining({
            cta: expect.stringContaining('customer_accounts.magicLink.email.cta'),
          }),
        }),
      }),
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })
})
