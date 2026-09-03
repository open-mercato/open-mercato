'use client'

import { NodeResizer, type NodeProps } from '@xyflow/react'
import { StickyNote, Trash2 } from 'lucide-react'
import { MarkdownContent } from '@open-mercato/ui/backend/markdown'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { requestWorkflowNodeDeletion } from '../WorkflowNodeCard'
import type { WorkflowNoteNodeData } from '../../lib/editor-annotations'

/**
 * Markdown sticky note (spec section 4.5). It carries no handles and no status:
 * a note is documentation, never a step, and `graphToDefinition` filters it out
 * of the saved definition entirely.
 */
export function StickyNoteNode({ id, data, isConnectable, selected }: NodeProps) {
  const t = useT()
  const noteData = data as unknown as WorkflowNoteNodeData
  const markdown = typeof noteData?.markdown === 'string' ? noteData.markdown : ''
  const editable = isConnectable

  return (
    <div
      className={`group flex h-full w-full flex-col overflow-hidden rounded-lg border border-status-warning-border bg-status-warning-bg shadow-sm transition-all duration-200 ${
        selected ? 'ring-2 ring-primary' : 'hover:shadow-md'
      }`}
    >
      <NodeResizer isVisible={editable && selected} minWidth={160} minHeight={100} lineClassName="!border-primary" handleClassName="!bg-primary !border-background" />
      <div className="flex items-center justify-between gap-2 border-b border-status-warning-border px-2.5 py-1">
        <div className="flex min-w-0 items-center gap-1">
          <StickyNote className="h-3 w-3 shrink-0 text-status-warning-text" aria-hidden="true" />
          <span className="truncate text-overline font-semibold uppercase tracking-wide text-status-warning-text">
            {t('workflows.annotations.note.typeLabel', 'Note')}
          </span>
        </div>
        {editable && (
          <button
            type="button"
            aria-label={t('workflows.annotations.note.delete', 'Delete note')}
            className="nodrag nopan -mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-status-error-icon focus-visible:opacity-100 group-hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation()
              event.preventDefault()
              requestWorkflowNodeDeletion(id)
            }}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2 text-xs text-foreground">
        {markdown ? (
          <MarkdownContent
            body={markdown}
            format="markdown"
            className="prose-workflow-note break-words [&_a]:underline [&_code]:text-overline [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:text-xs [&_h2]:font-semibold [&_li]:list-item [&_ul]:list-inside [&_ul]:list-disc"
          />
        ) : (
          <p className="text-muted-foreground">
            {t('workflows.annotations.note.empty', 'Empty note — click to write something.')}
          </p>
        )}
      </div>
    </div>
  )
}
