"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../primitives/button'
import { Input } from '../../primitives/input'
import { Label } from '../../primitives/label'

export type MessageObjectOptionItem = {
  id: string
  label: string
  subtitle?: string
}

export type MessageObjectRecordPickerProps = {
  search: string
  onSearchChange: (value: string) => void
  selectedId: string
  onSelectedIdChange: (value: string) => void
  items: MessageObjectOptionItem[]
  isLoading: boolean
  error: string | null
  onRetry: () => void
}

export function MessageObjectRecordPicker({
  search,
  onSearchChange,
  selectedId,
  onSelectedIdChange,
  items,
  isLoading,
  error,
  onRetry,
}: MessageObjectRecordPickerProps) {
  const t = useT()

  return (
    <div className="space-y-2">
      <Label htmlFor="messages-object-record-search">
        {t('messages.composer.objectPicker.recordSearchLabel', 'Search records')}
      </Label>
      <Input
        id="messages-object-record-search"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={t('messages.composer.objectPicker.recordSearchPlaceholder', 'Type to find a record')}
      />

      {isLoading ? (
        <p className="text-xs text-muted-foreground">
          {t('messages.composer.objectPicker.loadingRecords', 'Loading records...')}
        </p>
      ) : null}

      {error ? (
        <div className="space-y-2 rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          <p>{error}</p>
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            {t('common.retry', 'Retry')}
          </Button>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="messages-object-record-select">
          {t('messages.composer.objectPicker.recordLabel', 'Record')}
        </Label>
        <select
          id="messages-object-record-select"
          value={selectedId}
          onChange={(event) => onSelectedIdChange(event.target.value)}
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="">
            {t('messages.composer.objectPicker.recordPlaceholder', 'Select record')}
          </option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.subtitle ? `${item.label} (${item.subtitle})` : item.label}
            </option>
          ))}
        </select>
      </div>

      {!isLoading && !error && items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('messages.composer.objectPicker.noRecords', 'No records found for this object type.')}
        </p>
      ) : null}
    </div>
  )
}
