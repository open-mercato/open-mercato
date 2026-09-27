/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { RuleSetMembers } from '../RuleSetMembers'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn().mockResolvedValue({ ok: true, result: { items: [] } }),
}))

describe('RuleSetMembers', () => {
  it('associates the visible add-rule labels with their controls', () => {
    renderWithProviders(
      <RuleSetMembers
        members={[]}
        onAdd={jest.fn()}
        onUpdate={jest.fn()}
        onRemove={jest.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'business_rules.sets.members.actions.addRule' }))

    expect(screen.getByRole('combobox', { name: 'business_rules.sets.members.form.selectRule' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'business_rules.sets.members.form.sequence' })).toBeInTheDocument()
  })
})
