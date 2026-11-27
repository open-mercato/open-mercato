import type { FormSaveBarProps } from '../contracts/form-save-bar'

const noop = () => undefined

export const formSaveBarFixtures: Record<string, FormSaveBarProps> = {
  dirty: { saveState: 'dirty', placement: 'inline', onSave: noop, onReset: noop },
  saving: { saveState: 'saving', placement: 'inline', onSave: noop, onReset: noop },
  saved: { saveState: 'saved', savedAt: '2026-03-12T10:15:00Z', placement: 'inline', onSave: noop, onReset: noop },
  failed: {
    saveState: 'failed',
    message: 'Could not save. The connection was lost.',
    placement: 'inline',
    onSave: noop,
    onReset: noop,
  },
  withActions: {
    saveState: 'dirty',
    placement: 'inline',
    onSave: noop,
    onReset: noop,
    actions: [
      { key: 'save-copy', label: 'Save as copy', icon: 'copy' },
      { key: 'save-draft', label: 'Save as draft' },
      { key: 'delete', label: 'Delete record', icon: 'trash-2', tone: 'destructive' },
    ],
    onAction: noop,
  },
  saveDisabled: {
    saveState: 'dirty',
    placement: 'inline',
    onSave: noop,
    onReset: noop,
    saveDisabledReason: 'Fill in the company name before saving',
  },
  alwaysVisible: { saveState: 'idle', alwaysVisible: true, placement: 'inline', onSave: noop, onReset: noop },
  loading: { saveState: 'idle', alwaysVisible: true, status: 'loading', placement: 'inline', onSave: noop },
}
