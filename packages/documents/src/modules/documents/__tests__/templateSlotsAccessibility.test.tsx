/** @jest-environment jsdom */

import * as React from 'react'
import { render, screen } from '@testing-library/react'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))

jest.mock('../backend/documents/components/useAvailableEntityRegistry', () => ({
  useAvailableDocumentEntityRegistry: (entries: unknown[]) => ({ entries, isRegistryReady: true }),
}))

import { TemplateSlotsEditor } from '../backend/documents/components/TemplateSlotsEditor'

describe('TemplateSlotsEditor accessibility', () => {
  it('associates each entity-type label with its select trigger', () => {
    render(
      <TemplateSlotsEditor
        slots={[{ slot: 'customer', entityType: 'customer-person', required: true }]}
        onChange={jest.fn()}
      />,
    )

    const select = screen.getByRole('combobox', { name: 'documents.templates.slots.entityType' })
    const label = screen.getByText('documents.templates.slots.entityType')

    expect(select.id).toBe('document-template-slot-entity-type-0')
    expect(label.getAttribute('for')).toBe(select.id)
  })
})
