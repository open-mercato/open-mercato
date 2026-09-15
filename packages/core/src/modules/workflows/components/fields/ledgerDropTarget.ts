'use client'

import type * as React from 'react'
import { LEDGER_PATH_MIME, resolveLedgerDrop, type LedgerInsertMode } from '../../lib/ledger-drag'

type TextControl = HTMLInputElement | HTMLTextAreaElement

export interface LedgerDropTargetOptions {
  value: string
  onValueChange: (nextValue: string) => void
  insertMode?: LedgerInsertMode
  disabled?: boolean
}

export interface LedgerDropTargetProps {
  onDragOver: (event: React.DragEvent<TextControl>) => void
  onDrop: (event: React.DragEvent<TextControl>) => void
}

/**
 * Makes a text control a drop target for Input-data-panel rows: a dragged
 * ledger path is inserted at the caret in the control's own insert mode, while
 * any other payload falls through to the browser's native text drop. A plain
 * factory, not a hook — config fields render a variable number of controls per
 * activity type.
 */
export function ledgerDropTargetProps({
  value,
  onValueChange,
  insertMode = 'template',
  disabled,
}: LedgerDropTargetOptions): LedgerDropTargetProps {
  return {
    onDragOver: (event) => {
      if (disabled) return
      if (!event.dataTransfer?.types?.includes(LEDGER_PATH_MIME)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    },
    onDrop: (event) => {
      if (disabled) return
      const target = event.currentTarget
      const result = resolveLedgerDrop(event.dataTransfer, target, value, insertMode)
      if (!result) return
      event.preventDefault()
      onValueChange(result.value)
      window.requestAnimationFrame(() => {
        target.focus()
        if (typeof target.setSelectionRange === 'function') {
          target.setSelectionRange(result.cursor, result.cursor)
        }
      })
    },
  }
}
