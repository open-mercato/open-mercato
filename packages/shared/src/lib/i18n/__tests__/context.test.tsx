import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider, useT } from '../context'

function Greeting() {
  const t = useT()
  return React.createElement('span', null, t('greeting', 'hello'))
}

describe('I18nProvider', () => {
  it('accepts children positionally via React.createElement, matching props without a children key', () => {
    const element = React.createElement(
      I18nProvider,
      { locale: 'en', dict: {} },
      React.createElement(Greeting),
    )

    expect(renderToStaticMarkup(element)).toContain('hello')
  })

  it('renders with no children at all', () => {
    const element = React.createElement(I18nProvider, { locale: 'en', dict: {} })

    expect(renderToStaticMarkup(element)).toBe('')
  })
})
