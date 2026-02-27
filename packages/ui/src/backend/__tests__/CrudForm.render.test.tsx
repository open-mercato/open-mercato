jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('@uiw/react-md-editor', () => ({ __esModule: true, default: () => null }))

import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { act, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
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

describe('CrudForm initialValues', () => {
  const fields: CrudField[] = [{ id: 'name', label: 'Name', type: 'text' }]

  function getInput(container: HTMLElement): HTMLInputElement {
    return container.querySelector('[data-crud-field-id="name"] input[type="text"]') as HTMLInputElement
  }

  it('syncs fields when initialValues data changes', async () => {
    const { container, rerender } = renderWithProviders(
      <CrudForm title="Form" fields={fields} initialValues={{ name: 'Alice' }} onSubmit={() => {}} />
    )

    expect(getInput(container).value).toBe('Alice')

    await act(async () => {
      rerender(
        <CrudForm title="Form" fields={fields} initialValues={{ name: 'Bob' }} onSubmit={() => {}} />
      )
    })

    expect(getInput(container).value).toBe('Bob')
  })

  it('does not reset fields on initialValues reference churn', async () => {
    const { container, rerender } = renderWithProviders(
      <CrudForm title="Form" fields={fields} initialValues={{ name: 'Alice' }} onSubmit={() => {}} />
    )

    const input = getInput(container)
    expect(input.value).toBe('Alice')

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Alice edited' } })
    })

    expect(input.value).toBe('Alice edited')

    await act(async () => {
      rerender(
        <CrudForm title="Form" fields={fields} initialValues={{ name: 'Alice' }} onSubmit={() => {}} />
      )
    })

    expect(input.value).toBe('Alice edited')
  })
})
