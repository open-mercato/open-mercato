"use client"

import * as React from 'react'
import type { Editor } from '@tiptap/core'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

type OutlineHeading = {
  level: number
  text: string
  pos: number
}

type OutlinePaneProps = {
  editor: Editor | null
}

const OUTLINE_REFRESH_DELAY_MS = 300

function collectHeadings(editor: Editor): OutlineHeading[] {
  const headings: OutlineHeading[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return
    const text = node.textContent.trim()
    if (!text) return
    const rawLevel = node.attrs.level
    const level = typeof rawLevel === 'number' && Number.isFinite(rawLevel)
      ? Math.min(Math.max(rawLevel, 1), 6)
      : 1
    headings.push({ level, text, pos })
  })
  return headings
}

function getIndentClass(level: number): string {
  if (level <= 1) return 'pl-2'
  if (level === 2) return 'pl-5'
  return 'pl-8'
}

export function OutlinePane({ editor }: OutlinePaneProps) {
  const t = useT()
  const [headings, setHeadings] = React.useState<OutlineHeading[]>([])

  React.useEffect(() => {
    if (!editor) {
      setHeadings([])
      return
    }

    let timer: number | null = null
    const refresh = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        setHeadings(collectHeadings(editor))
      }, OUTLINE_REFRESH_DELAY_MS)
    }

    setHeadings(collectHeadings(editor))
    editor.on('update', refresh)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      editor.off('update', refresh)
    }
  }, [editor])

  const jumpToHeading = React.useCallback((heading: OutlineHeading) => {
    editor?.chain().focus().setTextSelection(heading.pos + 1).scrollIntoView().run()
  }, [editor])

  return (
    <aside className="rounded-lg border border-border bg-card p-3 shadow-sm lg:sticky lg:top-20 lg:w-64 lg:shrink-0">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{t('documents.editor.outline.title')}</h2>
      {headings.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('documents.editor.outline.empty')}</p>
      ) : (
        <nav aria-label={t('documents.editor.outline.title')}>
          <div className="space-y-1">
            {headings.map((heading) => (
              <Button
                key={`${heading.pos}:${heading.text}`}
                type="button"
                size="sm"
                variant="ghost"
                className={cn('h-auto w-full justify-start py-1 pr-2 text-left text-sm', getIndentClass(heading.level))}
                onClick={() => jumpToHeading(heading)}
              >
                <span className="truncate">{heading.text}</span>
              </Button>
            ))}
          </div>
        </nav>
      )}
    </aside>
  )
}
