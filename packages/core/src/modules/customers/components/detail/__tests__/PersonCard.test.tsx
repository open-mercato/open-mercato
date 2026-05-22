/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { PersonCard } from '../PersonCard'

describe('PersonCard', () => {
  it('uses wrap-safe text and stacked mobile actions for narrow layouts', () => {
    renderWithProviders(
      <PersonCard
        person={{
          id: 'person-1',
          displayName: 'avery.long.email.address+with+segments@acme.example.com',
          primaryEmail: 'avery.long.email.address+with+segments@acme.example.com',
          primaryPhone: '+1 555 123 456 789 000',
          status: 'active',
          lifecycleStage: 'customer',
          jobTitle: 'Director of Strategic Relationship Development',
          linkedAt: '2026-04-10T00:00:00.000Z',
          source: 'customer referral',
          temperature: 'warm',
        }}
        onUnlink={() => {}}
      />,
    )

    expect(screen.getAllByText('avery.long.email.address+with+segments@acme.example.com')[0]).toHaveClass('break-words')
    expect(screen.getAllByText('avery.long.email.address+with+segments@acme.example.com')[1]).toHaveClass('break-all')
    expect(screen.getByRole('link', { name: /Open person/i })).toHaveClass('w-full')
    expect(screen.getByRole('button', { name: 'Unlink' })).toHaveClass('w-full')
  })
})
