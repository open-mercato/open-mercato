"use client"

import * as React from 'react'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useMentionPicker } from './useMentionPicker'

export {
  buildMentionPrincipalUrl,
  nextMentionIndex,
  readMentionUserItems,
} from './useMentionPicker'

type MentionPickerProps = {
  documentId: string
  onPick: (user: { id: string; name: string }) => void
  disabled?: boolean
}

export function MentionPicker({ documentId, onPick, disabled = false }: MentionPickerProps) {
  const t = useT()
  const reactId = React.useId()
  const inputId = `documents-mention-input-${documentId}-${reactId}`
  const listId = `documents-mention-list-${documentId}-${reactId}`
  const model = useMentionPicker({
    documentId,
    onPick,
    disabled,
    fallbackLabel: t('documents.users.unknown'),
  })

  return (
    <div className="relative space-y-2">
      <Label htmlFor={inputId}>{t('documents.mentions.placeholder')}</Label>
      <Input
        id={inputId}
        value={model.query}
        onChange={(event) => model.onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (model.isDisabled) return
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            model.dismiss()
            return
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()
            model.moveActive(event.key === 'ArrowDown' ? 1 : -1)
            return
          }
          if (event.key === 'Enter' && model.open && model.resultsAreCurrent && model.activeIndex >= 0) {
            const user = model.users[model.activeIndex]
            if (!user) return
            event.preventDefault()
            event.stopPropagation()
            model.pick(user, model.resultQuery)
          }
        }}
        placeholder={t('documents.mentions.placeholder')}
        disabled={model.isDisabled}
        role="combobox"
        aria-expanded={model.open && !model.isDisabled}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          model.resultsAreCurrent && model.activeIndex >= 0
            ? `${listId}-option-${model.activeIndex}`
            : undefined
        }
      />
      {model.unavailable ? (
        <p role="alert" className="text-sm text-muted-foreground">
          {t('documents.mentions.unavailable')}
        </p>
      ) : null}
      {model.open && !model.isDisabled ? (
        <div
          id={listId}
          role={
            !model.isLoading
            && !model.hasError
            && model.resultsAreCurrent
            && model.users.length > 0
              ? 'listbox'
              : undefined
          }
          className="absolute z-popover max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg"
        >
          {model.isLoading ? (
            <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
              {t('documents.mentions.loading')}
            </p>
          ) : null}
          {!model.isLoading && model.hasError ? (
            <ErrorMessage
              label={t('documents.mentions.error.search')}
              action={<Button type="button" size="sm" variant="outline" onClick={model.retry}>{t('documents.actions.retry')}</Button>}
            />
          ) : null}
          {!model.isLoading && !model.hasError && model.hasSearched && model.resultsAreCurrent && model.users.length === 0 ? (
            <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
              {t('documents.mentions.noMatches')}
            </p>
          ) : null}
          {!model.isLoading && !model.hasError && model.resultsAreCurrent ? model.users.map((user, index) => (
            <Button
              key={user.id}
              id={`${listId}-option-${index}`}
              role="option"
              aria-selected={index === model.activeIndex}
              type="button"
              disabled={model.isDisabled}
              variant={index === model.activeIndex ? 'secondary' : 'ghost'}
              className="h-auto w-full justify-start px-3 py-2 text-left"
              onMouseEnter={() => model.activate(index, model.resultQuery)}
              onClick={() => model.pick(user, model.resultQuery)}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{user.label}</span>
                {user.secondary ? (
                  <span className="block truncate text-xs text-muted-foreground">{user.secondary}</span>
                ) : null}
              </span>
            </Button>
          )) : null}
        </div>
      ) : null}
    </div>
  )
}

export default MentionPicker
