"use client"

import * as React from 'react'
import type { Editor } from '@tiptap/core'
import { Sparkles } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FindingSummary } from './findingModel'
import { countSectionHeadings, reviewSummaryLine } from './reviewModeModel'

const SECTION_COUNT_DELAY_MS = 300

function readSectionCount(editor: Editor): number {
  const nodes: Array<{ typeName: string; text: string }> = []
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'heading') return true
    nodes.push({ typeName: node.type.name, text: node.textContent })
    return false
  })
  return countSectionHeadings(nodes)
}

function useSectionCount(editor: Editor | null): number | null {
  const [sections, setSections] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) {
      setSections(null)
      return
    }
    let timer: number | null = null
    const refresh = () => {
      if (!editor.isDestroyed) setSections(readSectionCount(editor))
    }
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        refresh()
      }, SECTION_COUNT_DELAY_MS)
    }
    refresh()
    editor.on('update', schedule)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      editor.off('update', schedule)
    }
  }, [editor])
  return sections
}

export function ReviewSummaryBar({ summary, editor }: { summary: FindingSummary; editor: Editor | null }) {
  const t = useT()
  const sections = useSectionCount(editor)
  const line = reviewSummaryLine(summary, sections)
  const sourceLabel = t(summary.source === 'import' ? 'documents.findings.reviewBar.imported' : 'documents.findings.reviewBar.agent')
  const reviewedAt = summary.reviewedAt ? new Date(summary.reviewedAt).toLocaleString() : null
  const parts: string[] = []
  if (line.kind === 'coverage') {
    parts.push(t('documents.findings.reviewBar.coverage', {
      sections: line.sections,
      rules: line.rules,
      references: line.references,
    }))
  } else {
    if (reviewedAt) parts.push(t('documents.findings.reviewBar.reviewed', { time: reviewedAt }))
    if (line.playbookName) {
      parts.push(line.playbookVersion !== null
        ? t('documents.reviewPlaybooks.header.playbook', { name: line.playbookName, version: line.playbookVersion })
        : t('documents.reviewPlaybooks.header.playbookNoVersion', { name: line.playbookName }))
    }
  }
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-card px-3 py-2 text-xs text-muted-foreground"
      aria-label={t('documents.findings.reviewBar.label')}
      role="group"
      data-testid="documents-review-summary-bar"
      data-coverage={line.kind}
    >
      <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="font-semibold text-foreground">{sourceLabel}</span>
      {parts.map((part) => (
        <React.Fragment key={part}>
          <span aria-hidden>·</span>
          <span>{part}</span>
        </React.Fragment>
      ))}
      {line.kind === 'coverage' && reviewedAt ? (
        <span className="ml-auto" title={reviewedAt}>{t('documents.findings.reviewBar.reviewed', { time: reviewedAt })}</span>
      ) : null}
    </div>
  )
}
