/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => ({
    'documents.actions.export': 'Export',
    'documents.export.docx': 'Word document',
    'documents.export.pdf': 'PDF document',
  })[key] ?? key,
}))

import { ExportMenu } from '../backend/documents/[id]/ExportMenu'

describe('Document ExportMenu pointer interactions', () => {
  it('stays open when a mouse enters the trigger before clicking it', async () => {
    render(<ExportMenu documentId="11111111-1111-4111-8111-111111111111" editor={null} />)

    const trigger = screen.getByRole('button', { name: 'Export' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    fireEvent.mouseEnter(trigger)
    fireEvent.click(trigger)

    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Word document' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'PDF document' })).toBeTruthy()
  })
})
