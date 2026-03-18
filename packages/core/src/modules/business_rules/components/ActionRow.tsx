"use client"

import * as React from 'react'
import { X, ChevronUp, ChevronDown } from 'lucide-react'
import type { Action } from './utils/actionValidation'
import { getActionTypeOptions, getRequiredConfigFields, getOptionalConfigFields } from './utils/actionValidation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

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

  const renderConfigField = (field: string, required: boolean) => {
    const value = action.config?.[field] || ''

    // Special handling for different field types
    if (field === 'recipients' && action.type === 'NOTIFY') {
      return (
        <div key={field} className="grid grid-cols-4 gap-2 items-start">
          <label className="text-xs font-medium text-foreground col-span-1">
            {t('business_rules.components.actionRow.config.recipients')} {required && <span className="text-red-500">{t('business_rules.components.actionRow.actionType.required')}</span>}
          </label>
          <input
            type="text"
            value={value}
            onChange={(e) => handleConfigChange(field, e.target.value.split(',').map((s) => s.trim()))}
            placeholder={t('business_rules.components.actionRow.config.recipients.placeholder')}
            className="col-span-3 px-2 py-1.5 text-sm border border-border rounded bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          <select
            value={value || 'info'}
            onChange={(e) => handleConfigChange(field, e.target.value)}
            className="col-span-3 px-2 py-1.5 text-sm border border-border rounded bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="info">{t('business_rules.components.actionRow.config.level.info')}</option>
            <option value="warn">{t('business_rules.components.actionRow.config.level.warn')}</option>
            <option value="error">{t('business_rules.components.actionRow.config.level.error')}</option>
            <option value="debug">{t('business_rules.components.actionRow.config.level.debug')}</option>
          </select>
        </div>
      )
    }

    if (field === 'method' && action.type === 'CALL_WEBHOOK') {
      return (
        <div key={field} className="grid grid-cols-4 gap-2 items-center">
          <label className="text-xs font-medium text-foreground col-span-1">{t('business_rules.components.actionRow.config.method')}</label>
          <select
            value={value || 'POST'}
            onChange={(e) => handleConfigChange(field, e.target.value)}
            className="col-span-3 px-2 py-1.5 text-sm border border-border rounded bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
          </select>
        </div>
      )
    }

    if (field === 'message') {
      return (
        <div key={field} className="grid grid-cols-4 gap-2 items-start">
          <label className="text-xs font-medium text-foreground col-span-1">
            {t('business_rules.components.actionRow.config.message')} {required && <span className="text-red-500">{t('business_rules.components.actionRow.actionType.required')}</span>}
          </label>
          <textarea
            value={value}
            onChange={(e) => handleConfigChange(field, e.target.value)}
            placeholder={t('business_rules.components.actionRow.config.message.placeholder')}
            rows={2}
            className="col-span-3 px-2 py-1.5 text-sm border border-border rounded bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          {field} {required && <span className="text-red-500">{t('business_rules.components.actionRow.actionType.required')}</span>}
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => handleConfigChange(field, e.target.value)}
          placeholder={t('business_rules.components.actionRow.config.field.placeholder', { field })}
          className="col-span-3 px-2 py-1.5 text-sm border border-border rounded bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            {t('business_rules.components.actionRow.actionType')} <span className="text-red-500">{t('business_rules.components.actionRow.actionType.required')}</span>
          </label>
          <select
            value={action.type || ''}
            onChange={handleTypeChange}
            className="col-span-3 px-2 py-1.5 text-sm border border-border rounded bg-background focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
          >
            <option value="">{t('business_rules.components.actionRow.actionType.placeholder')}</option>
            {actionTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        {/* Config Fields */}
        {action.type && (
          <>
            {requiredFields.map((field) => renderConfigField(field, true))}
            {optionalFields.map((field) => renderConfigField(field, false))}
          </>
        )}

        {/* Error Display */}
        {error && (
          <div className="mt-2">
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}
      </div>

      {/* Control Buttons */}
      <div className="flex flex-col gap-1">
        {onMoveUp && (
          <button
            type="button"
            onClick={() => onMoveUp(index)}
            disabled={!canMoveUp}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title={t('business_rules.components.actionRow.moveUp')}
          >
            <ChevronUp className="w-4 h-4" />
          </button>
        )}
        {onMoveDown && (
          <button
            type="button"
            onClick={() => onMoveDown(index)}
            disabled={!canMoveDown}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title={t('business_rules.components.actionRow.moveDown')}
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(index)}
          className="p-1 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
          title={t('business_rules.components.actionRow.delete')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
