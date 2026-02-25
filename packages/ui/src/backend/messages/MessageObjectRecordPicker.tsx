"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../primitives/button'
import { Input } from '../../primitives/input'
import { Label } from '../../primitives/label'
import { resolveMessageObjectPreviewComponent } from '@open-mercato/core/modules/messages/components/utils/typeUiRegistry'

export type MessageObjectOptionItem = {
  id: string
  label: string
  subtitle?: string
  entityModule?: string
  entityType?: string
  snapshot?: Record<string, unknown>
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
  entityModule?: string
  entityType?: string
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
  entityModule,
  entityType,
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
        <Label>
          {t('messages.composer.objectPicker.recordLabel', 'Record')}
        </Label>
        {!selectedId && (
          <p className="text-sm text-muted-foreground">
            {t('messages.composer.objectPicker.recordPlaceholder', 'Select record')}
          </p>
        )}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {items.map((item) => {
            const PreviewComponent = resolveMessageObjectPreviewComponent(
              item.entityModule || entityModule,
              item.entityType || entityType
            )

            return (
              <div
                key={item.id}
                className={`cursor-pointer rounded-md border p-2 transition-colors ${
                  selectedId === item.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/50'
                }`}
                onClick={() => onSelectedIdChange(item.id)}
              >
                {PreviewComponent ? (
                  <PreviewComponent
                    entityId={item.id}
                    entityModule={item.entityModule || entityModule || ''}
                    entityType={item.entityType || entityType || ''}
                    snapshot={item.snapshot}
                    previewData={{
                      title: item.label,
                      subtitle: item.subtitle || undefined,
                    }}
                  />
                ) : (
                  <div className="text-sm">
                    <p className="font-medium">{item.label}</p>
                    {item.subtitle && (
                      <p className="text-muted-foreground text-xs">{item.subtitle}</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {!isLoading && !error && items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('messages.composer.objectPicker.noRecords', 'No records found for this object type.')}
        </p>
      ) : null}
    </div>
  )
}
