/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import de from '@open-mercato/enterprise/modules/security/i18n/de.json'
import en from '@open-mercato/enterprise/modules/security/i18n/en.json'
import es from '@open-mercato/enterprise/modules/security/i18n/es.json'
import ko from '@open-mercato/enterprise/modules/security/i18n/ko.json'
import pl from '@open-mercato/enterprise/modules/security/i18n/pl.json'
import TotpProviderDetails from '../TotpProviderDetails'
import PasskeyProviderDetails from '../PasskeyProviderDetails'
import MfaProviderMethodListItem from '../MfaProviderMethodListItem'
import type { MfaMethod } from '../../types'

jest.mock('next/navigation.js', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))
jest.mock('next/image', () => ({ __esModule: true, default: () => null }))
jest.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => true,
  startRegistration: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ readApiResultOrThrow: jest.fn() }))

const dictionaries: Record<string, Record<string, string>> = { de, en, es, ko, pl }

const expectedRegisteredText: Record<string, string> = {
  en: 'Registered: less than a minute ago',
  pl: 'Zarejestrowano: mniej niż minutę temu',
  de: 'Registriert: vor weniger als 1 Minute',
  es: 'Registrado: hace menos de un minuto',
  ko: '등록됨: 1분 미만 전',
}

function buildMethod(type: string): MfaMethod {
  const recently = new Date(Date.now() - 20_000).toISOString()
  return {
    id: `${type}-method`,
    type,
    label: 'My device',
    providerMetadata: null,
    lastUsedAt: recently,
    createdAt: recently,
  }
}

function renderInLocale(locale: string, element: React.ReactElement) {
  return render(
    <I18nProvider locale={locale} dict={dictionaries[locale]}>
      {element}
    </I18nProvider>,
  )
}

describe('MFA method relative times follow the UI locale', () => {
  test.each(Object.keys(expectedRegisteredText))('TOTP method list renders registration time in %s', (locale) => {
    renderInLocale(locale, <TotpProviderDetails methods={[buildMethod('totp')]} />)
    expect(screen.getByText(expectedRegisteredText[locale], { normalizer: (text) => text.replace(/\s+/g, ' ').trim() })).toBeTruthy()
  })

  test('passkey method list renders Polish registration and last-used times', () => {
    const { container } = renderInLocale('pl', <PasskeyProviderDetails methods={[buildMethod('passkey')]} />)
    expect(container.textContent).toContain('Zarejestrowano: mniej niż minutę temu')
    expect(container.textContent).not.toContain('ago')
  })

  test('generic method list item renders Polish last-used time', () => {
    const { container } = renderInLocale(
      'pl',
      <MfaProviderMethodListItem method={buildMethod('custom')} onDelete={jest.fn()} />,
    )
    expect(container.textContent).toContain('mniej niż minutę temu')
    expect(container.textContent).not.toContain('ago')
  })
})
