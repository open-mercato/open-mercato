"use client"

import * as React from 'react'
import { AtSign, CornerDownRight, Send, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { MentionPicker } from './MentionPicker'
import {
  bodyContainsPendingMention,
  removePendingMentionOccurrences,
  type PendingMention,
} from './commentTypes'

type CommentComposerProps = {
  documentId: string
  body: string
  pendingMentions: PendingMention[]
  replyToName: string | null
  isSubmitting: boolean
  onBodyChange: (body: string) => void
  onMentionsChange: React.Dispatch<React.SetStateAction<PendingMention[]>>
  onSubmit: () => void
  onCancel: () => void
  focusSignal?: number | string
}

export const CommentComposer = React.forwardRef<HTMLFormElement, CommentComposerProps>(function CommentComposer({
  documentId,
  body,
  pendingMentions,
  replyToName,
  isSubmitting,
  onBodyChange,
  onMentionsChange,
  onSubmit,
  onCancel,
  focusSignal,
}, forwardedRef) {
  const t = useT()
  const composerId = React.useId()
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const [mentionPickerOpen, setMentionPickerOpen] = React.useState(false)

  React.useEffect(() => {
    if (focusSignal === undefined) return
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }, [focusSignal])

  const handleMentionPick = React.useCallback((user: { id: string; name: string }) => {
    const userId = user.id.toLowerCase()
    onMentionsChange((current) => current.some((mention) => mention.userId === userId)
      ? current
      : [...current, { userId, name: user.name }])
    onBodyChange(`${body}${body.length > 0 && !/\s$/.test(body) ? ' ' : ''}@${user.name} `)
    setMentionPickerOpen(false)
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }, [body, onBodyChange, onMentionsChange])

  const handleBodyChange = React.useCallback((nextBody: string) => {
    onBodyChange(nextBody)
    onMentionsChange((current) => current.filter((mention) => bodyContainsPendingMention(nextBody, mention)))
  }, [onBodyChange, onMentionsChange])

  const removeMention = React.useCallback((mention: PendingMention) => {
    onBodyChange(removePendingMentionOccurrences(body, mention, pendingMentions))
    onMentionsChange((current) => current.filter((candidate) => candidate.userId !== mention.userId))
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }, [body, onBodyChange, onMentionsChange, pendingMentions])

  return (
    <form
      ref={forwardedRef}
      className="space-y-3 rounded-lg border border-border bg-muted/20 p-3"
      onSubmit={(event) => { event.preventDefault(); onSubmit() }}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault()
          onSubmit()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          setMentionPickerOpen(false)
          onCancel()
        }
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={composerId}>{t('documents.comments.title')}</Label>
        {replyToName ? (
          <p className="inline-flex items-center gap-2 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
            <CornerDownRight className="size-3" aria-hidden="true" />
            {t('documents.comments.replyTo', { name: replyToName })}
          </p>
        ) : null}
        <Textarea
          ref={textareaRef}
          id={composerId}
          value={body}
          onChange={(event) => handleBodyChange(event.target.value)}
          placeholder={t('documents.comments.composer.placeholder')}
          maxLength={8000}
          showCount
          disabled={isSubmitting}
        />
        {pendingMentions.length > 0 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('documents.comments.mentions.selected')}>
            {pendingMentions.map((mention) => (
              <Button
                key={mention.userId}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => removeMention(mention)}
                disabled={isSubmitting}
                aria-label={t('documents.comments.mentions.remove', { name: mention.name })}
              >
                @{mention.name}<X aria-hidden="true" />
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {mentionPickerOpen ? <MentionPicker documentId={documentId} onPick={handleMentionPick} disabled={isSubmitting} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" onClick={() => setMentionPickerOpen((open) => !open)} disabled={isSubmitting}>
          <AtSign />{t('documents.comments.actions.mention')}
        </Button>
        <Button type="submit" disabled={isSubmitting || body.trim().length === 0}>
          <Send />{t('documents.comments.actions.send')}
        </Button>
      </div>
    </form>
  )
})
