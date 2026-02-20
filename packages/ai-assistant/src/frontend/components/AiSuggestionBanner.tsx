'use client'

import * as React from 'react'
import { useState, useCallback, useEffect, useRef } from 'react'
import { Sparkles, Check, X, Eye, EyeOff, AlertTriangle, Undo2, Loader2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { AiFormSuggestionSection } from '../types'
import { AiSuggestionDiff } from './AiSuggestionDiff'

interface AiSuggestionBannerProps {
  section: AiFormSuggestionSection | null
  currentValue: unknown
  onAccept: (value: unknown) => void
  onReject: () => void
  isStale?: boolean
  isGenerating?: boolean
}

const UNDO_TIMEOUT_MS = 5000

export function AiSuggestionBanner({
  section,
  currentValue,
  onAccept,
  onReject,
  isStale = false,
  isGenerating = false,
}: AiSuggestionBannerProps) {
  const t = useT()
  const [showDiff, setShowDiff] = useState(false)
  const [undoState, setUndoState] = useState<{ previousValue: unknown; timer: ReturnType<typeof setTimeout> } | null>(null)
  const bannerRef = useRef<HTMLDivElement>(null)

  // Clear undo timer on unmount
  useEffect(() => {
    return () => {
      if (undoState?.timer) clearTimeout(undoState.timer)
    }
  }, [undoState])

  // Reset banner UI state when a new suggestion arrives (concurrent suggestion handling)
  useEffect(() => {
    if (section) {
      setShowDiff(false)
      setUndoState(prev => {
        if (prev?.timer) clearTimeout(prev.timer)
        return null
      })
    }
  }, [section])

  // Keyboard shortcuts: Cmd+Enter to accept, Escape to reject
  useEffect(() => {
    if (!section) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        handleAccept()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        if (undoState) {
          handleUndo()
        } else {
          onReject()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [section, undoState])

  const handleAccept = useCallback(() => {
    if (!section) return

    const previousValue = currentValue
    onAccept(section.value)

    // Start undo timer
    const timer = setTimeout(() => {
      setUndoState(null)
    }, UNDO_TIMEOUT_MS)

    setUndoState({ previousValue, timer })
  }, [section, currentValue, onAccept])

  const handleUndo = useCallback(() => {
    if (!undoState) return
    clearTimeout(undoState.timer)
    onAccept(undoState.previousValue)
    setUndoState(null)
  }, [undoState, onAccept])

  // Show generating indicator
  if (isGenerating && !section && !undoState) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-sky-200/80 bg-sky-50/80 px-4 py-2.5 dark:border-sky-800/50 dark:bg-sky-950/30">
        <Loader2 className="h-4 w-4 animate-spin text-sky-500" />
        <span className="text-sm text-sky-700 dark:text-sky-300">
          {t('ai_assistant.form_bridge.generating')}
        </span>
      </div>
    )
  }

  // Show undo banner
  if (undoState && !section) {
    return (
      <div className="mb-3 flex items-center justify-between rounded-lg border border-amber-200/80 bg-amber-50/80 px-4 py-2.5 text-sm dark:border-amber-800/50 dark:bg-amber-950/30">
        <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
          <Check className="h-4 w-4 text-emerald-600" />
          <span>{t('ai_assistant.form_bridge.suggestion_title')}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleUndo}
          className="h-7 gap-1.5 text-xs"
        >
          <Undo2 className="h-3.5 w-3.5" />
          {t('ai_assistant.form_bridge.undo_accept')}
        </Button>
      </div>
    )
  }

  if (!section) return null

  return (
    <div
      ref={bannerRef}
      className="mb-3 animate-in fade-in slide-in-from-top-2 rounded-lg border border-sky-200/80 bg-sky-50/80 dark:border-sky-800/50 dark:bg-sky-950/30"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-4 py-2.5">
        <div className="flex items-start gap-2 text-sm">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
          <div className="space-y-1">
            <div className="font-medium text-sky-900 dark:text-sky-200">
              {t('ai_assistant.form_bridge.suggestion_title')}
            </div>
            {section.explanation && (
              <div className="text-sky-800/80 dark:text-sky-300/80">
                {section.explanation}
              </div>
            )}
            {isStale && (
              <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t('ai_assistant.form_bridge.stale_warning')}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDiff(!showDiff)}
            className="h-7 gap-1.5 text-xs text-sky-700 hover:text-sky-900 dark:text-sky-300"
          >
            {showDiff ? (
              <>
                <EyeOff className="h-3.5 w-3.5" />
                {t('ai_assistant.form_bridge.hide_diff')}
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5" />
                {t('ai_assistant.form_bridge.preview_diff')}
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onReject}
            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
            {t('ai_assistant.form_bridge.reject')}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleAccept}
            className="h-7 gap-1.5 text-xs"
          >
            <Check className="h-3.5 w-3.5" />
            {t('ai_assistant.form_bridge.accept')}
          </Button>
        </div>
      </div>

      {/* Keyboard shortcut hint */}
      <div className="border-t border-sky-200/50 px-4 py-1.5 text-[11px] text-sky-600/70 dark:border-sky-800/30 dark:text-sky-400/60">
        {t('ai_assistant.form_bridge.accept_shortcut')} &middot; {t('ai_assistant.form_bridge.reject_shortcut')}
      </div>

      {/* Diff preview */}
      {showDiff && (
        <div className="border-t border-sky-200/50 px-4 py-2.5 dark:border-sky-800/30">
          <AiSuggestionDiff currentValue={currentValue} proposedValue={section.value} />
        </div>
      )}
    </div>
  )
}
