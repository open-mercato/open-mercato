'use client'

import * as React from 'react'

type Options = {
  onConfirm?: () => void
  onCancel?: () => void
  disabled?: boolean
}

export function useDialogKeyHandler({ onConfirm, onCancel, disabled }: Options): (event: React.KeyboardEvent) => void {
  return React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel?.()
        return
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        if (!disabled) onConfirm?.()
      }
    },
    [disabled, onConfirm, onCancel],
  )
}
