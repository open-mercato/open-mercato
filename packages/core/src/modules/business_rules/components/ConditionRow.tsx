"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { X } from 'lucide-react'
import type { SimpleCondition } from './utils/conditionValidation'
import { getComparisonOperators, isValidFieldPath } from './utils/conditionValidation'

export type ConditionRowProps = {
  condition: SimpleCondition
  onChange: (condition: SimpleCondition) => void
  onDelete: () => void
  entityType?: string
  error?: string
}

export function ConditionRow({ condition, onChange, onDelete, error }: ConditionRowProps) {
  const operators = getComparisonOperators()
  const [useFieldComparison, setUseFieldComparison] = React.useState(!!condition.valueField)

  const handleFieldChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...condition, field: e.target.value })
  }

  const handleOperatorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ ...condition, operator: e.target.value as any })
  }

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value

    // Try to parse as JSON for arrays/objects
    let parsedValue: any = rawValue
    if (rawValue.trim().startsWith('[') || rawValue.trim().startsWith('{')) {
      try {
        parsedValue = JSON.parse(rawValue)
      } catch {
        // Keep as string if not valid JSON
        parsedValue = rawValue
      }
    }

    onChange({ ...condition, value: parsedValue, valueField: undefined })
  }

  const handleValueFieldChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...condition, valueField: e.target.value, value: null })
  }

  const toggleFieldComparison = () => {
    if (useFieldComparison) {
      onChange({ ...condition, valueField: undefined, value: null })
      setUseFieldComparison(false)
    } else {
      onChange({ ...condition, value: null, valueField: '' })
      setUseFieldComparison(true)
    }
  }

  // Operators that don't need a value
  const operatorNeedsValue = !['IS_EMPTY', 'IS_NOT_EMPTY'].includes(condition.operator)

  const fieldError = condition.field && !isValidFieldPath(condition.field)

  return (
    <div className="flex items-start gap-2 p-3 bg-gray-50 rounded border border-gray-200">
      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
        {/* Field Input */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Field</label>
          <input
            type="text"
            value={condition.field || ''}
            onChange={handleFieldChange}
            placeholder="e.g., status, user.email"
            className={`w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              fieldError ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {fieldError && <p className="text-xs text-red-600 mt-0.5">Invalid field path</p>}
        </div>

        {/* Operator Select */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Operator</label>
          <select
            value={condition.operator || '='}
            onChange={handleOperatorChange}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {operators.map((op) => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))}
          </select>
        </div>

        {/* Value Input */}
        {operatorNeedsValue && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-gray-700">
                {useFieldComparison ? 'Compare to Field' : 'Value'}
              </label>
              <button
                type="button"
                onClick={toggleFieldComparison}
                className="text-xs text-blue-600 hover:text-blue-800"
                title="Toggle field comparison"
              >
                {useFieldComparison ? 'Use value' : 'Use field'}
              </button>
            </div>
            <input
              type="text"
              value={
                useFieldComparison
                  ? (condition.valueField || '')
                  : (condition.value === null || condition.value === undefined)
                    ? ''
                    : typeof condition.value === 'string'
                      ? condition.value
                      : JSON.stringify(condition.value)
              }
              onChange={useFieldComparison ? handleValueFieldChange : handleValueChange}
              placeholder={useFieldComparison ? 'e.g., user.role' : 'e.g., "ACTIVE" or ["A","B"]'}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-0.5">
              {useFieldComparison ? 'Field path to compare with' : 'Use JSON for arrays: ["a","b"]'}
            </p>
          </div>
        )}
      </div>

      {/* Delete Button */}
      <button
        type="button"
        onClick={onDelete}
        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
        title="Delete condition"
      >
        <X className="w-4 h-4" />
      </button>

      {/* Error Display */}
      {error && (
        <div className="col-span-full mt-2">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}
    </div>
  )
}
