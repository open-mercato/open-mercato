'use client'

import * as React from 'react'
import { ChevronDown, Cpu } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '../primitives/button'

export interface ModelPickerProviderModel {
  id: string
  name: string
  contextWindow?: number | null
  tags?: string[]
  isDefault: boolean
}

export interface ModelPickerProvider {
  id: string
  name: string
  isDefault: boolean
  models: ModelPickerProviderModel[]
}

export interface ModelPickerValue {
  providerId: string
  modelId: string
  baseURL?: string | null
}

export interface ModelPickerProps {
  agentId: string
  value: ModelPickerValue | null
  onChange: (value: ModelPickerValue | null) => void
  availableProviders: ModelPickerProvider[]
  disabled?: boolean
  compact?: boolean
  defaultLabel?: string | null
  className?: string
}

/**
 * Stateless dropdown for selecting a provider + model override in the chat UI.
 *
 * - Renders provider name + model id + "(default)" badge for the agent's resolved default.
 * - Keyboard-accessible: trigger opens a floating list, arrow keys navigate, Enter selects,
 *   Escape closes.
 * - Does NOT expose a baseURL input (R6 mitigation: only provider+model selection from the
 *   curated catalog is exposed to end users).
 * - localStorage persistence keyed by agentId is handled by the consumer (AiChat / 4b.2).
 * - When allowRuntimeModelOverride is false the consumer should not render this component
 *   at all; this component itself does no gating.
 */
export function ModelPicker({
  agentId,
  value,
  onChange,
  availableProviders,
  disabled,
  compact = false,
  defaultLabel,
  className,
}: ModelPickerProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)

  const selectedLabel = React.useMemo(() => {
    if (!value) {
      return defaultLabel
        ? t('ai_assistant.modelPicker.defaultWithModelLabel', 'Default: {{model}}').replace('{{model}}', defaultLabel)
        : t('ai_assistant.modelPicker.defaultLabel', 'Model: Default')
    }
    const provider = availableProviders.find((p) => p.id === value.providerId)
    const model = provider?.models.find((m) => m.id === value.modelId)
    const modelLabel = model?.name ?? value.modelId
    const providerLabel = provider?.name ?? value.providerId
    return `${providerLabel} / ${modelLabel}`
  }, [value, availableProviders, defaultLabel, t])

  const handleToggle = React.useCallback(() => {
    if (disabled) return
    setOpen((prev) => !prev)
  }, [disabled])

  const handleSelect = React.useCallback(
    (providerId: string, modelId: string) => {
      onChange({ providerId, modelId })
      setOpen(false)
      triggerRef.current?.focus()
    },
    [onChange],
  )

  const handleClearDefault = React.useCallback(() => {
    onChange(null)
    setOpen(false)
    triggerRef.current?.focus()
  }, [onChange])

  React.useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  if (availableProviders.length === 0) return null

  return (
    <div ref={containerRef} className={cn('relative', className)} data-ai-model-picker={agentId}>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('ai_assistant.modelPicker.triggerAriaLabel', 'Select AI model')}
        title={selectedLabel}
        data-ai-model-picker-trigger
        className={cn(
          'font-normal',
          compact ? 'w-8 gap-0 px-0' : 'gap-1.5 px-2.5',
        )}
      >
        <Cpu className="size-3.5 shrink-0" aria-hidden />
        {!compact ? (
          <span className="max-w-[140px] truncate text-xs">{selectedLabel}</span>
        ) : null}
        <ChevronDown
          className={cn(
            'size-3 shrink-0 transition-transform',
            compact && 'hidden',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </Button>

      {open ? (
        <div
          role="listbox"
          aria-label={t('ai_assistant.modelPicker.listAriaLabel', 'Available models')}
          className={cn(
            'absolute bottom-full left-0 z-50 mb-1 max-h-72 min-w-[220px] overflow-y-auto',
            'rounded-md border border-border bg-popover shadow-md',
          )}
          data-ai-model-picker-dropdown
        >
          <div
            role="option"
            aria-selected={value === null}
            tabIndex={0}
            className={cn(
              'cursor-pointer px-3 py-2 text-xs hover:bg-accent hover:text-accent-foreground',
              'flex items-center gap-2',
              value === null && 'bg-accent/50',
            )}
            onClick={handleClearDefault}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                handleClearDefault()
              }
            }}
            data-ai-model-picker-default-option
          >
            <span className="flex-1">
              {defaultLabel
                ? t('ai_assistant.modelPicker.useDefaultWithModel', 'Use agent default: {{model}}').replace('{{model}}', defaultLabel)
                : t('ai_assistant.modelPicker.useDefault', 'Use agent default')}
            </span>
            {value === null ? (
              <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] font-medium text-primary">
                {t('ai_assistant.modelPicker.activeBadge', 'active')}
              </span>
            ) : null}
          </div>
          {availableProviders.map((provider) => (
            <div key={provider.id} data-ai-model-picker-provider={provider.id}>
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {provider.name}
              </div>
              {provider.models.map((model) => {
                const isSelected =
                  value?.providerId === provider.id && value?.modelId === model.id
                return (
                  <div
                    key={model.id}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={0}
                    className={cn(
                      'cursor-pointer px-3 py-2 text-xs hover:bg-accent hover:text-accent-foreground',
                      'flex items-center gap-2 pl-5',
                      isSelected && 'bg-accent/50',
                    )}
                    onClick={() => handleSelect(provider.id, model.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        handleSelect(provider.id, model.id)
                      }
                    }}
                    data-ai-model-picker-model={`${provider.id}:${model.id}`}
                  >
                    <span className="flex-1 truncate">{model.name}</span>
                    {model.isDefault ? (
                      <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                        {t('ai_assistant.modelPicker.defaultBadge', 'default')}
                      </span>
                    ) : null}
                    {isSelected ? (
                      <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[10px] font-medium text-primary">
                        {t('ai_assistant.modelPicker.activeBadge', 'active')}
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default ModelPicker
