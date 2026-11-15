'use client'

import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import type { LedgerEntry } from '../../lib/context-ledger'
import { VariablePickerButton, type VariablePickerInsertMode } from './VariablePickerButton'
import { ledgerDropTargetProps } from './ledgerDropTarget'

/**
 * A text control that speaks the context vocabulary: the ledger-fed variable
 * picker sits beside it and a row dragged out of the Input data panel inserts
 * at the caret. Exactly the pairing activity config fields already use
 * (`MappingArrayEditor`), lifted so the task inspector's copy fields get it
 * without repeating the wiring five times.
 *
 * Deliberately renders NO label or helper row: hosts are CrudForm custom
 * fields, and CrudForm already owns the label, the required marker and the
 * error text for the field it renders this inside.
 */

export interface TemplateTextControlProps {
  id: string
  value: string
  onValueChange: (nextValue: string) => void
  ledgerEntries?: LedgerEntry[]
  placeholder?: string
  disabled?: boolean
  multiline?: boolean
  rows?: number
  insertMode?: VariablePickerInsertMode
  'aria-label'?: string
}

export function TemplateTextControl({
  id,
  value,
  onValueChange,
  ledgerEntries,
  placeholder,
  disabled,
  multiline = false,
  rows = 4,
  insertMode = 'template',
  'aria-label': ariaLabel,
}: TemplateTextControlProps) {
  const dropProps = ledgerDropTargetProps({ value, onValueChange, insertMode, disabled })

  return (
    <div className="flex items-start gap-1">
      {multiline ? (
        <Textarea
          id={id}
          value={value}
          rows={rows}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          className="flex-1"
          {...dropProps}
        />
      ) : (
        <Input
          id={id}
          type="text"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          className="flex-1"
          {...dropProps}
        />
      )}
      <VariablePickerButton
        targetId={id}
        value={value}
        onValueChange={onValueChange}
        ledgerEntries={ledgerEntries}
        insertMode={insertMode}
        disabled={disabled}
      />
    </div>
  )
}
