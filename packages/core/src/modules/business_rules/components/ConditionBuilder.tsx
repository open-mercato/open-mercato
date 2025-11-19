"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Plus, Code } from 'lucide-react'
import { ConditionGroup } from './ConditionGroup'
import type { GroupCondition, ConditionExpression } from './utils/conditionValidation'
import { validateConditionExpression } from './utils/conditionValidation'

export type ConditionBuilderProps = {
  value: GroupCondition | null | undefined
  onChange: (value: GroupCondition) => void
  entityType?: string
  maxDepth?: number
  error?: string
  showJsonPreview?: boolean
}

export function ConditionBuilder({
  value,
  onChange,
  entityType,
  maxDepth = 5,
  error,
  showJsonPreview = false,
}: ConditionBuilderProps) {
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
    onChange(initialGroup)
  }

  const handleChange = (updatedGroup: GroupCondition) => {
    onChange(updatedGroup)
  }

  const handleClear = () => {
    if (confirm('Are you sure you want to clear all conditions?')) {
      onChange({
        operator: 'AND',
        rules: [],
      })
    }
  }

  // Validate current value
  const validation = value ? validateConditionExpression(value) : { valid: true, errors: [] }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-gray-700">Condition Builder</h3>
          {value && value.rules && value.rules.length > 0 && (
            <span className="text-xs text-gray-500">
              ({value.rules.length} {value.rules.length === 1 ? 'rule' : 'rules'})
            </span>
          )}
        </div>

        {/* Debug Toggle */}
        {showJsonPreview && value && (
          <button
            type="button"
            onClick={() => setShowDebug(!showDebug)}
            className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-800"
            title="Toggle JSON preview"
          >
            <Code className="w-3 h-3" />
            {showDebug ? 'Hide' : 'Show'} JSON
          </button>
        )}
      </div>

      {/* Empty State */}
      {!value || !value.rules || value.rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50">
          <p className="text-sm text-gray-600 mb-4">No conditions defined</p>
          <Button type="button" onClick={handleInitialize} variant="outline" size="sm">
            <Plus className="w-4 h-4 mr-2" />
            Add First Condition
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
              Clear All
            </Button>
          </div>
        </>
      )}

      {/* Validation Errors */}
      {!validation.valid && (
        <div className="p-3 bg-red-50 border border-red-200 rounded">
          <p className="text-sm font-medium text-red-800 mb-1">Validation Errors:</p>
          <ul className="list-disc list-inside space-y-0.5">
            {validation.errors.map((err, index) => (
              <li key={index} className="text-xs text-red-700">
                {err}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* External Error */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* JSON Preview */}
      {showDebug && value && (
        <div className="p-3 bg-gray-900 rounded text-xs font-mono overflow-x-auto">
          <pre className="text-gray-100">{JSON.stringify(value, null, 2)}</pre>
        </div>
      )}

      {/* Help Text */}
      <div className="text-xs text-gray-500 space-y-1">
        <p>
          <strong>Field paths:</strong> Use dot notation (e.g., <code className="px-1 py-0.5 bg-gray-100 rounded">status</code>,{' '}
          <code className="px-1 py-0.5 bg-gray-100 rounded">user.email</code>)
        </p>
        <p>
          <strong>Values:</strong> Use JSON for arrays/objects (e.g.,{' '}
          <code className="px-1 py-0.5 bg-gray-100 rounded">["ACTIVE","PENDING"]</code>)
        </p>
        <p>
          <strong>Field comparison:</strong> Click "Use field" to compare two field values instead of a static value
        </p>
      </div>
    </div>
  )
}
