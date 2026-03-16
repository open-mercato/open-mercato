'use client'

import * as React from 'react'

interface AiSuggestionDiffProps {
  currentValue: unknown
  proposedValue: unknown
}

type DiffLineType = 'unchanged' | 'added' | 'removed'

interface DiffLine {
  type: DiffLineType
  content: string
  indent: number
}

function jsonToLines(value: unknown, indent: number = 0): string[] {
  const json = JSON.stringify(value, null, 2)
  if (!json) return ['null']
  return json.split('\n')
}

function computeDiff(currentLines: string[], proposedLines: string[]): DiffLine[] {
  const result: DiffLine[] = []
  const maxLen = Math.max(currentLines.length, proposedLines.length)

  // Simple line-by-line diff (sufficient for JSON structures)
  let currentIdx = 0
  let proposedIdx = 0

  while (currentIdx < currentLines.length || proposedIdx < proposedLines.length) {
    const currentLine = currentIdx < currentLines.length ? currentLines[currentIdx] : undefined
    const proposedLine = proposedIdx < proposedLines.length ? proposedLines[proposedIdx] : undefined

    if (currentLine === proposedLine) {
      result.push({ type: 'unchanged', content: currentLine ?? '', indent: 0 })
      currentIdx++
      proposedIdx++
    } else if (proposedLine !== undefined && !currentLines.includes(proposedLine)) {
      result.push({ type: 'added', content: proposedLine, indent: 0 })
      proposedIdx++
    } else if (currentLine !== undefined && !proposedLines.includes(currentLine)) {
      result.push({ type: 'removed', content: currentLine, indent: 0 })
      currentIdx++
    } else {
      // Lines exist in both but at different positions — show as change
      if (currentLine !== undefined) {
        result.push({ type: 'removed', content: currentLine, indent: 0 })
        currentIdx++
      }
      if (proposedLine !== undefined) {
        result.push({ type: 'added', content: proposedLine, indent: 0 })
        proposedIdx++
      }
    }
  }

  return result
}

const lineStyles: Record<DiffLineType, string> = {
  unchanged: 'text-muted-foreground',
  added: 'bg-emerald-500/10 text-emerald-900 dark:text-emerald-300',
  removed: 'bg-destructive/10 text-destructive line-through',
}

const linePrefixes: Record<DiffLineType, string> = {
  unchanged: '  ',
  added: '+ ',
  removed: '- ',
}

export function AiSuggestionDiff({ currentValue, proposedValue }: AiSuggestionDiffProps) {
  const diff = React.useMemo(() => {
    const currentLines = jsonToLines(currentValue)
    const proposedLines = jsonToLines(proposedValue)
    return computeDiff(currentLines, proposedLines)
  }, [currentValue, proposedValue])

  if (diff.length === 0) return null

  return (
    <div className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-2">
      <pre className="text-xs font-mono leading-relaxed">
        {diff.map((line, idx) => (
          <div key={idx} className={`px-1 ${lineStyles[line.type]}`}>
            <span className="select-none opacity-50">{linePrefixes[line.type]}</span>
            {line.content}
          </div>
        ))}
      </pre>
    </div>
  )
}
