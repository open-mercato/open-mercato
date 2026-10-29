/**
 * Caseload keyboard-first flow (UX remediation spec 4, Phase 2) — pure-logic
 * tests for the hotkey resolver's guard rules (editable focus, open modal,
 * modifiers, key repeat) and key→action dispatch, plus relative cursor
 * movement for j/k.
 */
import {
  EMPTY_CURSOR,
  moveCursorBy,
  resolveCaseloadHotkey,
  type CaseloadHotkeyEvent,
  type CursorRowLike,
} from '../backend/caseload/hooks'

function keyEvent(key: string, overrides: Partial<CaseloadHotkeyEvent> = {}): CaseloadHotkeyEvent {
  return {
    key,
    repeat: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    editableTarget: false,
    interactiveTarget: false,
    modalOpen: false,
    ...overrides,
  }
}

function pending(id: string): CursorRowLike {
  return { id, isPending: true }
}

describe('resolveCaseloadHotkey — dispatch', () => {
  it.each([
    ['j', 'next'],
    ['ArrowDown', 'next'],
    ['k', 'prev'],
    ['ArrowUp', 'prev'],
    ['o', 'open'],
    ['Enter', 'open'],
    ['a', 'approve'],
    ['r', 'reject'],
    ['e', 'edit'],
    ['x', 'toggleSelect'],
    ['?', 'legend'],
    ['Escape', 'escape'],
  ] as const)('maps %s to %s', (key, action) => {
    expect(resolveCaseloadHotkey(keyEvent(key))).toBe(action)
  })

  it('ignores unbound keys', () => {
    expect(resolveCaseloadHotkey(keyEvent('z'))).toBeNull()
    expect(resolveCaseloadHotkey(keyEvent('A'))).toBeNull()
    expect(resolveCaseloadHotkey(keyEvent(' '))).toBeNull()
  })

  it('defers Enter to a natively activatable target', () => {
    expect(resolveCaseloadHotkey(keyEvent('Enter', { interactiveTarget: true }))).toBeNull()
  })

  it('still acts on letter keys when the target is a plain button (row focus)', () => {
    expect(resolveCaseloadHotkey(keyEvent('a', { interactiveTarget: true }))).toBe('approve')
    expect(resolveCaseloadHotkey(keyEvent('j', { interactiveTarget: true }))).toBe('next')
  })
})

describe('resolveCaseloadHotkey — guards', () => {
  it('is inert while focus sits in an editable control', () => {
    for (const key of ['j', 'a', 'r', 'e', 'x', '?', 'Enter', 'Escape']) {
      expect(resolveCaseloadHotkey(keyEvent(key, { editableTarget: true }))).toBeNull()
    }
  })

  it('is inert while a dialog or the legend popover is open', () => {
    for (const key of ['j', 'a', 'r', 'e', 'x', '?', 'Enter', 'Escape']) {
      expect(resolveCaseloadHotkey(keyEvent(key, { modalOpen: true }))).toBeNull()
    }
  })

  it('ignores chords with meta/ctrl/alt (Cmd+K palette coexists)', () => {
    expect(resolveCaseloadHotkey(keyEvent('k', { metaKey: true }))).toBeNull()
    expect(resolveCaseloadHotkey(keyEvent('a', { ctrlKey: true }))).toBeNull()
    expect(resolveCaseloadHotkey(keyEvent('j', { altKey: true }))).toBeNull()
  })

  it('is one-shot: key repeat produces no action', () => {
    expect(resolveCaseloadHotkey(keyEvent('j', { repeat: true }))).toBeNull()
    expect(resolveCaseloadHotkey(keyEvent('a', { repeat: true }))).toBeNull()
  })
})

describe('moveCursorBy', () => {
  const rows = [pending('a'), pending('b'), pending('c')]

  it('returns the empty cursor for an empty row set', () => {
    expect(moveCursorBy({ cursorId: 'a', cursorIndex: 0 }, [], 1)).toEqual(EMPTY_CURSOR)
  })

  it('anchors a null cursor to the first row moving forward and the last moving back', () => {
    expect(moveCursorBy(EMPTY_CURSOR, rows, 1)).toEqual({ cursorId: 'a', cursorIndex: 0 })
    expect(moveCursorBy(EMPTY_CURSOR, rows, -1)).toEqual({ cursorId: 'c', cursorIndex: 2 })
  })

  it('moves relative to the current row and clamps at both ends', () => {
    expect(moveCursorBy({ cursorId: 'a', cursorIndex: 0 }, rows, 1)).toEqual({ cursorId: 'b', cursorIndex: 1 })
    expect(moveCursorBy({ cursorId: 'c', cursorIndex: 2 }, rows, 1)).toEqual({ cursorId: 'c', cursorIndex: 2 })
    expect(moveCursorBy({ cursorId: 'a', cursorIndex: 0 }, rows, -1)).toEqual({ cursorId: 'a', cursorIndex: 0 })
  })

  it('re-anchors from the remembered index when the cursor id vanished', () => {
    expect(moveCursorBy({ cursorId: 'gone', cursorIndex: 1 }, rows, 1)).toEqual({ cursorId: 'c', cursorIndex: 2 })
  })

  it('returns the same reference when nothing moves', () => {
    const prev = { cursorId: 'c', cursorIndex: 2 }
    expect(moveCursorBy(prev, rows, 1)).toBe(prev)
  })
})
