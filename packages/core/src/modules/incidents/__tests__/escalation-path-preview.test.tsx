/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { EscalationPathPreview } from '../backend/incidents/components/EscalationPathPreview'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (
    _key: string,
    fallback?: string,
    values?: Readonly<Record<string, string | number>>,
  ) => {
    if (!fallback) return _key
    if (!values) return fallback
    return Object.entries(values).reduce(
      (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
      fallback,
    )
  },
}))

describe('EscalationPathPreview', () => {
  it('renders delays, resolved labels, repeat count, and exhaustion terminus', () => {
    render(
      <EscalationPathPreview
        steps={[
          {
            delayMinutes: 0,
            targets: [
              { type: 'user', id: 'user-1' },
              { type: 'role', id: 'role-1' },
            ],
          },
          {
            delayMinutes: 15,
            targets: [
              { type: 'team', id: 'team-1' },
            ],
          },
        ]}
        repeatCount={2}
        userLabels={{ 'user-1': 'Alice Nguyen' }}
        roleLabels={{ 'role-1': 'Incident commander' }}
        teamLabels={{ 'team-1': 'Platform team' }}
      />,
    )

    expect(screen.getByText('Immediately')).toBeInTheDocument()
    expect(screen.getByText('After 15 min')).toBeInTheDocument()
    expect(screen.getByText('Alice Nguyen')).toBeInTheDocument()
    expect(screen.getByText('Incident commander')).toBeInTheDocument()
    expect(screen.getByText('Platform team')).toBeInTheDocument()
    expect(screen.getByText('Repeats 2 times')).toBeInTheDocument()
    expect(screen.getByText('Then escalation is exhausted')).toBeInTheDocument()
  })
})
