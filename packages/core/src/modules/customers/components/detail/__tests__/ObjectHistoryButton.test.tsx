/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ObjectHistoryButton } from '../ObjectHistoryButton'

describe('ObjectHistoryButton', () => {
  it('renders a Version History trigger when resourceId is present', () => {
    renderWithProviders(
      <ObjectHistoryButton
        resourceKind="customers.person"
        resourceId="person-1"
        organizationId="org-1"
      />,
    )

    const button = screen.getByRole('button', { name: 'audit_logs.version_history.title' })
    expect(button).toBeInTheDocument()
  })

  it('applies the outline icon-button visual via buttonClassName override', () => {
    renderWithProviders(
      <ObjectHistoryButton
        resourceKind="customers.company"
        resourceId="company-1"
      />,
    )

    const button = screen.getByRole('button', { name: 'audit_logs.version_history.title' })
    expect(button.className).toEqual(expect.stringContaining('size-8'))
    expect(button.className).toEqual(expect.stringContaining('rounded-md'))
    expect(button.className).toEqual(expect.stringContaining('border'))
    expect(button.className).toEqual(expect.stringContaining('bg-background'))
  })

  it('does not render when resourceId is an empty string', () => {
    renderWithProviders(
      <ObjectHistoryButton
        resourceKind="customers.deal"
        resourceId=""
      />,
    )

    expect(screen.queryByRole('button', { name: 'audit_logs.version_history.title' })).not.toBeInTheDocument()
  })
})
