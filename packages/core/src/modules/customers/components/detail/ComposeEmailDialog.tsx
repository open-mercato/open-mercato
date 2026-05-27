'use client'

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { RadioGroup } from '@open-mercato/ui/primitives/radio'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export interface ComposeEmailChannel {
  id: string
  displayName: string
  externalIdentifier?: string | null
  providerKey: 'gmail' | 'microsoft' | 'imap' | string
  isPrimary?: boolean
}

export interface ComposeEmailValues {
  userChannelId: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  body: string
  bodyFormat: 'text' | 'html'
  visibility: 'private' | 'shared'
  inReplyTo?: string
  references?: string[]
}

export interface ComposeEmailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  personId: string
  defaultRecipient?: string | null
  channels: ComposeEmailChannel[]
  replyTo?: {
    inReplyTo: string
    references?: string[]
    to: string[]
    cc?: string[]
    subject: string
  } | null
  onSend: (values: ComposeEmailValues) => Promise<{ messageId: string | null }>
}

function parseRecipients(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function defaultChannelId(channels: ComposeEmailChannel[]): string {
  const primary = channels.find((c) => c.isPrimary)
  return primary?.id ?? channels[0]?.id ?? ''
}

export function ComposeEmailDialog({
  open,
  onOpenChange,
  channels,
  defaultRecipient,
  replyTo,
  onSend,
}: ComposeEmailDialogProps) {
  const t = useT()

  const initialTo = React.useMemo(() => {
    if (replyTo) return replyTo.to.join(', ')
    if (defaultRecipient) return defaultRecipient
    return ''
  }, [replyTo, defaultRecipient])

  const initialCc = React.useMemo(() => {
    if (replyTo?.cc && replyTo.cc.length > 0) return replyTo.cc.join(', ')
    return ''
  }, [replyTo])

  const initialSubject = replyTo?.subject ?? ''

  const [to, setTo] = React.useState(initialTo)
  const [showCc, setShowCc] = React.useState(Boolean(initialCc))
  const [cc, setCc] = React.useState(initialCc)
  const [subject, setSubject] = React.useState(initialSubject)
  const [body, setBody] = React.useState('')
  const [visibility, setVisibility] = React.useState<'private' | 'shared'>('private')
  const [channelId, setChannelId] = React.useState(() => defaultChannelId(channels))
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Reset form when dialog opens/closes or replyTo/defaultRecipient changes
  React.useEffect(() => {
    if (open) {
      setTo(replyTo ? replyTo.to.join(', ') : (defaultRecipient ?? ''))
      const ccValue = replyTo?.cc && replyTo.cc.length > 0 ? replyTo.cc.join(', ') : ''
      setCc(ccValue)
      setShowCc(Boolean(ccValue))
      setSubject(replyTo?.subject ?? '')
      setBody('')
      setVisibility('private')
      setChannelId(defaultChannelId(channels))
      setError(null)
      setBusy(false)
    }
  }, [open, replyTo, defaultRecipient, channels])

  const toList = parseRecipients(to)
  const isSendDisabled =
    busy ||
    toList.length === 0 ||
    subject.trim().length === 0 ||
    body.trim().length === 0 ||
    !channelId

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        if (!isSendDisabled) {
          void handleSend()
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSendDisabled, to, cc, subject, body, visibility, channelId, replyTo]
  )

  async function handleSend() {
    setError(null)
    setBusy(true)
    try {
      const ccList = showCc ? parseRecipients(cc) : undefined
      const values: ComposeEmailValues = {
        userChannelId: channelId,
        to: toList,
        cc: ccList && ccList.length > 0 ? ccList : undefined,
        subject: subject.trim(),
        body: body.trim(),
        bodyFormat: 'text',
        visibility,
        inReplyTo: replyTo?.inReplyTo,
        references: replyTo?.references,
      }
      await onSend(values)
      onOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>
            {replyTo
              ? t('customers.email.compose.replyTitle', 'Reply')
              : t('customers.email.compose.title', 'New email')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* To */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="compose-to">
                {t('customers.email.compose.to', 'To')}
              </Label>
              {!showCc && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowCc(true)}
                  aria-label={t('customers.email.compose.addCc.ariaLabel', 'Add Cc recipients')}
                >
                  {t('customers.email.compose.addCc', '+ Cc')}
                </button>
              )}
            </div>
            <Input
              id="compose-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={t('customers.email.compose.toPlaceholder', 'recipient@example.com')}
              autoComplete="off"
            />
          </div>

          {/* Cc (collapsible) */}
          {showCc && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="compose-cc">
                {t('customers.email.compose.cc', 'Cc')}
              </Label>
              <Input
                id="compose-cc"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder={t('customers.email.compose.ccPlaceholder', 'cc@example.com')}
                autoComplete="off"
              />
            </div>
          )}

          {/* Subject */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="compose-subject">
              {t('customers.email.compose.subject', 'Subject')}
            </Label>
            <Input
              id="compose-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t('customers.email.compose.subjectPlaceholder', 'Email subject')}
            />
          </div>

          {/* Body */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="compose-body">
              {t('customers.email.compose.body', 'Body')}
            </Label>
            <Textarea
              id="compose-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('customers.email.compose.bodyPlaceholder', 'Write your message...')}
              className="min-h-[180px]"
            />
          </div>

          {/* Visibility */}
          <div className="flex flex-col gap-2">
            <Label>
              {t('customers.email.compose.visibility', 'Visibility')}
            </Label>
            <RadioGroup
              value={visibility}
              onValueChange={(val) => setVisibility(val as 'private' | 'shared')}
              className="flex flex-row gap-4"
            >
              <RadioField
                value="private"
                label={t('customers.email.compose.visibilityPrivate', 'Private to me')}
              />
              <RadioField
                value="shared"
                label={t('customers.email.compose.visibilityShared', 'Visible to teammates')}
              />
            </RadioGroup>
          </div>

          {/* Send as (channel selector) */}
          {channels.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="compose-channel">
                {t('customers.email.compose.sendAs', 'Send as')}
              </Label>
              <Select value={channelId} onValueChange={setChannelId}>
                <SelectTrigger id="compose-channel">
                  <SelectValue placeholder={t('customers.email.compose.selectChannel', 'Select account')} />
                </SelectTrigger>
                <SelectContent>
                  {channels.map((ch) => (
                    <SelectItem key={ch.id} value={ch.id}>
                      {ch.displayName}
                      {ch.externalIdentifier ? ` (${ch.externalIdentifier})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Inline error */}
          {error && (
            <p className="text-sm text-status-error-text" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t('customers.email.compose.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void handleSend()}
            disabled={isSendDisabled}
          >
            {busy
              ? t('customers.email.compose.sending', 'Sending...')
              : t('customers.email.compose.send', 'Send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
