"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Plus, Code } from 'lucide-react'
import { ActionRow } from './ActionRow'
import type { Action } from './utils/actionValidation'
import { validateActions } from './utils/actionValidation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type ActionBuilderProps = {
  value: Action[] | null | undefined
  onChange: (value: Action[]) => void
  error?: string
  showJsonPreview?: boolean
  label?: string
  emptyMessage?: string
}

export function ActionBuilder({
  value,
  onChange,
  error,
  showJsonPreview = false,
  label,
  emptyMessage,
}: ActionBuilderProps) {
  const t = useT()
  const [showDebug, setShowDebug] = React.useState(false)
  const actions = value || []

  const handleAddAction = () => {
    const newAction: Action = {
      type: '',
      config: {},
    }
    onChange([...actions, newAction])
  }

  const handleChangeAction = (index: number, updatedAction: Action) => {
    const newActions = [...actions]
    newActions[index] = updatedAction
    onChange(newActions)
  }

  const handleDeleteAction = (index: number) => {
    const newActions = actions.filter((_, i) => i !== index)
    onChange(newActions)
  }

  const handleMoveUp = (index: number) => {
    if (index === 0) return
    const newActions = [...actions]
    const temp = newActions[index - 1]
    newActions[index - 1] = newActions[index]
    newActions[index] = temp
    onChange(newActions)
  }

  const handleMoveDown = (index: number) => {
    if (index === actions.length - 1) return
    const newActions = [...actions]
    const temp = newActions[index + 1]
    newActions[index + 1] = newActions[index]
    newActions[index] = temp
    onChange(newActions)
  }

  const handleClearAll = () => {
    if (confirm(t('business_rules.components.actionBuilder.confirm.clearAll'))) {
      onChange([])
    }
  }

  // Validate actions (memoized to avoid expensive re-computation)
  const validation = React.useMemo(() => {
    return validateActions(actions, t)
  }, [actions, t])

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">
            {label || t('business_rules.components.actionBuilder.label')}
          </h3>
          {actions.length > 0 && (
            <span className="text-xs text-muted-foreground">
              ({t('business_rules.components.actionBuilder.actionCount', { count: actions.length })})
            </span>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {showJsonPreview && actions.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDebug(!showDebug)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              title={t('business_rules.components.actionBuilder.jsonPreview.toggle')}
            >
              <Code className="w-3 h-3" />
              {showDebug
                ? t('business_rules.components.actionBuilder.jsonPreview.hide')
                : t('business_rules.components.actionBuilder.jsonPreview.show')
              }
            </button>
          )}
        </div>
      </div>

      {/* Empty State */}
      {actions.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-border rounded-lg bg-muted">
          <p className="text-sm text-muted-foreground mb-4">
            {emptyMessage || t('business_rules.components.actionBuilder.emptyMessage')}
          </p>
          <Button type="button" onClick={handleAddAction} variant="outline" size="sm">
            <Plus className="w-4 h-4 mr-2" />
            {t('business_rules.components.actionBuilder.addAction')}
          </Button>
        </div>
      ) : (
        <>
          {/* Action List */}
          <div className="space-y-2">
            {actions.map((action, index) => (
              <ActionRow
                key={index}
                action={action}
                index={index}
                onChange={handleChangeAction}
                onDelete={handleDeleteAction}
                onMoveUp={index > 0 ? handleMoveUp : undefined}
                onMoveDown={index < actions.length - 1 ? handleMoveDown : undefined}
                canMoveUp={index > 0}
                canMoveDown={index < actions.length - 1}
              />
            ))}
          </div>

          {/* Add More / Clear All */}
          <div className="flex items-center justify-between">
            <Button type="button" onClick={handleAddAction} variant="outline" size="sm">
              <Plus className="w-4 h-4 mr-2" />
              {t('business_rules.components.actionBuilder.addAction')}
            </Button>
            {actions.length > 1 && (
              <Button type="button" onClick={handleClearAll} variant="outline" size="sm" className="text-red-600">
                {t('business_rules.components.actionBuilder.clearAll')}
              </Button>
            )}
          </div>
        </>
      )}

      {/* Validation Errors */}
      {!validation.valid && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
          <p className="text-sm font-medium text-red-800 dark:text-red-300 mb-1">
            {t('business_rules.components.actionBuilder.validationErrors')}
          </p>
          <ul className="list-disc list-inside space-y-0.5">
            {validation.errors.map((err, index) => (
              <li key={index} className="text-xs text-red-700 dark:text-red-400">
                {err}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* External Error */}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* JSON Preview */}
      {showDebug && actions.length > 0 && (
        <div className="p-3 bg-zinc-900 dark:bg-zinc-950 rounded text-xs font-mono overflow-x-auto border border-border">
          <pre className="text-zinc-100">{JSON.stringify(actions, null, 2)}</pre>
        </div>
      )}

      {/* Help Text */}
      {actions.length > 0 && (
        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            <strong>{t('business_rules.components.actionBuilder.help.actionOrder')}</strong>{' '}
            {t('business_rules.components.actionBuilder.help.actionOrderDescription')}
          </p>
          <p>
            <strong>{t('business_rules.components.actionBuilder.help.messageInterpolation')}</strong>{' '}
            {t('business_rules.components.actionBuilder.help.messageInterpolationDescription')}
          </p>
        </div>
      )}
    </div>
  )
}
