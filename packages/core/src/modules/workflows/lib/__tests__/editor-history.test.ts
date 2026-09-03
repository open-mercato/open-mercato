/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import {
  EDITOR_HISTORY_LIMIT,
  canRedoEditorHistory,
  canUndoEditorHistory,
  commitEditorHistory,
  createEditorHistory,
  redoEditorHistory,
  undoEditorHistory,
} from '../editor-history'

type Doc = { value: string }

const doc = (value: string): Doc => ({ value })

describe('editor history stack (spec section 4.5)', () => {
  test('starts empty and refuses to undo or redo', () => {
    const state = createEditorHistory<Doc>()
    expect(canUndoEditorHistory(state)).toBe(false)
    expect(canRedoEditorHistory(state)).toBe(false)
    expect(undoEditorHistory(state, doc('now'))).toBeNull()
    expect(redoEditorHistory(state, doc('now'))).toBeNull()
  })

  test('undo restores the document captured before the edit and names it', () => {
    const state = commitEditorHistory(createEditorHistory<Doc>(), doc('before'), 'Edit step')
    const step = undoEditorHistory(state, doc('after'))
    expect(step).not.toBeNull()
    expect(step?.document).toEqual(doc('before'))
    expect(step?.label).toBe('Edit step')
    expect(canUndoEditorHistory(step!.state)).toBe(false)
    expect(canRedoEditorHistory(step!.state)).toBe(true)
  })

  test('redo re-applies the undone document and keeps its label', () => {
    const committed = commitEditorHistory(createEditorHistory<Doc>(), doc('before'), 'Delete route')
    const undone = undoEditorHistory(committed, doc('after'))!
    const redone = redoEditorHistory(undone.state, undone.document)!
    expect(redone.document).toEqual(doc('after'))
    expect(redone.label).toBe('Delete route')
    expect(canUndoEditorHistory(redone.state)).toBe(true)
    expect(canRedoEditorHistory(redone.state)).toBe(false)
  })

  test('undo walks back through several edits in order, preserving each label', () => {
    let state = createEditorHistory<Doc>()
    state = commitEditorHistory(state, doc('v0'), 'Add step')
    state = commitEditorHistory(state, doc('v1'), 'Connect steps')
    state = commitEditorHistory(state, doc('v2'), 'Edit route')

    const first = undoEditorHistory(state, doc('v3'))!
    expect([first.document, first.label]).toEqual([doc('v2'), 'Edit route'])
    const second = undoEditorHistory(first.state, first.document)!
    expect([second.document, second.label]).toEqual([doc('v1'), 'Connect steps'])
    const third = undoEditorHistory(second.state, second.document)!
    expect([third.document, third.label]).toEqual([doc('v0'), 'Add step'])
    expect(undoEditorHistory(third.state, third.document)).toBeNull()
  })

  test('a new edit after an undo invalidates the redo branch', () => {
    const committed = commitEditorHistory(createEditorHistory<Doc>(), doc('before'), 'Add step')
    const undone = undoEditorHistory(committed, doc('after'))!
    expect(canRedoEditorHistory(undone.state)).toBe(true)

    const diverged = commitEditorHistory(undone.state, undone.document, 'Delete step')
    expect(canRedoEditorHistory(diverged)).toBe(false)
    expect(redoEditorHistory(diverged, doc('other'))).toBeNull()
  })

  test('caps the stack at 100 entries, dropping the oldest', () => {
    let state = createEditorHistory<Doc>()
    for (let index = 0; index <= EDITOR_HISTORY_LIMIT; index += 1) {
      state = commitEditorHistory(state, doc(`v${index}`), `Edit ${index}`)
    }
    expect(state.past).toHaveLength(EDITOR_HISTORY_LIMIT)
    expect(state.past[0].document).toEqual(doc('v1'))
    expect(state.past[0].label).toBe('Edit 1')
    expect(state.past[EDITOR_HISTORY_LIMIT - 1].document).toEqual(doc(`v${EDITOR_HISTORY_LIMIT}`))
  })

  test('never mutates the state it is given', () => {
    const state = commitEditorHistory(createEditorHistory<Doc>(), doc('before'), 'Add step')
    const snapshot = JSON.stringify(state)
    undoEditorHistory(state, doc('after'))
    commitEditorHistory(state, doc('other'), 'Edit step')
    expect(JSON.stringify(state)).toBe(snapshot)
  })
})
