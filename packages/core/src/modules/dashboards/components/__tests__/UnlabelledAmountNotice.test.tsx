/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { UnlabelledAmountNotice } from '../UnlabelledAmountNotice'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

describe('UnlabelledAmountNotice', () => {
  test('explains a deliberately unlabelled amount without asserting a specific cause', () => {
    render(<UnlabelledAmountNotice currency={null} />)

    const notice = screen.getByText('Amounts shown without a currency')
    expect(notice).toBeInTheDocument()
    expect(notice).toHaveAttribute(
      'title',
      'A reliable currency could not be determined, so the amount is shown without one.',
    )
  })

  test.each([
    { currency: 'PLN', loading: false, error: null },
    { currency: null, loading: true, error: null },
    { currency: null, loading: false, error: 'Unavailable' },
  ])('stays hidden when the widget already communicates its state', (props) => {
    render(<UnlabelledAmountNotice {...props} />)

    expect(screen.queryByText('Amounts shown without a currency')).not.toBeInTheDocument()
  })
})
