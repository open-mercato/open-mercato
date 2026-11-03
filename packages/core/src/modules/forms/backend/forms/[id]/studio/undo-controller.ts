import type { StudioSnapshot } from './types'

export type UndoController = {
  push: (snapshot: StudioSnapshot) => void
  undo: (current: StudioSnapshot) => StudioSnapshot | null
  redo: (current: StudioSnapshot) => StudioSnapshot | null
  canUndo: () => boolean
  canRedo: () => boolean
  clear: () => void
}

function cloneSnapshot(snapshot: StudioSnapshot): StudioSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as StudioSnapshot
}

export function createUndoController({ capacity }: { capacity: number }): UndoController {
  const undoStack: StudioSnapshot[] = []
  const redoStack: StudioSnapshot[] = []
  const max = Math.max(1, capacity)

  return {
    push(snapshot) {
      undoStack.push(cloneSnapshot(snapshot))
      if (undoStack.length > max) undoStack.shift()
      redoStack.length = 0
    },
    undo(current) {
      const previous = undoStack.pop()
      if (!previous) return null
      redoStack.push(cloneSnapshot(current))
      if (redoStack.length > max) redoStack.shift()
      return cloneSnapshot(previous)
    },
    redo(current) {
      const next = redoStack.pop()
      if (!next) return null
      undoStack.push(cloneSnapshot(current))
      if (undoStack.length > max) undoStack.shift()
      return cloneSnapshot(next)
    },
    canUndo() {
      return undoStack.length > 0
    },
    canRedo() {
      return redoStack.length > 0
    },
    clear() {
      undoStack.length = 0
      redoStack.length = 0
    },
  }
}
