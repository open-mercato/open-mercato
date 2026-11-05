/** @jest-environment jsdom */

import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CollapsibleGroup } from '../CollapsibleGroup'

describe('CollapsibleGroup', () => {
  it('keeps accepting the deprecated fieldCount prop without rendering it', () => {
    renderWithProviders(
      <CollapsibleGroup groupId="details" pageType="test-page" title="Details" fieldCount={7}>
        <span>Group content</span>
      </CollapsibleGroup>,
    )
    expect(screen.getByRole('button', { name: /Details/ })).toBeInTheDocument()
    expect(screen.queryByText('7')).not.toBeInTheDocument()
  })
})
