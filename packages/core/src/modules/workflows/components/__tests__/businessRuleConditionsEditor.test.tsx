/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { BusinessRuleConditionsEditor } from '../fields/BusinessRuleConditionsEditor'

jest.mock('@open-mercato/ui/backend/utils/api', () => ({
  apiFetch: jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ items: [] }),
  }),
}))

describe('BusinessRuleConditionsEditor accessibility', () => {
  it('names the icon-only control that removes a condition', async () => {
    renderWithProviders(
      <BusinessRuleConditionsEditor
        id="conditions"
        value={['rule-1']}
        setValue={jest.fn()}
        disabled={false}
      />,
    )

    expect(
      await screen.findByRole('button', {
        name: 'workflows.fieldEditors.businessRuleConditions.removeCondition',
      }),
    ).toBeInTheDocument()
  })
})
