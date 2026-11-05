'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useUmesDevTools } from './useUmesDevTools'
import { ExtensionPointList } from './components/ExtensionPointList'
import { ConflictWarnings } from './components/ConflictWarnings'
import { EnricherTiming } from './components/EnricherTiming'
import { InterceptorActivity } from './components/InterceptorActivity'
import { EventFlow } from './components/EventFlow'

const isDevToolsEnabled = process.env.NEXT_PUBLIC_UMES_DEVTOOLS === 'true'

type TabId = 'extensions' | 'conflicts' | 'timing' | 'interceptors' | 'events'

const TABS: { id: TabId; label: string }[] = [
  { id: 'extensions', label: 'Extensions' },
  { id: 'conflicts', label: 'Conflicts' },
  { id: 'timing', label: 'Timing' },
  { id: 'interceptors', label: 'Interceptors' },
  { id: 'events', label: 'Events' },
]

export function UmesDevToolsPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('extensions')
  const data = useUmesDevTools(isOpen)

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.ctrlKey && event.shiftKey && event.key === 'U') {
      event.preventDefault()
      setIsOpen((prev) => !prev)
    }
  }, [])

  useEffect(() => {
    if (!isDevToolsEnabled) return
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (!isDevToolsEnabled || !isOpen) return null

  const conflictCount = data.conflicts.length
  const hasErrors = data.conflicts.some((c) => c.severity === 'error')

  return (
    <div className="fixed inset-y-0 right-0 z-top flex w-[440px] flex-col border-l bg-background text-foreground shadow-lg"
      style={{ fontSize: '13px' }}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b bg-muted/50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <strong className="text-sm">UMES DevTools</strong>
          <span className="rounded bg-status-info-bg px-1.5 py-px text-overline font-semibold text-status-info-text">
            {data.extensions.length} ext
          </span>
          {conflictCount > 0 && (
            <span className={`rounded px-1.5 py-px text-overline font-semibold ${hasErrors ? 'bg-status-error-bg text-status-error-text' : 'bg-status-warning-bg text-status-warning-text'}`}>
              {conflictCount} conflict{conflictCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto px-2 py-0.5 text-overline"
            onClick={() => data.refresh()}
          >
            Refresh
          </Button>
          <IconButton
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setIsOpen(false)}
            aria-label="Close DevTools"
          >
            <span className="text-lg leading-none">&times;</span>
          </IconButton>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 border-b bg-muted/50">
        {TABS.map((tab) => (
          <Button
            key={tab.id}
            type="button"
            variant="ghost"
            size="sm"
            className={`h-auto flex-1 rounded-none border-b-2 px-1 py-2 text-overline hover:bg-transparent ${
              activeTab === tab.id
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent text-muted-foreground'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3 px-4">
        {activeTab === 'extensions' && <ExtensionPointList extensions={data.extensions} />}
        {activeTab === 'conflicts' && <ConflictWarnings conflicts={data.conflicts} />}
        {activeTab === 'timing' && <EnricherTiming entries={data.enricherTimings} />}
        {activeTab === 'interceptors' && <InterceptorActivity entries={data.interceptorActivity} />}
        {activeTab === 'events' && <EventFlow entries={data.eventFlow} />}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t bg-muted/50 px-4 py-1.5 text-center text-overline text-muted-foreground">
        Ctrl+Shift+U to toggle | Dev mode only
      </div>
    </div>
  )
}
