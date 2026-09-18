"use client"

import * as React from 'react'
import { Search, X } from 'lucide-react'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { PrincipalType } from './principalPickerModel'
import { usePrincipalPicker } from './usePrincipalPicker'

type PrincipalPickerProps = {
  documentId: string
  principalType: PrincipalType
  value: string | null
  onChange: (id: string | null, label: string | null) => void
  disabled?: boolean
  id?: string
}

export function PrincipalPicker({ documentId, principalType, value, onChange, disabled = false, id }: PrincipalPickerProps) {
  const t = useT()
  const generatedId = React.useId()
  const inputId = id ?? `documents-principal-picker-${generatedId}`
  const listId = `${inputId}-list`
  const containerRef = React.useRef<HTMLDivElement>(null)
  const fallbackLabel = t(principalType === 'user' ? 'documents.users.unknown' : 'documents.roles.unknown')
  const picker = usePrincipalPicker({ documentId, principalType, value, onChange, disabled, fallbackLabel })
  const placeholder = t(principalType === 'user' ? 'documents.share.picker.searchUser' : 'documents.share.picker.searchRole')

  return (
    <div ref={containerRef} className="relative space-y-1" onKeyDown={picker.handleKeyDown} onBlur={(event) => {
      if (event.relatedTarget instanceof Node && containerRef.current?.contains(event.relatedTarget)) return
      picker.setOpen(false)
    }}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            id={inputId}
            className="w-full"
            value={picker.displayValue}
            onChange={(event) => picker.changeSearch(event.target.value)}
            onFocus={() => { if (!picker.selectedLabel && !picker.fetchError) picker.setOpen(true) }}
            placeholder={placeholder}
            disabled={disabled}
            leftIcon={<Search />}
            role="combobox"
            aria-expanded={picker.open && !picker.fetchError}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={!picker.fetchError && picker.activeIndex >= 0 ? `${listId}-option-${picker.activeIndex}` : undefined}
          />
        </div>
        {picker.displayValue ? <IconButton type="button" variant="ghost" className="shrink-0" aria-label={t('documents.share.picker.clear')} onClick={picker.clear} disabled={disabled}><X aria-hidden="true" /></IconButton> : null}
      </div>
      {picker.fetchError ? <Alert status="error" size="sm" action={<Button type="button" size="sm" variant="outline" onMouseDown={(event) => event.preventDefault()} onClick={picker.retry} disabled={disabled || picker.loading}>{t('documents.share.picker.retry')}</Button>}>{t('documents.share.picker.error')}</Alert> : null}
      {picker.open && !picker.fetchError ? (
        <div id={listId} role="listbox" className="absolute z-popover mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
          {picker.loading ? <div className="px-3 py-2 text-sm text-muted-foreground">{t('documents.share.picker.loading')}</div> : null}
          {!picker.loading && picker.hasFetched && !picker.items.length ? <div className="px-3 py-2 text-sm text-muted-foreground">{t('documents.share.picker.noMatches')}</div> : null}
          {!picker.loading && picker.items.length ? <div className="space-y-1">{picker.items.map((item, index) => (
            <Button
              id={`${listId}-option-${index}`}
              key={item.id}
              type="button"
              variant="ghost"
              role="option"
              aria-selected={index === picker.activeIndex}
              disabled={disabled}
              className={cn('h-auto w-full justify-start px-3 py-2 text-left', index === picker.activeIndex && 'bg-accent text-accent-foreground')}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => picker.setActiveIndex(index)}
              onClick={() => picker.selectOption(item)}
            >
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{item.primary}</span>{item.secondary ? <span className="block truncate text-xs text-muted-foreground">{item.secondary}</span> : null}</span>
            </Button>
          ))}</div> : null}
          {!picker.loading && picker.hasFetched ? <div className="border-t border-border px-2 py-2">
            {picker.total > 0 ? <p className="mb-2 text-xs text-muted-foreground">{t('documents.share.picker.showing', { count: picker.items.length, total: picker.total })}</p> : null}
            {picker.page < picker.totalPages ? <Button type="button" size="sm" variant="outline" className="w-full" onMouseDown={(event) => event.preventDefault()} onClick={picker.loadMore} disabled={picker.loadingMore}>{picker.loadingMore ? t('documents.share.picker.loading') : t('documents.share.picker.loadMore')}</Button> : null}
          </div> : null}
        </div>
      ) : null}
    </div>
  )
}

export default PrincipalPicker
