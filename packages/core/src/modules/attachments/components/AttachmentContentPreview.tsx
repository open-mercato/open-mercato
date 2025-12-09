import * as React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PluggableList } from 'unified'
import { Button } from '@open-mercato/ui/primitives/button'

type Props = {
  content?: string | null
  maxLength?: number
  emptyLabel?: string
  showMoreLabel?: string
  showLessLabel?: string
  sourceLabel?: string
  previewLabel?: string
}

export function AttachmentContentPreview({
  content,
  maxLength = 480,
  emptyLabel = 'No text extracted',
  showMoreLabel = 'Show more',
  showLessLabel = 'Show less',
  sourceLabel = 'Source',
  previewLabel = 'Preview',
}: Props) {
  const [expanded, setExpanded] = React.useState(false)
  const [tab, setTab] = React.useState<'source' | 'preview'>('source')
  const text = (content ?? '').trim()
  const markdownPlugins = React.useMemo<PluggableList>(() => [remarkGfm], [])

  const sourceTabId = 'attachment-content-preview-tab-source'
  const previewTabId = 'attachment-content-preview-tab-preview'
  const sourcePanelId = 'attachment-content-preview-panel-source'
  const previewPanelId = 'attachment-content-preview-panel-preview'

  if (!text) {
    return <div className="text-xs text-muted-foreground italic">{emptyLabel}</div>
  }

  const shouldTruncate = !expanded && text.length > maxLength
  const display = tab === 'source' && shouldTruncate ? `${text.slice(0, maxLength)}…` : text

  return (
    <div className="space-y-2">
      <div className="border-b border-border">
        <nav className="flex items-center gap-4 text-xs" role="tablist" aria-label="Content preview mode">
          <button
            type="button"
            id={sourceTabId}
            role="tab"
            aria-selected={tab === 'source'}
            aria-controls={sourcePanelId}
            className={`-mb-px border-b-2 px-0 pb-2 font-medium transition-colors ${
              tab === 'source'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setTab('source')}
          >
            {sourceLabel}
          </button>
          <button
            type="button"
            id={previewTabId}
            role="tab"
            aria-selected={tab === 'preview'}
            aria-controls={previewPanelId}
            className={`-mb-px border-b-2 px-0 pb-2 font-medium transition-colors ${
              tab === 'preview'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setTab('preview')}
          >
            {previewLabel}
          </button>
        </nav>
      </div>

      {tab === 'source' ? (
        <div
          role="tabpanel"
          id={sourcePanelId}
          aria-labelledby={sourceTabId}
          data-testid="attachment-content-preview"
          className="whitespace-pre-wrap text-sm text-muted-foreground"
        >
          {display}
        </div>
      ) : (
        <div
          role="tabpanel"
          id={previewPanelId}
          aria-labelledby={previewTabId}
          className="text-sm text-muted-foreground [&>*]:mb-2 [&>*:last-child]:mb-0 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs"
        >
          <ReactMarkdown remarkPlugins={markdownPlugins}>{text}</ReactMarkdown>
        </div>
      )}

      {tab === 'source' && text.length > maxLength ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto px-0 py-1 text-xs"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? showLessLabel : showMoreLabel}
        </Button>
      ) : null}
    </div>
  )
}
