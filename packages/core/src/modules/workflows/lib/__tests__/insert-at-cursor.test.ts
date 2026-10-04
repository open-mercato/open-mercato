/**
 * Step 3.2 (workflows UX Phase 2a): pure cursor-aware insertion shared by the
 * variable picker. Insertion splices at the selection, replaces a ranged
 * selection, appends when no selection is known, clamps out-of-range
 * positions, and reports the cursor position immediately after the insertion.
 */
import { insertAtCursor, insertAtElementCursor } from '../insert-at-cursor'

describe('insertAtCursor', () => {
  it('splices the insertion at a collapsed cursor position', () => {
    expect(insertAtCursor('hello world', '{{deal.id}}', 5, 5)).toEqual({
      value: 'hello{{deal.id}} world',
      cursor: 16,
    })
  })

  it('replaces the selected range', () => {
    expect(insertAtCursor('hello world', '{{name}}', 6, 11)).toEqual({
      value: 'hello {{name}}',
      cursor: 14,
    })
  })

  it('appends at the end when no selection is known', () => {
    expect(insertAtCursor('abc', '{{x}}', null, null)).toEqual({
      value: 'abc{{x}}',
      cursor: 8,
    })
  })

  it('inserts into an empty value', () => {
    expect(insertAtCursor('', '{{x}}', 0, 0)).toEqual({ value: '{{x}}', cursor: 5 })
  })

  it('clamps out-of-range selection positions', () => {
    expect(insertAtCursor('abc', '!', 99, 120)).toEqual({ value: 'abc!', cursor: 4 })
    expect(insertAtCursor('abc', '!', -4, -2)).toEqual({ value: '!abc', cursor: 1 })
  })

  it('treats an inverted range as a collapsed cursor at the start position', () => {
    expect(insertAtCursor('abcdef', '!', 4, 2)).toEqual({ value: 'abcd!ef', cursor: 5 })
  })
})

describe('insertAtElementCursor', () => {
  it('reads the selection from the element', () => {
    expect(insertAtElementCursor({ selectionStart: 2, selectionEnd: 2 }, 'abcd', 'X')).toEqual({
      value: 'abXcd',
      cursor: 3,
    })
  })

  it('appends when the element is missing', () => {
    expect(insertAtElementCursor(null, 'abcd', 'X')).toEqual({ value: 'abcdX', cursor: 5 })
  })

  it('appends when the element throws on selection access (non-text input types)', () => {
    const throwingElement = {
      get selectionStart(): number | null {
        throw new DOMException('selection not supported')
      },
      get selectionEnd(): number | null {
        throw new DOMException('selection not supported')
      },
    }
    expect(insertAtElementCursor(throwingElement, 'abcd', 'X')).toEqual({ value: 'abcdX', cursor: 5 })
  })
})
