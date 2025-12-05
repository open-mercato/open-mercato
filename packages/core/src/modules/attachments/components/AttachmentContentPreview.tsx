import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'

type Props = {
  content?: string | null
  maxLength?: number
  emptyLabel?: string
  showMoreLabel?: string
  showLessLabel?: string
}

export function AttachmentContentPreview({
  content,
  maxLength = 480,
  emptyLabel = 'No text extracted',
  showMoreLabel = 'Show more',
  showLessLabel = 'Show less',
}: Props) {
  const [expanded, setExpanded] = React.useState(false)
  const text = (content ?? '').trim()

  if (!text) {
    return <div className="text-xs text-muted-foreground italic">{emptyLabel}</div>
  }

  const shouldTruncate = !expanded && text.length > maxLength
  const display = shouldTruncate ? `${text.slice(0, maxLength)}…` : text

  return (
    <div className="space-y-2">
      <div
        data-testid="attachment-content-preview"
        className="whitespace-pre-wrap text-sm text-muted-foreground"
      >
        {display}
      </div>
      {text.length > maxLength ? (
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
