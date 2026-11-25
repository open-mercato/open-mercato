import * as React from 'react'
import { FileCode, Globe, Lock } from 'lucide-react'
import { type CrudField } from '../CrudForm'
import { IconButton } from '../../primitives/icon-button'
import { Input } from '../../primitives/input'
import { Label } from '../../primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../primitives/select'
import { Switch } from '../../primitives/switch'
import { SwitchField } from '../../primitives/switch-field'
import { AttachmentsSection } from '../detail/AttachmentsSection'
import { SwitchableMarkdownInput } from '../inputs/SwitchableMarkdownInput'
import { TagsInput } from '../inputs/TagsInput'
import { MessagePrioritySelector } from './MessagePrioritySelector'
import type { UseMessageComposeResult } from './useMessageCompose'
import { isValidEmailAddress } from './useMessageComposeOperations'

const MAX_EXTERNAL_EMAILS = 50

type ComposeProps = {
  compose: UseMessageComposeResult
}

function RecipientTagsInput({ compose }: ComposeProps) {
  return (
    <TagsInput
      value={compose.recipientIds}
      onChange={compose.setRecipientIds}
      selectedOptions={compose.selectedRecipientOptions}
      resolveLabel={compose.resolveRecipientLabel}
      loadSuggestions={compose.loadRecipientSuggestions}
      placeholder={compose.t('messages.placeholders.recipients', 'Search recipients...')}
      allowCustomValues={false}
      showSuggestionsOnFocus={false}
    />
  )
}

function ExternalEmailsInput({ compose }: ComposeProps) {
  const handleChange = React.useCallback((next: string[]) => {
    const seen = new Set<string>()
    const accepted = next
      .map((value) => value.trim())
      .filter((value) => {
        const key = value.toLowerCase()
        if (!isValidEmailAddress(value) || seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, MAX_EXTERNAL_EMAILS)
    compose.setExternalEmails(accepted)
  }, [compose])

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="messages-compose-external-emails">{compose.t('messages.compose.to', 'To')}</Label>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {compose.t('messages.compose.toLimit', '{count} / {max}', {
            count: compose.externalEmails.length,
            max: MAX_EXTERNAL_EMAILS,
          })}
        </span>
      </div>
      <div id="messages-compose-external-emails">
        <TagsInput
          value={compose.externalEmails}
          onChange={handleChange}
          placeholder={compose.t('messages.compose.toPlaceholder', 'Type an email address and press Enter')}
        />
      </div>
    </>
  )
}

function SendSeparatelyField({ compose }: ComposeProps) {
  const id = 'messages-compose-send-separately'
  return (
    <div className="shrink-0 space-y-2">
      <Label htmlFor={id}>{compose.t('messages.compose.sendSeparately', 'Send separately')}</Label>
      <div className="flex h-9 items-center">
        <Switch
          id={id}
          checked={compose.sendSeparately}
          onCheckedChange={compose.setSendSeparately}
          aria-describedby={`${id}-hint`}
        />
      </div>
      <p id={`${id}-hint`} className="whitespace-nowrap text-xs text-muted-foreground">
        {compose.t('messages.compose.sendSeparatelyHint', 'Each recipient gets a private copy.')}
      </p>
    </div>
  )
}

function VisibilitySelector({ compose }: ComposeProps) {
  return (
    <>
      <Label>{compose.t('messages.visibility', 'Visibility')}</Label>
      <div
        className="inline-flex items-center gap-1 rounded-md border bg-background p-1"
        role="radiogroup"
        aria-label={compose.t('messages.visibility', 'Visibility')}
      >
        <IconButton
          type="button"
          size="xs"
          variant={compose.visibility === 'internal' ? 'outline' : 'ghost'}
          role="radio"
          aria-checked={compose.visibility === 'internal'}
          aria-label={compose.t('messages.visibilityInternal', 'Internal')}
          title={compose.t('messages.visibilityInternal', 'Internal')}
          className="h-7 w-7"
          onClick={() => compose.setVisibility('internal')}
        >
          <Lock className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          type="button"
          size="xs"
          variant={compose.visibility === 'public' ? 'outline' : 'ghost'}
          role="radio"
          aria-checked={compose.visibility === 'public'}
          aria-label={compose.t('messages.visibilityPublic', 'Public')}
          title={compose.t('messages.visibilityPublic', 'Public')}
          className="h-7 w-7"
          onClick={() => compose.setVisibility('public')}
        >
          <Globe className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <p className="text-xs text-muted-foreground">
        {compose.visibility === 'public'
          ? compose.t('messages.visibilityPublicHint', 'Public messages are sent to external email only.')
          : compose.t('messages.visibilityInternalHint', 'Internal messages are sent to selected system users.')}
      </p>
    </>
  )
}

function ContextActionsSection({ compose }: ComposeProps) {
  if (!compose.shouldShowContextActions) return null

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {compose.normalizedRequiredActionMode === 'optional' ? (
        <div className="flex items-center justify-between rounded border px-3 py-2 sm:col-span-2">
          <div>
            <p className="text-sm font-medium">
              {compose.t('messages.composer.objectPicker.actionRequiredLabel', 'Action required')}
            </p>
            <p className="text-xs text-muted-foreground">
              {compose.t('messages.composer.objectPicker.actionRequiredHint', 'Mark this object as requiring recipient action.')}
            </p>
          </div>
          <Switch checked={compose.contextActionRequired} onCheckedChange={compose.setContextActionRequired} />
        </div>
      ) : null}
      {compose.normalizedRequiredActionMode === 'required' || compose.contextActionRequired ? (
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="messages-compose-context-action-type">
            {compose.t('messages.composer.objectPicker.actionTypeLabel', 'Action type')}
          </Label>
          <Select
            value={compose.contextActionType || undefined}
            onValueChange={(value) => compose.setContextActionType(value || '')}
          >
            <SelectTrigger id="messages-compose-context-action-type">
              <SelectValue placeholder={compose.t('messages.composer.objectPicker.actionTypePlaceholder', 'Select action')} />
            </SelectTrigger>
            <SelectContent>
              {compose.contextActionOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  )
}

function PrioritySelector({ compose }: ComposeProps) {
  return (
    <>
      <Label>{compose.t('messages.priority', 'Priority')}</Label>
      <MessagePrioritySelector
        value={compose.priority}
        onChange={compose.setPriority}
        t={compose.t}
      />
    </>
  )
}

function MarkdownBodySection({
  compose,
  label,
  placeholder,
  inputId,
  rows,
  textareaClassName,
}: ComposeProps & {
  label: string
  placeholder: string
  inputId: string
  rows: number
  textareaClassName: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={inputId}>{label}</Label>
        <IconButton
          type="button"
          size="sm"
          variant={compose.bodyFormat === 'markdown' ? 'outline' : 'ghost'}
          aria-pressed={compose.bodyFormat === 'markdown'}
          onClick={() => compose.setBodyFormat((previousValue) => (previousValue === 'markdown' ? 'text' : 'markdown'))}
          title={compose.t('messages.bodyFormat.toggle', 'Toggle markdown')}
        >
          <FileCode className="h-4 w-4" />
        </IconButton>
      </div>
      <div id={inputId}>
        <SwitchableMarkdownInput
          value={compose.body}
          onChange={compose.setBody}
          isMarkdownEnabled={compose.bodyFormat === 'markdown'}
          rows={rows}
          placeholder={placeholder}
          textareaClassName={textareaClassName}
        />
      </div>
    </div>
  )
}

const PLATFORM_SENDER_VALUE = '__platform__'

function SenderSelector({ compose }: ComposeProps) {
  if (compose.senderOptions.length === 0) return null

  const fieldError = compose.submitFieldErrors?.senderChannelId ?? null

  return (
    <div className="space-y-2">
      <Label htmlFor="messages-compose-sender">{compose.t('messages.sendFrom', 'Send from')}</Label>
      <Select
        value={compose.senderChannelId || PLATFORM_SENDER_VALUE}
        onValueChange={(value) => compose.setSenderChannelId(value === PLATFORM_SENDER_VALUE ? '' : value)}
      >
        <SelectTrigger id="messages-compose-sender" aria-invalid={fieldError ? true : undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PLATFORM_SENDER_VALUE}>
            {compose.t('messages.sendFromPlatform', 'Platform sender (default)')}
          </SelectItem>
          {compose.senderOptions.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.description ? `${option.label} (${option.description})` : option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {fieldError ? (
        <p className="text-sm text-destructive" role="alert">{fieldError}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {compose.t('messages.sendFromHint', 'Replies to a message sent from your own mailbox come back into this thread.')}
        </p>
      )}
    </div>
  )
}

function ComposeModeFields({ compose }: ComposeProps) {
  return (
    <>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            {compose.visibility === 'public' ? (
              <ExternalEmailsInput compose={compose} />
            ) : (
              <>
                <Label htmlFor="messages-compose-recipients">{compose.t('messages.to', 'To')}</Label>
                <RecipientTagsInput compose={compose} />
              </>
            )}
          </div>

          <div className="space-y-2">
            <VisibilitySelector compose={compose} />
          </div>
        </div>

        {compose.senderOptions.length > 0 || compose.visibility === 'public' ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
            {compose.senderOptions.length > 0 ? (
              <div className="min-w-0 flex-1">
                <SenderSelector compose={compose} />
              </div>
            ) : null}
            {compose.visibility === 'public' ? <SendSeparatelyField compose={compose} /> : null}
          </div>
        ) : null}

        <ContextActionsSection compose={compose} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="messages-compose-subject">{compose.t('messages.subject', 'Subject')}</Label>
          <Input
            id="messages-compose-subject"
            value={compose.subject}
            onChange={(event) => compose.setSubject(event.target.value)}
            placeholder={compose.t('messages.placeholders.subject', 'Enter subject...')}
          />
        </div>

        <div className="space-y-2">
          <PrioritySelector compose={compose} />
        </div>
      </div>

      <MarkdownBodySection
        compose={compose}
        label={compose.t('messages.body', 'Message')}
        placeholder={compose.t('messages.placeholders.body', 'Write your message...')}
        inputId="messages-compose-body"
        rows={8}
        textareaClassName="min-h-[180px] w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <ComposeAttachmentsField compose={compose} />
    </>
  )
}

function ComposeAttachmentsField({ compose }: ComposeProps) {
  const sender = compose.senderOptions.find((option) => option.id === compose.senderChannelId)
  if (sender?.supportsAttachments === false) {
    return (
      <div className="space-y-2">
        <Label>{compose.t('messages.attachedFiles', 'Attachments')}</Label>
        <p className="text-sm text-muted-foreground">
          {compose.t(
            'messages.composer.senderAttachmentsUnsupported',
            'The selected mailbox cannot send attachments. Choose another sender to add or remove files.',
          )}
        </p>
      </div>
    )
  }
  return <MessageAttachments compose={compose} />
}

function ReplyModeFields({ compose }: ComposeProps) {
  return (
    <>
      {compose.replyAll && compose.externalEmails.length > 0 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1 space-y-2">
            <ExternalEmailsInput compose={compose} />
          </div>
          <SendSeparatelyField compose={compose} />
        </div>
      ) : null}
      <MarkdownBodySection
        compose={compose}
        label={compose.t('messages.replyBody', 'Reply')}
        placeholder={compose.t('messages.placeholders.replyBody', 'Write your reply...')}
        inputId="messages-compose-body"
        rows={8}
        textareaClassName="min-h-[180px] w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <ComposeAttachmentsField compose={compose} />
    </>
  )
}

function MessageAttachments({ compose }: ComposeProps) {
  return (
    <AttachmentsSection
      entityId={compose.attachmentEntityId}
      recordId={compose.attachmentRecordId}
      title={compose.t('messages.attachedFiles', 'Attachments')}
      className="space-y-2"
      compact
      hideWhenUnavailable
      onChanged={() => { void compose.loadAttachmentIds().catch(() => null) }}
    />
  )
}

function ForwardModeFields({ compose }: ComposeProps) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="messages-compose-recipients">{compose.t('messages.to', 'To')}</Label>
        <RecipientTagsInput compose={compose} />
      </div>

      <MarkdownBodySection
        compose={compose}
        label={compose.t('messages.forwardContent', 'Forwarded content')}
        placeholder={compose.t('messages.placeholders.forwardContent', 'Review and edit forwarded content...')}
        inputId="messages-forward-note"
        rows={6}
        textareaClassName="min-h-[140px] w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </>
  )
}

function EmailDeliverySection({ compose }: ComposeProps) {
  if (compose.variant === 'reply' || compose.variant === 'forward') {
    return null
  }

  if (compose.isComposePublicVisibility) {
    return (
      <div className="rounded border px-3 py-2">
        <p className="text-sm font-medium">{compose.t('messages.sendViaEmail', 'Also send via email')}</p>
        <p className="text-xs text-muted-foreground">{compose.t('messages.sendViaEmailForcedPublic', 'For public visibility, email delivery is always enabled.')}</p>
      </div>
    )
  }

  return (
    <SwitchField
      containerClassName="rounded border px-3 py-2"
      label={compose.t('messages.sendViaEmail', 'Also send via email')}
      description={compose.t('messages.sendViaEmailHint', 'Recipients will receive an email copy with a secure link.')}
      checked={compose.sendViaEmail}
      onCheckedChange={compose.setSendViaEmail}
    />
  )
}

function ReplyForwardOptionsRow({ compose }: ComposeProps) {
  if (compose.variant !== 'reply' && compose.variant !== 'forward') {
    return null
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {compose.variant === 'forward' ? (
        <SwitchField
          containerClassName="rounded border px-3 py-2"
          label={compose.t('messages.includeAttachments', 'Include attachments')}
          description={compose.t('messages.includeAttachmentsHint', 'Carry over attachments from the original message.')}
          checked={compose.includeAttachments}
          onCheckedChange={compose.setIncludeAttachments}
        />
      ) : (
        <SwitchField
          containerClassName="rounded border px-3 py-2"
          label={compose.t('messages.replyAll', 'Reply all')}
          description={compose.t('messages.replyAllHint', 'Include all original recipients.')}
          checked={compose.replyAll}
          onCheckedChange={compose.setReplyAll}
        />
      )}
      <SwitchField
        containerClassName="rounded border px-3 py-2"
        label={compose.t('messages.sendViaEmail', 'Also send via email')}
        description={compose.t('messages.sendViaEmailHint', 'Recipients will receive an email copy with a secure link.')}
        checked={compose.sendViaEmail}
        onCheckedChange={compose.setSendViaEmail}
      />
    </div>
  )
}

function MessageComposeFormBody({ compose }: ComposeProps) {
  return (
    <div className="space-y-4" onKeyDown={compose.handleKeyDown}>
      {compose.contextPreview ? (
        <div className="rounded border bg-muted/30 p-3 text-sm">
          {compose.contextPreview}
        </div>
      ) : null}
      {compose.variant === 'compose' ? <ComposeModeFields compose={compose} /> : null}
      {compose.variant === 'reply' ? <ReplyModeFields compose={compose} /> : null}
      {compose.variant === 'forward' ? <ForwardModeFields compose={compose} /> : null}
      <ReplyForwardOptionsRow compose={compose} />
      <EmailDeliverySection compose={compose} />
      {compose.submitError ? <p className="text-sm text-destructive">{compose.submitError}</p> : null}
    </div>
  )
}

export function createMessageComposeFormGroups(compose: UseMessageComposeResult): CrudField[] {
  return [{
    id: 'composer',
    label: '',
    type: 'custom',
    component: () => <MessageComposeFormBody compose={compose} />,
  }]
}
