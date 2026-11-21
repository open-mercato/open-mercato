/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import pl from '@open-mercato/enterprise/modules/security/i18n/pl.json'
import en from '@open-mercato/enterprise/modules/security/i18n/en.json'
import MfaProviderMethodsPage from '../[providername]/page'

jest.mock('next/navigation.js', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: () => null,
  ErrorMessage: () => null,
}))
jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('@open-mercato/ui/backend/forms/FormHeader.tsx', () => ({
  FormHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn() }),
}))
jest.mock('@open-mercato/enterprise/modules/security/components/hooks/useMfaStatus', () => ({
  useMfaStatus: () => ({
    loading: false,
    saving: false,
    providers: [
      { type: 'totp', label: 'Authenticator App', icon: 'Smartphone', allowMultiple: false },
      { type: 'custom', label: 'Custom provider', icon: 'Shield', allowMultiple: true },
    ],
    methods: [],
    removeMethod: jest.fn(),
    reload: jest.fn(),
  }),
}))
jest.mock('@open-mercato/enterprise/modules/security/components/mfa-ui-registry', () => ({
  useProviderDetailsComponent: () => () => null,
}))

describe('Polish MFA setup and login labels', () => {
  test('translates the built-in TOTP page title', () => {
    render(
      <I18nProvider locale="pl" dict={pl}>
        <MfaProviderMethodsPage params={{ providername: 'totp' }} />
      </I18nProvider>,
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Aplikacja uwierzytelniająca')
  })

  test('preserves third-party provider labels', () => {
    render(
      <I18nProvider locale="pl" dict={pl}>
        <MfaProviderMethodsPage params={{ providername: 'custom' }} />
      </I18nProvider>,
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Custom provider')
  })

  test.each([
    ['security.profile.mfa.totp.scanTitle', 'Zeskanuj kod QR'],
    ['security.profile.mfa.totp.manualHint', 'Nie możesz zeskanować kodu? Użyj klucza konfiguracji, aby skonfigurować aplikację uwierzytelniającą.'],
    ['security.profile.mfa.totp.verifyTitle', 'Zweryfikuj kod z aplikacji'],
    ['security.profile.mfa.totp.setupError', 'Nie udało się przygotować konfiguracji aplikacji uwierzytelniającej.'],
    ['security.profile.mfa.totp.confirmError', 'Nie udało się włączyć aplikacji uwierzytelniającej.'],
    ['security.profile.mfa.totp.loadingQr', 'Przygotowywanie kodu QR...'],
    ['security.profile.mfa.totp.loadingQrFallback', 'Kod QR jest niedostępny'],
    ['security.login.mfaChallenge.totp.title', 'Uwierzytelnianie dwuskładnikowe'],
    ['security.login.mfaChallenge.totp.description', 'Wpisz poniżej kod z aplikacji do uwierzytelniania dwuskładnikowego lub rozszerzenia przeglądarki.'],
    ['security.login.mfaChallenge.totp.codeLabel', 'Kod weryfikacyjny'],
    ['security.login.mfaChallenge.actions.moreOptions', 'Więcej opcji'],
    ['security.login.mfaChallenge.passkey.title', 'Weryfikacja kluczem dostępu'],
    ['ui.table.registeredAt', 'Zarejestrowano'],
  ])('provides Polish text for %s', (key, expected) => {
    const polish: Record<string, string> = pl
    const english: Record<string, string> = en
    expect(polish[key]).toBe(expected)
    expect(polish[key]).not.toBe(english[key])
  })
})
