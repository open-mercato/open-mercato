/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { PackageEditor } from '../PackageEditor'

describe('PackageEditor', () => {
  it('associates every package dimension label with its numeric input', () => {
    renderWithProviders(
      <PackageEditor
        packages={[{ weightKg: 1, lengthCm: 20, widthCm: 15, heightCm: 10 }]}
        onChange={jest.fn()}
      />,
    )

    expect(screen.getByRole('spinbutton', { name: 'Weight (kg)' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Length (cm)' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Width (cm)' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Height (cm)' })).toBeInTheDocument()
  })
})
