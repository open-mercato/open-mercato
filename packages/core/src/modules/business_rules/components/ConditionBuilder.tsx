"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Plus, Code } from 'lucide-react'
import { ConditionGroup } from './ConditionGroup'
import type { GroupCondition, ConditionExpression } from './utils/conditionValidation'
import { validateConditionExpression } from './utils/conditionValidation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type ConditionBuilderProps = {
  value: GroupCondition | null | undefined
  onChangeAction: (value: GroupCondition) => void
  entityType?: string
  maxDepth?: number
  error?: string
  showJsonPreview?: boolean
}

export function ConditionBuilder({
  value,
  onChangeAction,
  entityType,
  maxDepth = 5,
  error,
  showJsonPreview = false,
}: ConditionBuilderProps) {
  const t = useT()
  const [showDebug, setShowDebug] = React.useState(false)

  const handleInitialize = () => {
    const initialGroup: GroupCondition = {
      operator: 'AND',
      rules: [
        {
          field: '',
          operator: '=',
          value: null,
        },
      ],
    }
    onChangeAction(initialGroup)
  }

  const handleChange = (updatedGroup: GroupCondition) => {
    onChangeAction(updatedGroup)
  }

  const handleClear = () => {
    if (confirm(t('business_rules.components.conditionBuilder.confirm.clearAll'))) {
      onChangeAction({
        operator: 'AND',
        rules: [],
      })
    }
  }

  // Validate current value (memoized to avoid expensive re-computation)
  const validation = React.useMemo(() => {
    return value ? validateConditionExpression(value, 0, 5, t) : { valid: true, errors: [] }
  }, [value, t])

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">
            {t('business_rules.components.conditionBuilder.title')}
          </h3>
          {value && value.rules && value.rules.length > 0 && (
            <span className="text-xs text-muted-foreground">
              ({t('business_rules.components.conditionBuilder.ruleCount', { count: value.rules.length })})
            </span>
          )}
        </div>

        {/* Debug Toggle */}
        {showJsonPreview && value && (
          <button
            type="button"
            onClick={() => setShowDebug(!showDebug)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            title={t('business_rules.components.conditionBuilder.jsonPreview.toggle')}
          >
            <Code className="w-3 h-3" />
            {showDebug
              ? t('business_rules.components.conditionBuilder.jsonPreview.hide')
              : t('business_rules.components.conditionBuilder.jsonPreview.show')
            }
          </button>
        )}
      </div>

      {/* Empty State */}
      {!value || !value.rules || value.rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-border rounded-lg bg-muted">
          <p className="text-sm text-muted-foreground mb-4">
            {t('business_rules.components.conditionBuilder.emptyMessage')}
          </p>
          <Button type="button" onClick={handleInitialize} variant="outline" size="sm">
            <Plus className="w-4 h-4 mr-2" />
            {t('business_rules.components.conditionBuilder.addFirstCondition')}
          </Button>
        </div>
      ) : (
        <>
          {/* Condition Tree */}
          <ConditionGroup
            group={value}
            onChange={handleChange}
            depth={0}
            maxDepth={maxDepth}
            entityType={entityType}
          />

          {/* Clear Button */}
          <div className="flex justify-end">
            <Button type="button" onClick={handleClear} variant="outline" size="sm" className="text-red-600">
              {t('business_rules.components.conditionBuilder.clearAll')}
            </Button>
          </div>
        </>
      )}

      {/* Validation Errors */}
      {!validation.valid && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
          <p className="text-sm font-medium text-red-800 dark:text-red-300 mb-1">
            {t('business_rules.components.conditionBuilder.validationErrors')}
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
      {showDebug && value && (
        <div className="p-3 bg-zinc-900 dark:bg-zinc-950 rounded text-xs font-mono overflow-x-auto border border-border">
          <pre className="text-zinc-100">{JSON.stringify(value, null, 2)}</pre>
        </div>
      )}

      {/* Help Text */}
      <div className="text-xs text-muted-foreground space-y-1">
        <p>
          <strong>{t('business_rules.components.conditionBuilder.help.fieldPaths')}</strong>{' '}
          {t('business_rules.components.conditionBuilder.help.fieldPathsDescription')}
        </p>
        <p>
          <strong>{t('business_rules.components.conditionBuilder.help.values')}</strong>{' '}
          {t('business_rules.components.conditionBuilder.help.valuesDescription')}
        </p>
        <p>
          <strong>{t('business_rules.components.conditionBuilder.help.fieldComparison')}</strong>{' '}
          {t('business_rules.components.conditionBuilder.help.fieldComparisonDescription')}
        </p>
      </div>
    </div>
  )
}
