/** @jest-environment jsdom */
import * as React from 'react'
import { render } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { DocumentDirection } from '../DocumentDirection'

describe('DocumentDirection', () => {
  afterEach(() => {
    document.documentElement.dir = ''
  })

  it('mirrors a right-to-left locale onto the document element', () => {
    render(
      <I18nProvider locale="ar" dict={{}}>
        <DocumentDirection />
      </I18nProvider>,
    )

    expect(document.documentElement.dir).toBe('rtl')
  })

  it('mirrors a left-to-right locale, replacing a stale attribute', () => {
    document.documentElement.dir = 'rtl'

    render(
      <I18nProvider locale="en" dict={{}}>
        <DocumentDirection />
      </I18nProvider>,
    )

    expect(document.documentElement.dir).toBe('ltr')
  })

  it('prefers the direction the server rendered when the provider carries one', () => {
    render(
      <I18nProvider locale="ar" dict={{}} direction="ltr">
        <DocumentDirection />
      </I18nProvider>,
    )

    expect(document.documentElement.dir).toBe('ltr')
  })
})
