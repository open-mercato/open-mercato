/**
 * @jest-environment jsdom
 */
// D-3: after creation the currency can only move through the change-currency
// action, and `buildProjectPayload` no longer emits `currencyCode` on update.
// The field must therefore never offer an editable select on a persisted
// project — including one with zero entries, where it used to look editable and
// have the value silently dropped on save.
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { ProjectCurrencyField } from '../ProjectCurrencyField'

const mockTranslate = (_key: string, fallback?: string) => fallback ?? ''

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, result: { items: [] } })),
  withScopedApiRequestHeaders: jest.fn(async (_headers: unknown, run: () => Promise<unknown>) => run()),
}))

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const OPTIONS = [{ value: 'EUR', label: 'EUR' }, { value: 'PLN', label: 'PLN' }]

describe('ProjectCurrencyField', () => {
  it('renders an editable select while the project is still being created', () => {
    render(
      <ProjectCurrencyField
        value="EUR"
        locked={false}
        entryCount={0}
        projectId={null}
        options={OPTIONS}
        onChange={jest.fn()}
      />,
    )

    expect(screen.getByRole('combobox')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Change currency' })).toBeNull()
  })

  it('renders read-only with the change action for a saved project with no entries', () => {
    render(
      <ProjectCurrencyField
        value="EUR"
        locked={false}
        entryCount={0}
        projectId={PROJECT_ID}
        options={OPTIONS}
        onChange={jest.fn()}
      />,
    )

    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Change currency' })).toBeTruthy()
  })

  it('renders read-only with the change action once entries exist', () => {
    render(
      <ProjectCurrencyField
        value="EUR"
        locked
        entryCount={12}
        projectId={PROJECT_ID}
        options={OPTIONS}
        onChange={jest.fn()}
      />,
    )

    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Change currency' })).toBeTruthy()
  })
})
