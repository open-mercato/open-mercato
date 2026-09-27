/** @jest-environment jsdom */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { FlatRateSettingsEditor } from '../ShippingMethodsSettings'

const translations = {
  title: 'Flat rates', add: 'Add rate', metric: 'Metric', min: 'Minimum', max: 'Maximum',
  amountNet: 'Net amount', amountGross: 'Gross amount', currency: 'Currency',
  remove: 'Remove', applyBaseRate: 'Apply base rate',
}

describe('FlatRateSettingsEditor accessibility', () => {
  it('gives every rate field its visible label', () => {
    render(<FlatRateSettingsEditor value={{ rates: [{ id: 'rate-1', metric: 'item_count', min: 1, max: 10, amountNet: 5, amountGross: 6, currencyCode: 'USD' }] }} onChange={jest.fn()} translations={translations} currencyCode="USD" />)
    for (const label of ['Metric', 'Minimum', 'Maximum', 'Net amount', 'Gross amount', 'Currency']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
  })
})
