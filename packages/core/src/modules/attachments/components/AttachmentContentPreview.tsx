import * as React from 'react'
import { MarkdownContent } from '@open-mercato/ui/backend/markdown'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tabs, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'

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

  if (!text) {
    return <div className="text-xs text-muted-foreground italic">{emptyLabel}</div>
  }

  const shouldTruncate = !expanded && text.length > maxLength
  const display = tab === 'source' && shouldTruncate ? `${text.slice(0, maxLength)}…` : text

  return (
    <div className="space-y-2">
      {/* Tab Navigation */}
      <Tabs value={tab} onValueChange={(value) => setTab(value as 'source' | 'preview')} variant="underline">
        <TabsList className="w-full">
          <TabsTrigger value="source">{sourceLabel}</TabsTrigger>
          <TabsTrigger value="preview">{previewLabel}</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Tab Panels */}
      {tab === 'source' ? (
        <div
          role="tabpanel"
          aria-label={sourceLabel}
          data-testid="attachment-content-preview"
          className="whitespace-pre-wrap text-sm text-muted-foreground"
        >
          {display}
        </div>
      ) : (
        <div
          role="tabpanel"
          aria-label={previewLabel}
          data-testid="markdown-preview"
        >
          <MarkdownContent
            body={text}
            format="markdown"
            className="text-sm text-muted-foreground [&>*]:mb-2 [&>*:last-child]:mb-0 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs"
          />
        </div>
      )}

      {/* Show More/Less Button (only on source tab) */}
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
