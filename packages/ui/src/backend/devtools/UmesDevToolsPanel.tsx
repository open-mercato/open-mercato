'use client'

import { useState, useEffect, useCallback } from 'react'
import { useUmesDevTools } from './useUmesDevTools'
import { ExtensionPointList } from './components/ExtensionPointList'
import { ConflictWarnings } from './components/ConflictWarnings'
import { EnricherTiming } from './components/EnricherTiming'
import { InterceptorActivity } from './components/InterceptorActivity'
import { EventFlow } from './components/EventFlow'

const isDev = process.env.NODE_ENV === 'development'

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
  const data = useUmesDevTools()

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.ctrlKey && event.shiftKey && event.key === 'U') {
      event.preventDefault()
      setIsOpen((prev) => !prev)
    }
  }, [])

  useEffect(() => {
    if (!isDev) return
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (!isDev || !isOpen) return null

  const conflictCount = data.conflicts.length
  const hasErrors = data.conflicts.some((c) => c.severity === 'error')

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: '440px',
        zIndex: 9999,
        backgroundColor: '#ffffff',
        borderLeft: '1px solid #e5e7eb',
        boxShadow: '-4px 0 16px rgba(0, 0, 0, 0.08)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '13px',
        color: '#1f2937',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#f9fafb',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <strong style={{ fontSize: '14px' }}>UMES DevTools</strong>
          <span
            style={{
              backgroundColor: '#dbeafe',
              color: '#1d4ed8',
              padding: '1px 6px',
              borderRadius: '3px',
              fontSize: '10px',
              fontWeight: 600,
            }}
          >
            {data.extensions.length} ext
          </span>
          {conflictCount > 0 && (
            <span
              style={{
                backgroundColor: hasErrors ? '#fee2e2' : '#fef3c7',
                color: hasErrors ? '#dc2626' : '#d97706',
                padding: '1px 6px',
                borderRadius: '3px',
                fontSize: '10px',
                fontWeight: 600,
              }}
            >
              {conflictCount} conflict{conflictCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            onClick={() => data.refresh()}
            style={{
              background: 'none',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
              padding: '2px 8px',
              color: '#6b7280',
            }}
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '18px',
              padding: '2px 4px',
              color: '#9ca3af',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid #e5e7eb',
          backgroundColor: '#f9fafb',
          flexShrink: 0,
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1,
              padding: '8px 4px',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #3b82f6' : '2px solid transparent',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? '#1d4ed8' : '#6b7280',
              textAlign: 'center',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
        {activeTab === 'extensions' && <ExtensionPointList extensions={data.extensions} />}
        {activeTab === 'conflicts' && <ConflictWarnings conflicts={data.conflicts} />}
        {activeTab === 'timing' && <EnricherTiming entries={data.enricherTimings} />}
        {activeTab === 'interceptors' && <InterceptorActivity entries={data.interceptorActivity} />}
        {activeTab === 'events' && <EventFlow entries={data.eventFlow} />}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '6px 16px',
          borderTop: '1px solid #e5e7eb',
          backgroundColor: '#f9fafb',
          fontSize: '10px',
          color: '#9ca3af',
          textAlign: 'center',
          flexShrink: 0,
        }}
      >
        Ctrl+Shift+U to toggle | Dev mode only
      </div>
    </div>
  )
}
