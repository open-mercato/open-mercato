'use client'

import * as React from 'react'
import { Code, X, Trash2 } from 'lucide-react'
import { JsonView } from 'react-json-view-lite'
import { cn } from '@open-mercato/shared/lib/utils'

export interface DebugEvent {
  id: string
  timestamp: Date
  type: 'thinking' | 'tool-call' | 'tool-result' | 'text' | 'error' | 'done' | 'message' | 'connection' | 'metadata' | 'debug' | 'question' | 'session-authorized'
  data: unknown
}

interface DebugPanelProps {
  events: DebugEvent[]
  onClear: () => void
  isOpen: boolean
  onToggle: () => void
}

export function DebugPanel({ events, onClear, isOpen, onToggle }: DebugPanelProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // Filter out text events - only show tool calls, results, errors, etc.
  const filteredEvents = React.useMemo(
    () => events.filter((e) => e.type !== 'text'),
    [events]
  )

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [filteredEvents])

  if (!isOpen) {
    return null
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <span className="text-xs font-medium text-gray-300">Debug Events ({filteredEvents.length})</span>
        <div className="flex gap-2">
          <button
            onClick={onClear}
            className="text-gray-400 hover:text-gray-200"
            title="Clear events"
          >
            <Trash2 className="w-3 h-3" />
          </button>
          <button
            onClick={onToggle}
            className="text-gray-400 hover:text-gray-200"
            title="Close debug panel"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {filteredEvents.map((event) => (
          <DebugEventRow key={event.id} event={event} />
        ))}
        {filteredEvents.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-4">No events yet</p>
        )}
      </div>
    </div>
  )
}

// Recursively parse stringified JSON fields
function parseNestedJson(data: unknown): unknown {
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data)
      return parseNestedJson(parsed)
    } catch {
      return data
    }
  }
  if (Array.isArray(data)) {
    return data.map(parseNestedJson)
  }
  if (data && typeof data === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      result[key] = parseNestedJson(value)
    }
    return result
  }
  return data
}

// Custom dark styles for better readability (no external CSS needed)
const customDarkStyles: Record<string, string> = {
  container: 'bg-transparent text-[11px] leading-relaxed font-mono',
  basicChildStyle: 'pl-4 ml-0',
  label: 'text-purple-400 mr-1',
  nullValue: 'text-gray-500 italic',
  undefinedValue: 'text-gray-500 italic',
  stringValue: 'text-green-400',
  booleanValue: 'text-yellow-400',
  numberValue: 'text-blue-400',
  otherValue: 'text-gray-300',
  punctuation: 'text-gray-500',
  collapseIcon: 'text-gray-400 cursor-pointer select-none mr-1',
  expandIcon: 'text-gray-400 cursor-pointer select-none mr-1',
  collapsedContent: 'text-gray-500',
}

function DebugEventRow({ event }: { event: DebugEvent }) {
  const [expanded, setExpanded] = React.useState(false)
  const typeColors: Record<string, string> = {
    'thinking': 'text-orange-400',
    'tool-call': 'text-blue-400',
    'tool-result': 'text-green-400',
    'text': 'text-gray-300',
    'error': 'text-red-400',
    'done': 'text-purple-400',
    'message': 'text-yellow-400',
    'connection': 'text-cyan-400',
    'metadata': 'text-teal-400',
    'debug': 'text-gray-500',
    'question': 'text-amber-400',
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }) + '.' + String(date.getMilliseconds()).padStart(3, '0')
  }

  // Parse nested JSON strings for better display
  const parsedData = React.useMemo(() => parseNestedJson(event.data), [event.data])

  return (
    <div className="text-xs font-mono">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left flex items-center gap-2 hover:bg-gray-800 rounded px-1 py-0.5"
      >
        <span className="text-gray-500 flex-shrink-0">
          {formatTime(event.timestamp)}
        </span>
        <span className={cn('font-medium flex-shrink-0', typeColors[event.type] || 'text-gray-400')}>
          {event.type}
        </span>
        <span className="text-gray-400 truncate flex-1">
          {getEventPreview(event)}
        </span>
        <span className="text-gray-600 flex-shrink-0">
          {expanded ? '▼' : '▶'}
        </span>
      </button>
      {expanded && (
        <div className="bg-gray-800 rounded p-2 mt-1 overflow-x-auto max-h-[300px] overflow-y-auto">
          <JsonView
            data={parsedData as object}
            style={customDarkStyles}
            shouldExpandNode={(level) => level < 2}
          />
        </div>
      )}
    </div>
  )
}

function getEventPreview(event: DebugEvent): string {
  const data = event.data as Record<string, unknown>

  if (event.type === 'thinking') {
    return 'Agent is processing...'
  }
  if (event.type === 'tool-call') {
    const toolName = data?.toolName as string || 'unknown'
    const args = data?.args
    const argsPreview = args ? JSON.stringify(args).substring(0, 40) : ''
    return `${toolName}(${argsPreview}${argsPreview.length >= 40 ? '...' : ''})`
  }
  if (event.type === 'tool-result') {
    const result = data?.result
    const resultPreview = typeof result === 'string'
      ? result.substring(0, 50)
      : JSON.stringify(result)?.substring(0, 50)
    return `→ ${resultPreview}${resultPreview && resultPreview.length >= 50 ? '...' : ''}`
  }
  if (event.type === 'text') {
    const content = data?.content as string || ''
    return content.substring(0, 50) + (content.length > 50 ? '...' : '')
  }
  if (event.type === 'error') {
    return data?.error as string || 'Unknown error'
  }
  if (event.type === 'message') {
    const role = data?.role as string || ''
    const content = data?.content as string || ''
    return `[${role}] ${content.substring(0, 40)}...`
  }
  if (event.type === 'connection') {
    return data?.status as string || ''
  }
  if (event.type === 'metadata') {
    const model = data?.model as string || ''
    const tokens = data?.tokens as { input?: number; output?: number } | undefined
    const durationMs = data?.durationMs as number | undefined
    const parts: string[] = []
    if (model) parts.push(model)
    if (tokens) parts.push(`${tokens.input || 0}→${tokens.output || 0} tokens`)
    if (durationMs) parts.push(`${(durationMs / 1000).toFixed(1)}s`)
    return parts.join(' | ') || 'No metadata'
  }
  if (event.type === 'debug') {
    const partType = data?.partType as string || 'unknown'
    return `Unknown part: ${partType}`
  }
  if (event.type === 'question') {
    // Use the enriched questionText field if available (added by frontend)
    const questionText = (data?.questionText as string)
      || (data?.question as { questions?: Array<{ question: string }> })?.questions?.[0]?.question
      || (data?.header as string)
      || 'Confirmation required'
    return questionText.substring(0, 50) + (questionText.length > 50 ? '...' : '')
  }
  return ''
}

// Export a toggle button component for use in footer
export function DebugToggleButton({
  isOpen,
  onToggle
}: {
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex items-center gap-1 text-xs transition-colors',
        isOpen
          ? 'text-blue-500 hover:text-blue-400'
          : 'text-muted-foreground hover:text-foreground'
      )}
      title="Toggle debug panel"
    >
      <Code className="w-3 h-3" />
      <span>{isOpen ? 'Hide Debug' : 'Debug'}</span>
    </button>
  )
}
