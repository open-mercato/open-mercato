/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ConfigureStep } from '../ConfigureStep'

describe('ConfigureStep', () => {
  it('associates the contact and sending-method labels with their controls', () => {
    renderWithProviders(
      <ConfigureStep
        origin={{ countryCode: 'PL', postalCode: '00-001', city: 'Warsaw', line1: 'Origin' }}
        destination={{ countryCode: 'PL', postalCode: '00-002', city: 'Warsaw', line1: 'Destination' }}
        packages={[{ weightKg: 1, lengthCm: 20, widthCm: 15, heightCm: 10 }]}
        labelFormat="pdf"
        senderContact={{ phone: '', email: '' }}
        receiverContact={{ phone: '', email: '' }}
        targetPoint=""
        c2cSendingMethod=""
        isFetchingRates={false}
        canProceed={false}
        senderContactErrors={{ email: null, phone: null }}
        receiverContactErrors={{ email: null, phone: null }}
        dropOffPointQuery=""
        dropOffPoints={[]}
        isFetchingDropOffPoints={false}
        dropOffPointsError={null}
        onOriginChange={jest.fn()}
        onDestinationChange={jest.fn()}
        onPackagesChange={jest.fn()}
        onLabelFormatChange={jest.fn()}
        onSenderContactChange={jest.fn()}
        onReceiverContactChange={jest.fn()}
        onTargetPointChange={jest.fn()}
        onC2cSendingMethodChange={jest.fn()}
        onSearchDropOffPoints={jest.fn()}
        onBack={jest.fn()}
        onNext={jest.fn()}
      />,
    )

    expect(screen.getAllByRole('textbox', { name: 'Phone' })).toHaveLength(2)
    expect(screen.getAllByRole('textbox', { name: 'Email' })).toHaveLength(2)
    expect(screen.getByRole('combobox', { name: 'Sending method (applies to courier_c2c service only)' })).toBeInTheDocument()
  })
})
