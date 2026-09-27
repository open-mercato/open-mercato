/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { FilterOverlay, type FilterDef } from '../FilterOverlay'

function renderOverlay(filters: FilterDef[]) {
  return render(
    <I18nProvider locale="en" dict={{}}>
      <FilterOverlay
        open={true}
        onOpenChange={() => {}}
        filters={filters}
        initialValues={{}}
        onApply={() => {}}
        onClear={() => {}}
      />
    </I18nProvider>,
  )
}

describe('FilterOverlay accessible names', () => {
  it('labels text and select controls with their filter labels', () => {
    renderOverlay([
      { id: 'identifier', label: 'Identifier', type: 'text' },
      {
        id: 'type',
        label: 'Type',
        type: 'select',
        options: [{ value: 'boolean', label: 'Boolean' }],
      },
    ])

    expect(screen.getByRole('textbox', { name: 'Identifier' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Type' })).toBeInTheDocument()
  })
})
