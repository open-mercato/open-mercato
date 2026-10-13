/**
 * @jest-environment jsdom
 *
 * Regression test for issue #5011.
 *
 * The challenge panel painted a hardcoded `slate-950` card inside the light login card, while
 * the DS buttons rendered by the provider verify components resolved light-theme tokens, so
 * "Verify" and "Resend code" came out washed out. The panel and every provider verify
 * component must use semantic DS tokens only, never raw palette shades.
 */
import * as React from 'react'
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import MfaChallengePanel from '../MfaChallengePanel'
import OtpEmailChallengeVerify from '../OtpEmailChallengeVerify'
import TotpChallengeVerify from '../TotpChallengeVerify'
import RecoveryCodeChallengeVerify from '../RecoveryCodeChallengeVerify'
import PasskeyChallengeVerify from '../PasskeyChallengeVerify'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(async () => ({ ok: true })),
}))

const RAW_PALETTE_CLASS = /(?:^|\s|:)(?:text|bg|border|placeholder|ring)-(?:slate|gray|zinc|neutral|stone|red|amber|emerald|green)-\d{2,3}(?:\s|$)/

function expectNoRawPaletteClasses(container: HTMLElement) {
  const offenders = Array.from(container.querySelectorAll<HTMLElement>('[class]'))
    .map((element) => element.getAttribute('class') ?? '')
    .filter((className) => RAW_PALETTE_CLASS.test(className))
  expect(offenders).toEqual([])
}

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider locale="en" dict={{}}>{ui}</I18nProvider>)
}

const verifyProps = {
  loading: false,
  onVerify: jest.fn(async () => {}),
  onPrepare: jest.fn(async () => ({})),
  onResend: jest.fn(async () => {}),
  submitLabel: 'Verify',
}

describe('MFA challenge DS contrast (issue #5011)', () => {
  it('renders the challenge panel on a DS card surface without raw palette shades', async () => {
    const { container } = renderWithI18n(
      <MfaChallengePanel
        challengeId="challenge-1"
        availableMethods={[{ type: 'otp_email', label: 'Email code', icon: 'Mail' }]}
        onBack={jest.fn()}
      />,
    )
    const panel = screen.getByTestId('security-mfa-challenge-panel')
    expect(panel).toHaveClass('bg-card', 'text-card-foreground')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument())
    expectNoRawPaletteClasses(container)
  })

  it.each([
    ['otp_email', OtpEmailChallengeVerify],
    ['totp', TotpChallengeVerify],
    ['recovery_code', RecoveryCodeChallengeVerify],
    ['passkey', PasskeyChallengeVerify],
  ])('renders the %s verify component with semantic tokens only', (type, Component) => {
    const { container } = renderWithI18n(
      <Component method={{ type, label: type, icon: 'KeyRound' }} {...verifyProps} />,
    )
    expectNoRawPaletteClasses(container)
  })
})
