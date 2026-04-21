"use client"

import * as React from 'react'

/**
 * Shared keyboard-shortcut hook for the AI surfaces shipped in Phase 2
 * (Step 4.6 / Phase 2 WS-B polish). Centralises the `Cmd/Ctrl+Enter` and
 * `Escape` handling used by `<AiChat>`, the AI playground, and the agent
 * settings page so every surface honours the same shortcuts without each
 * page rolling its own listener.
 *
 * - `onSubmit` fires on `Enter` (without `Shift`) when the shortcut is
 *   triggered while focus is inside the bound element. `Shift+Enter` is
 *   left to the browser for native newline insertion.
 * - `onCancel` fires on `Escape`. Callers decide what cancel means (abort an
 *   in-flight stream, blur the composer, close a drawer, reset a draft).
 * - `enabled` gates the hook for conditional bindings without unmounting.
 *
 * The hook is deliberately minimal. It never stops propagation; callers that
 * embed modal dialogs keep their own Escape handling because React events
 * bubble predictably.
 */
export interface UseAiShortcutsOptions {
  onSubmit?: () => void
  onCancel?: () => void
  enabled?: boolean
}

export interface UseAiShortcutsResult {
  /**
   * Keyboard handler ready to be attached via `onKeyDown`. Returns `true`
   * when the event matched a shortcut so callers can branch on the result.
   */
  handleKeyDown: (event: React.KeyboardEvent) => boolean
}

export function useAiShortcuts(options: UseAiShortcutsOptions): UseAiShortcutsResult {
  const { onSubmit, onCancel, enabled = true } = options

  const onSubmitRef = React.useRef(onSubmit)
  const onCancelRef = React.useRef(onCancel)
  React.useEffect(() => {
    onSubmitRef.current = onSubmit
  }, [onSubmit])
  React.useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  const handleKeyDown = React.useCallback<UseAiShortcutsResult['handleKeyDown']>(
    (event) => {
      if (!enabled) return false
      // Enter — primary submit. Shift+Enter inserts a newline instead.
      if (event.key === 'Enter' && !event.shiftKey) {
        if (onSubmitRef.current) {
          event.preventDefault()
          onSubmitRef.current()
          return true
        }
        return false
      }
      // Escape — secondary cancel. Never swallow unless a handler is bound so
      // parent dialogs can still handle Escape the native way.
      if (event.key === 'Escape') {
        if (onCancelRef.current) {
          event.preventDefault()
          onCancelRef.current()
          return true
        }
        return false
      }
      return false
    },
    [enabled],
  )

  return { handleKeyDown }
}

export default useAiShortcuts
