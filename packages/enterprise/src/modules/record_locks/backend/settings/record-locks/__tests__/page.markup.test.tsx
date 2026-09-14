/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ result: { settings: undefined } })),
  apiCallOrThrow: jest.fn(async () => ({ result: { settings: undefined } })),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/core/generated-shims/entities.ids.generated', () => ({
  E: { sales: { sales_order: 'sales:order' } },
}))

import RecordLockingSettingsPage from '../page'

describe('record locking settings page markup', () => {
  it('renders the strategy help text without nesting a <p> inside a <p>', async () => {
    const { container } = render(
      <I18nProvider locale="en" dict={{}}>
        <RecordLockingSettingsPage />
      </I18nProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Strategy')).toBeInTheDocument()
    })

    // React logs a hydration error for <p> inside <p>; assert the invalid nesting
    // is absent rather than relying on console output.
    expect(container.querySelectorAll('p p')).toHaveLength(0)
    expect(
      screen.getByText('Multiple users can edit at the same time; conflicts are checked on save.', {
        exact: false,
      }),
    ).toBeInTheDocument()
  })
})
