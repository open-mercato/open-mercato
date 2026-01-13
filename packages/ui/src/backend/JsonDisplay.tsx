"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { Check, Copy, ChevronRight, ChevronDown } from 'lucide-react'

type JsonDisplayProps = {
  data: unknown
  title?: string
  className?: string
  defaultExpanded?: boolean
  maxInitialDepth?: number
  theme?: 'light' | 'dark'
  showCopy?: boolean
  maxHeight?: string
}

type JsonNodeProps = {
  data: unknown
  depth: number
  maxInitialDepth: number
  theme: 'light' | 'dark'
  isLast?: boolean
  parentKey?: string
}

export function JsonDisplay({
  data,
  title,
  className,
  defaultExpanded = false,
  maxInitialDepth = 2,
  theme = 'light',
  showCopy = true,
  maxHeight,
}: JsonDisplayProps) {
  const [copied, setCopied] = React.useState(false)

  const jsonString = React.useMemo(() => {
    try {
      return JSON.stringify(data, null, 2)
    } catch (err) {
      return String(data)
    }
  }, [data])

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(jsonString)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy to clipboard:', err)
    }
  }, [jsonString])

  const containerClasses = cn(
    'rounded-lg border bg-card p-6',
    className
  )

  return (
    <div className={containerClasses}>
      {(title || showCopy) && (
        <div className="flex items-center justify-between mb-4">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {showCopy && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-7 px-2"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  <span className="text-xs">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3 mr-1" />
                  <span className="text-xs">Copy</span>
                </>
              )}
            </Button>
          )}
        </div>
      )}
      <div
        className="bg-muted p-4 rounded overflow-x-auto font-mono text-sm"
        style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}
      >
        <JsonNode
          data={data}
          depth={0}
          maxInitialDepth={defaultExpanded ? Infinity : maxInitialDepth}
          theme={theme}
        />
      </div>
    </div>
  )
}

const JsonNode = React.memo<JsonNodeProps>(({ data, depth, maxInitialDepth, theme, isLast = true, parentKey }) => {
  const [isExpanded, setIsExpanded] = React.useState(depth < maxInitialDepth)

  const indent = depth * 16

  const themeClasses = {
    key: theme === 'light' ? 'text-blue-600' : 'text-blue-400',
    string: theme === 'light' ? 'text-green-600' : 'text-green-400',
    number: theme === 'light' ? 'text-purple-600' : 'text-purple-400',
    boolean: theme === 'light' ? 'text-orange-600' : 'text-orange-400',
    null: theme === 'light' ? 'text-gray-400' : 'text-gray-500',
    punctuation: theme === 'light' ? 'text-gray-600' : 'text-gray-400',
  }

  if (data === null) {
    return (
      <span className={themeClasses.null}>null</span>
    )
  }

  if (data === undefined) {
    return (
      <span className={themeClasses.null}>undefined</span>
    )
  }

  if (typeof data === 'string') {
    return (
      <span className={themeClasses.string}>"{data}"</span>
    )
  }

  if (typeof data === 'number') {
    return (
      <span className={themeClasses.number}>{data}</span>
    )
  }

  if (typeof data === 'boolean') {
    return (
      <span className={themeClasses.boolean}>{String(data)}</span>
    )
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <span className={themeClasses.punctuation}>[]</span>
    }

    return (
      <span>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="inline-flex items-center hover:bg-muted-foreground/10 rounded px-1 -mx-1 transition-colors cursor-pointer"
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 mr-1" />
          ) : (
            <ChevronRight className="h-3 w-3 mr-1" />
          )}
          <span className={themeClasses.punctuation}>
            [{data.length}]
          </span>
        </button>
        {isExpanded && (
          <>
            <br />
            {data.map((item, index) => (
              <div key={index} style={{ paddingLeft: `${indent + 16}px` }}>
                <JsonNode
                  data={item}
                  depth={depth + 1}
                  maxInitialDepth={maxInitialDepth}
                  theme={theme}
                  isLast={index === data.length - 1}
                />
                {index < data.length - 1 && (
                  <span className={themeClasses.punctuation}>,</span>
                )}
                <br />
              </div>
            ))}
            <span style={{ paddingLeft: `${indent}px` }} className={themeClasses.punctuation}>
              ]
            </span>
          </>
        )}
      </span>
    )
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data)

    if (entries.length === 0) {
      return <span className={themeClasses.punctuation}>{'{}'}</span>
    }

    return (
      <span>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="inline-flex items-center hover:bg-muted-foreground/10 rounded px-1 -mx-1 transition-colors cursor-pointer"
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 mr-1" />
          ) : (
            <ChevronRight className="h-3 w-3 mr-1" />
          )}
          <span className={themeClasses.punctuation}>
            {'{'}{entries.length}{'}'}
          </span>
        </button>
        {isExpanded && (
          <>
            <br />
            {entries.map(([key, value], index) => (
              <div key={key} style={{ paddingLeft: `${indent + 16}px` }}>
                <span className={themeClasses.key}>"{key}"</span>
                <span className={themeClasses.punctuation}>: </span>
                <JsonNode
                  data={value}
                  depth={depth + 1}
                  maxInitialDepth={maxInitialDepth}
                  theme={theme}
                  isLast={index === entries.length - 1}
                  parentKey={key}
                />
                {index < entries.length - 1 && (
                  <span className={themeClasses.punctuation}>,</span>
                )}
                <br />
              </div>
            ))}
            <span style={{ paddingLeft: `${indent}px` }} className={themeClasses.punctuation}>
              {'}'}
            </span>
          </>
        )}
      </span>
    )
  }

  return <span className={themeClasses.null}>{String(data)}</span>
})

JsonNode.displayName = 'JsonNode'
