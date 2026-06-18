"use client"

import * as React from 'react'
import { X, ChevronUp, ChevronDown } from 'lucide-react'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import type { Action } from './utils/actionValidation'
import { getActionTypeOptions, getRequiredConfigFields, getOptionalConfigFields } from './utils/actionValidation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type {
  OpenMercatoApiKeyOption,
  OpenMercatoEndpointOption,
} from '../lib/openmercato-call-options-types'

export type OpenMercatoCallOptionsState = {
  endpoints: OpenMercatoEndpointOption[]
  apiKeys: OpenMercatoApiKeyOption[]
  loading: boolean
  error: string | null
}

export type ActionRowProps = {
  action: Action
  index: number
  onChange: (index: number, action: Action) => void
  onDelete: (index: number) => void
  onMoveUp?: (index: number) => void
  onMoveDown?: (index: number) => void
  canMoveUp?: boolean
  canMoveDown?: boolean
  error?: string
  openMercatoOptions?: OpenMercatoCallOptionsState
}

export function ActionRow({
  action,
  index,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  error,
  openMercatoOptions,
}: ActionRowProps) {
  const t = useT()
  const actionTypes = getActionTypeOptions(t)
  const requiredFields = getRequiredConfigFields(action.type)
  const optionalFields = getOptionalConfigFields(action.type)

  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(index, {
      ...action,
      type: e.target.value,
      config: {}, // Reset config when type changes
    })
  }

  const handleConfigChange = (field: string, value: any) => {
    onChange(index, {
      ...action,
      config: {
        ...(action.config || {}),
        [field]: value,
      },
    })
  }

  const renderOpenMercatoConfig = () => {
    const options = openMercatoOptions ?? { endpoints: [], apiKeys: [], loading: false, error: null }
    const endpointValue = action.config?.endpoint && action.config?.method
      ? `${String(action.config.method).toUpperCase()} ${action.config.endpoint}`
      : undefined
    const apiKeyValue = action.config?.apiKeyId || undefined
    const bodyValue = action.config?.body == null
      ? ''
      : typeof action.config.body === 'string'
        ? action.config.body
        : JSON.stringify(action.config.body, null, 2)

    const handleEndpointChange = (value: string) => {
      const option = options.endpoints.find((candidate) => candidate.id === value)
      if (!option) return
      onChange(index, {
        ...action,
        config: {
          ...(action.config || {}),
          endpoint: option.path,
          method: option.method,
        },
      })
    }

    return (
      <div className="space-y-2">
        {options.loading && (
          <p className="text-xs text-muted-foreground col-start-2">
            {t('business_rules.components.actionRow.openMercato.options.loading')}
          </p>
        )}
        {options.error && (
          <p className="text-xs text-status-error-text col-start-2">
            {t('business_rules.components.actionRow.openMercato.options.error', { error: options.error })}
          </p>
        )}
        {!options.loading && !options.error && options.endpoints.length === 0 && (
          <p className="text-xs text-muted-foreground col-start-2">
            {t('business_rules.components.actionRow.openMercato.options.noEndpoints')}
          </p>
        )}
        {!options.loading && !options.error && options.apiKeys.length === 0 && (
          <p className="text-xs text-muted-foreground col-start-2">
            {t('business_rules.components.actionRow.openMercato.options.noApiKeys')}
          </p>
        )}

        <div className="grid grid-cols-4 gap-2 items-center">
          <label className="text-xs font-medium text-foreground col-span-1">
            {t('business_rules.components.actionRow.config.endpoint')} <span className="text-status-error-text">{t('business_rules.components.actionRow.actionType.required')}</span>
          </label>
          <Select
            value={endpointValue}
            onValueChange={handleEndpointChange}
            disabled={options.loading || !!options.error || options.endpoints.length === 0}
          >
            <SelectTrigger size="sm" className="col-span-3">
              <SelectValue placeholder={t('business_rules.components.actionRow.config.endpoint.placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {options.endpoints.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-4 gap-2 items-center">
          <label className="text-xs font-medium text-foreground col-span-1">
            {t('business_rules.components.actionRow.config.apiKey')} <span className="text-status-error-text">{t('business_rules.components.actionRow.actionType.required')}</span>
          </label>
          <Select
            value={apiKeyValue}
            onValueChange={(next) => handleConfigChange('apiKeyId', next)}
            disabled={options.loading || !!options.error || options.apiKeys.length === 0}
          >
            <SelectTrigger size="sm" className="col-span-3">
              <SelectValue placeholder={t('business_rules.components.actionRow.config.apiKey.placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {options.apiKeys.map((apiKey) => (
                <SelectItem key={apiKey.id} value={apiKey.id}>
                  {apiKey.organizationName
                    ? `${apiKey.name} (${apiKey.keyPrefix}, ${apiKey.organizationName})`
                    : `${apiKey.name} (${apiKey.keyPrefix})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-4 gap-2 items-start">
          <label className="text-xs font-medium text-foreground col-span-1">
            {t('business_rules.components.actionRow.config.body')}
          </label>
          <Textarea
            value={bodyValue}
            onChange={(e) => handleConfigChange('body', e.target.value)}
            placeholder={t('business_rules.components.actionRow.config.body.placeholder')}
            rows={3}
            className="col-span-3"
          />
        </div>
      </div>
    )
  }

  const renderConfigField = (field: string, required: boolean) => {
    const value = action.config?.[field] || ''

    // Special handling for different field types
    if (field === 'recipients' && action.type === 'NOTIFY') {
      return (
        <div key={field} className="grid grid-cols-4 gap-2 items-start">
          <label className="text-xs font-medium text-foreground col-span-1">
            {t('business_rules.components.actionRow.config.recipients')} {required && <span className="text-status-error-text">{t('business_rules.components.actionRow.actionType.required')}</span>}
          </label>
          <Input
            type="text"
            value={value}
            onChange={(e) => handleConfigChange(field, e.target.value.split(',').map((s) => s.trim()))}
            placeholder={t('business_rules.components.actionRow.config.recipients.placeholder')}
            className="col-span-3"
          />
          <div className="col-span-4 col-start-2">
            <p className="text-xs text-muted-foreground">{t('business_rules.components.actionRow.config.recipients.help')}</p>
          </div>
        </div>
      )
    }

    if (field === 'level' && action.type === 'LOG') {
      return (
        <div key={field} className="grid grid-cols-4 gap-2 items-center">
          <label className="text-xs font-medium text-foreground col-span-1">{t('business_rules.components.actionRow.config.level')}</label>
          <Select
            value={value || 'info'}
            onValueChange={(next) => handleConfigChange(field, next)}
          >
            <SelectTrigger size="sm" className="col-span-3">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="info">{t('business_rules.components.actionRow.config.level.info')}</SelectItem>
              <SelectItem value="warn">{t('business_rules.components.actionRow.config.level.warn')}</SelectItem>
              <SelectItem value="error">{t('business_rules.components.actionRow.config.level.error')}</SelectItem>
              <SelectItem value="debug">{t('business_rules.components.actionRow.config.level.debug')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )
    }

    if (field === 'method' && action.type === 'CALL_WEBHOOK') {
      return (
        <div key={field} className="grid grid-cols-4 gap-2 items-center">
          <label className="text-xs font-medium text-foreground col-span-1">{t('business_rules.components.actionRow.config.method')}</label>
          <Select
            value={value || 'POST'}
            onValueChange={(next) => handleConfigChange(field, next)}
          >
            <SelectTrigger size="sm" className="col-span-3">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="POST">POST</SelectItem>
              <SelectItem value="PUT">PUT</SelectItem>
              <SelectItem value="PATCH">PATCH</SelectItem>
              <SelectItem value="DELETE">DELETE</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )
    }

    if (field === 'message') {
      return (
        <div key={field} className="grid grid-cols-4 gap-2 items-start">
          <label className="text-xs font-medium text-foreground col-span-1">
            {t('business_rules.components.actionRow.config.message')} {required && <span className="text-status-error-text">{t('business_rules.components.actionRow.actionType.required')}</span>}
          </label>
          <Textarea
            value={value}
            onChange={(e) => handleConfigChange(field, e.target.value)}
            placeholder={t('business_rules.components.actionRow.config.message.placeholder')}
            rows={2}
            className="col-span-3"
          />
          <div className="col-span-4 col-start-2">
            <p className="text-xs text-muted-foreground">{t('business_rules.components.actionRow.config.message.help')}</p>
          </div>
        </div>
      )
    }

    // Default text input
    return (
      <div key={field} className="grid grid-cols-4 gap-2 items-center">
        <label className="text-xs font-medium text-foreground col-span-1">
          {field} {required && <span className="text-status-error-text">{t('business_rules.components.actionRow.actionType.required')}</span>}
        </label>
        <Input
          type="text"
          value={value}
          onChange={(e) => handleConfigChange(field, e.target.value)}
          placeholder={t('business_rules.components.actionRow.config.field.placeholder', { field })}
          className="col-span-3"
        />
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2 p-3 bg-muted rounded border border-border">
      <div className="flex-1 space-y-2">
        {/* Action Type */}
        <div className="grid grid-cols-4 gap-2 items-center">
          <label className="text-xs font-medium text-foreground col-span-1">
            {t('business_rules.components.actionRow.actionType')} <span className="text-status-error-text">{t('business_rules.components.actionRow.actionType.required')}</span>
          </label>
          <Select
            value={action.type || undefined}
            onValueChange={(value) => handleTypeChange({ target: { value } } as React.ChangeEvent<HTMLSelectElement>)}
          >
            <SelectTrigger size="sm" className="col-span-3 font-medium">
              <SelectValue placeholder={t('business_rules.components.actionRow.actionType.placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {actionTypes.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Config Fields */}
        {action.type && (
          <>
            {action.type === 'CALL_OPEN_MERCATO'
              ? renderOpenMercatoConfig()
              : (
                <>
                  {requiredFields.map((field) => renderConfigField(field, true))}
                  {optionalFields.map((field) => renderConfigField(field, false))}
                </>
              )}
          </>
        )}

        {/* Error Display */}
        {error && (
          <div className="mt-2">
            <p className="text-xs text-status-error-text">{error}</p>
          </div>
        )}
      </div>

      {/* Control Buttons */}
      <div className="flex flex-col gap-1">
        {onMoveUp && (
          <IconButton
            type="button"
            onClick={() => onMoveUp(index)}
            disabled={!canMoveUp}
            variant="ghost"
            size="xs"
            title={t('business_rules.components.actionRow.moveUp')}
            aria-label={t('business_rules.components.actionRow.moveUp')}
          >
            <ChevronUp className="w-4 h-4" />
          </IconButton>
        )}
        {onMoveDown && (
          <IconButton
            type="button"
            onClick={() => onMoveDown(index)}
            disabled={!canMoveDown}
            variant="ghost"
            size="xs"
            title={t('business_rules.components.actionRow.moveDown')}
            aria-label={t('business_rules.components.actionRow.moveDown')}
          >
            <ChevronDown className="w-4 h-4" />
          </IconButton>
        )}
        <IconButton
          type="button"
          onClick={() => onDelete(index)}
          variant="ghost"
          size="xs"
          className="hover:text-status-error-text"
          title={t('business_rules.components.actionRow.delete')}
          aria-label={t('business_rules.components.actionRow.delete')}
        >
          <X className="w-4 h-4" />
        </IconButton>
      </div>
    </div>
  )
}
