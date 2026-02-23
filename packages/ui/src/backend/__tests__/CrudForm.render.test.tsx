jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('@uiw/react-md-editor', () => ({ __esModule: true, default: () => null }))

import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { CrudForm, type CrudField } from '../CrudForm'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

describe('CrudForm SSR render', () => {
  it('renders base fields', () => {
    const fields: CrudField[] = [
      { id: 'title', label: 'Title', type: 'text' },
      { id: 'is_done', label: 'Done', type: 'checkbox' },
    ]
    const html = renderToString(
      React.createElement(
        I18nProvider as any,
        { locale: 'en', dict: {} },
        React.createElement(CrudForm as any, {
          title: 'Form',
          fields,
          onSubmit: () => {},
        })
      )
    )
    expect(html).toContain('Title')
    expect(html).toContain('Done')
  })
})
