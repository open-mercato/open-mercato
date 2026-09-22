/** @jest-environment jsdom */

import * as React from 'react'
import { render, screen } from '@testing-library/react'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))

import { EditorStatusPresence } from '../backend/documents/[id]/EditorStatusPresence'

describe('EditorStatusPresence', () => {
  it('keeps connection changes in a polite atomic live status region', () => {
    const props = {
      users: [],
      counts: { words: 2, characters: 12 },
      mode: 'edit' as const,
      canEdit: false,
      onModeChange: jest.fn(),
    }
    const { rerender } = render(<EditorStatusPresence {...props} status="connected" />)
    const liveStatus = screen.getByRole('status')

    expect(liveStatus.getAttribute('aria-live')).toBe('polite')
    expect(liveStatus.getAttribute('aria-atomic')).toBe('true')
    expect(liveStatus.textContent).toContain('documents.editor.realtime.connected')

    rerender(<EditorStatusPresence {...props} status="offline" />)

    expect(screen.getByRole('status')).toBe(liveStatus)
    expect(liveStatus.textContent).toContain('documents.editor.realtime.offline')
  })
})
