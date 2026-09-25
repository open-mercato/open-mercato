import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider, useDirection } from '../context'
import { clearRegisteredTextDirections, registerTextDirections } from '../direction'
import type { Locale } from '../config'
import type { TextDirection } from '../direction'

function DirectionProbe() {
  return React.createElement('span', null, useDirection())
}

function render(props: { locale: Locale; dict: {}; direction?: TextDirection }) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, props, React.createElement(DirectionProbe)),
  )
}

describe('useDirection', () => {
  afterEach(() => {
    clearRegisteredTextDirections()
  })

  it('derives the direction from the active locale', () => {
    expect(render({ locale: 'ar', dict: {} })).toContain('rtl')
    expect(render({ locale: 'de', dict: {} })).toContain('ltr')
  })

  it('prefers the explicit prop — the value the server rendered into <html dir>', () => {
    expect(render({ locale: 'ar', dict: {}, direction: 'ltr' })).toContain('ltr')
    expect(render({ locale: 'en', dict: {}, direction: 'rtl' })).toContain('rtl')
  })

  it('reflects a direction the app registered at runtime', () => {
    registerTextDirections({ ko: 'rtl' })

    expect(render({ locale: 'ko', dict: {} })).toContain('rtl')
  })

  it('falls back to left-to-right outside a provider', () => {
    expect(renderToStaticMarkup(React.createElement(DirectionProbe))).toContain('ltr')
  })
})
