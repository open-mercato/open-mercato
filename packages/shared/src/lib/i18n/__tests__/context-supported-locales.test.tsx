import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider, useLocaleLocked, useSupportedLocales } from '../context'
import { clearRegisteredLocales, registerLocales } from '../locale-registry'
import type { Locale } from '../config'

function LocaleList() {
  const supported = useSupportedLocales()
  return React.createElement('span', null, supported.join(','))
}

function LocaleLockedFlag() {
  return React.createElement('span', null, String(useLocaleLocked()))
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

  it('inherits the served set from an enclosing provider when the prop is omitted', () => {
    // The backend layout mounts a second provider inside the root layout's. An
    // omitted prop there must mean "unchanged", not "reset to the registry",
    // or the whole admin subtree silently loses the tenant narrowing.
    const markup = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { locale: 'en' as Locale, dict: {}, supportedLocales: ['en', 'pl'] as readonly Locale[] },
        React.createElement(
          I18nProvider,
          { locale: 'en' as Locale, dict: {} },
          React.createElement(LocaleList),
        ),
      ),
    )

    expect(markup).toContain('en,pl')
    expect(markup).not.toContain('es')
  })

  it('lets an inner provider override the inherited set', () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { locale: 'en' as Locale, dict: {}, supportedLocales: ['en', 'pl'] as readonly Locale[] },
        React.createElement(
          I18nProvider,
          { locale: 'en' as Locale, dict: {}, supportedLocales: ['en', 'de'] as readonly Locale[] },
          React.createElement(LocaleList),
        ),
      ),
    )

    expect(markup).toContain('en,de')
  })
})

describe('useLocaleLocked', () => {
  it('inherits the locked flag from an enclosing provider when the prop is omitted', () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { locale: 'en' as Locale, dict: {}, localeLocked: true },
        React.createElement(
          I18nProvider,
          { locale: 'en' as Locale, dict: {} },
          React.createElement(LocaleLockedFlag),
        ),
      ),
    )

    expect(markup).toContain('true')
  })

  it('is false outside any provider and for a provider that sets nothing', () => {
    expect(renderToStaticMarkup(React.createElement(LocaleLockedFlag))).toContain('false')
    expect(
      renderToStaticMarkup(
        React.createElement(
          I18nProvider,
          { locale: 'en' as Locale, dict: {} },
          React.createElement(LocaleLockedFlag),
        ),
      ),
    ).toContain('false')
  })
})
