/** @jest-environment jsdom */

import { EDITOR_PRESENCE_STYLES } from '../backend/documents/[id]/editorPresenceStyles'
import { renderCollaborationCaret } from '../lib/editorConfig'

const USER_ID = '11111111-1111-4111-8111-111111111111'

describe('collaborator caret identity', () => {
  it('exposes a safe hover and keyboard-focus identity without a GUID fallback', () => {
    const caret = renderCollaborationCaret({
      name: `Remote ${USER_ID}`,
      color: '#123456',
    }, 'Unknown user')

    expect(caret.getAttribute('role')).toBe('img')
    expect(caret.getAttribute('aria-label')).toBe('Unknown user')
    expect(caret.getAttribute('title')).toBe('Unknown user')
    expect(caret.getAttribute('tabindex')).toBe('0')
    expect(caret.getAttribute('contenteditable')).toBe('false')
    expect(caret.textContent).toBe('Unknown user')
    expect(caret.outerHTML).not.toContain(USER_ID)
  })

  it('keeps the caret hoverable and reveals the label for hover or focus', () => {
    expect(EDITOR_PRESENCE_STYLES).toContain('pointer-events: auto')
    expect(EDITOR_PRESENCE_STYLES).toContain('collaboration-carets__caret::before')
    expect(EDITOR_PRESENCE_STYLES).toContain('collaboration-carets__caret:hover')
    expect(EDITOR_PRESENCE_STYLES).toContain('collaboration-carets__caret:focus-visible')
  })
})
