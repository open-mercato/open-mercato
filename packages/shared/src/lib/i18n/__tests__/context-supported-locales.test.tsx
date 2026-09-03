import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider, useSupportedLocales } from '../context'
import { clearRegisteredLocales, registerLocales } from '../locale-registry'
import type { Locale } from '../config'

function LocaleList() {
  const supported = useSupportedLocales()
  return React.createElement('span', null, supported.join(','))
}

function render(props: { locale: Locale; dict: {}; supportedLocales?: readonly Locale[] }) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, props, React.createElement(LocaleList)),
  )
}

describe('useSupportedLocales', () => {
  afterEach(() => {
    clearRegisteredLocales()
  })

  it('falls back to the shipped set when the provider is given no prop', () => {
    // Every existing test mounts `<I18nProvider locale dict />` with no
    // `supportedLocales`; that must keep working and keep today's list.
    expect(render({ locale: 'en', dict: {} })).toContain('en,pl,es,de,ko')
  })

  it('reflects locales the app registered at runtime', () => {
    registerLocales(['cs'])

    expect(render({ locale: 'en', dict: {} })).toContain('en,pl,es,de,ko,cs')
  })

  it('prefers the server-resolved prop over the process-local registry', () => {
    // This is the whole point of the prop: a client bundle cannot read tenant
    // configuration, so the server narrows the set and hands it down.
    registerLocales(['cs'])

    const markup = render({
      locale: 'en',
      dict: {},
      supportedLocales: ['en', 'pl'] as readonly Locale[],
    })

    expect(markup).toContain('en,pl')
    expect(markup).not.toContain('cs')
  })

  it('carries a locale the platform does not ship down to the client', () => {
    const markup = render({
      locale: 'cs' as Locale,
      dict: {},
      supportedLocales: ['en', 'cs'] as readonly Locale[],
    })

    expect(markup).toContain('en,cs')
  })

  it('returns the shipped set outside any provider', () => {
    expect(renderToStaticMarkup(React.createElement(LocaleList))).toContain('en,pl,es,de,ko')
  })
})
