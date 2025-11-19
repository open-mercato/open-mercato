"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Plus, Code } from 'lucide-react'
import { ActionRow } from './ActionRow'
import type { Action } from './utils/actionValidation'
import { validateActions } from './utils/actionValidation'

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
  label = 'Actions',
  emptyMessage = 'No actions defined',
}: ActionBuilderProps) {
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
    if (confirm('Are you sure you want to clear all actions?')) {
      onChange([])
    }
  }

  // Validate actions
  const validation = validateActions(actions)

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-gray-700">{label}</h3>
          {actions.length > 0 && (
            <span className="text-xs text-gray-500">
              ({actions.length} {actions.length === 1 ? 'action' : 'actions'})
            </span>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {showJsonPreview && actions.length > 0 && (
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
      </div>

      {/* Empty State */}
      {actions.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50">
          <p className="text-sm text-gray-600 mb-4">{emptyMessage}</p>
          <Button type="button" onClick={handleAddAction} variant="outline" size="sm">
            <Plus className="w-4 h-4 mr-2" />
            Add Action
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
              Add Action
            </Button>
            {actions.length > 1 && (
              <Button type="button" onClick={handleClearAll} variant="outline" size="sm" className="text-red-600">
                Clear All
              </Button>
            )}
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
      {showDebug && actions.length > 0 && (
        <div className="p-3 bg-gray-900 rounded text-xs font-mono overflow-x-auto">
          <pre className="text-gray-100">{JSON.stringify(actions, null, 2)}</pre>
        </div>
      )}

      {/* Help Text */}
      {actions.length > 0 && (
        <div className="text-xs text-gray-500 space-y-1">
          <p>
            <strong>Action order:</strong> Actions execute in the order shown. Use up/down arrows to reorder.
          </p>
          <p>
            <strong>Message interpolation:</strong> Use{' '}
            <code className="px-1 py-0.5 bg-gray-100 rounded">{'{{'} fieldName {'}'}</code> to insert entity field
            values
          </p>
        </div>
      )}
    </div>
  )
}
