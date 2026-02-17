"use client"

import type { DictionarySelectLabels } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import type { CustomerDictionaryKind } from '../../lib/dictionaries'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'

export function formatDateTime(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

export function formatDate(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString()
}

export function formatTemplate(template: string, params?: Record<string, string | number>): string {
  if (!template) return template
  if (!params) return template
  return template.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (match, doubleKey, singleKey) => {
    const key = doubleKey ?? singleKey
    if (!key) return match
    const value = params[key]
    return value === undefined ? match : String(value)
  })
}

export function toLocalDateTimeInput(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (input: number) => `${input}`.padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`
}

export function resolveTodoHref(source: string, todoId: string | null | undefined): string | null {
  if (!todoId) return null
  if (!source) return null
  const [module] = source.split(':')
  if (!module) return null
  return `/backend/${module}/todos/${encodeURIComponent(todoId)}/edit`
}

export function resolveTodoApiPath(source: string): string | null {
  if (!source) return null
  const [module] = source.split(':')
  if (!module) return null
  return `/api/${module}/todos`
}

export function createDictionarySelectLabels(
  kind: CustomerDictionaryKind,
  translate: (key: string, fallback: string) => string,
): DictionarySelectLabels {
  const base = {
    valueLabel: translate('customers.people.form.dictionary.valueLabel', 'Name'),
    valuePlaceholder: translate('customers.people.form.dictionary.valuePlaceholder', 'Name'),
    labelLabel: translate('customers.people.form.dictionary.labelLabel', 'Label'),
    labelPlaceholder: translate('customers.people.form.dictionary.labelPlaceholder', 'Display name shown in UI'),
    emptyError: translate('customers.people.form.dictionary.errorRequired', 'Please enter a name'),
    cancelLabel: translate('customers.people.form.dictionary.cancel', 'Cancel'),
    saveLabel: translate('customers.people.form.dictionary.save', 'Save'),
    saveShortcutHint: translate('customers.people.form.dictionary.saveShortcut', '⌘/Ctrl + Enter'),
    errorLoad: translate('customers.people.form.dictionary.errorLoad', 'Failed to load options'),
    errorSave: translate('customers.people.form.dictionary.error', 'Failed to save option'),
    loadingLabel: translate('customers.people.form.dictionary.loading', 'Loading…'),
    manageTitle: translate('customers.people.form.dictionary.manage', 'Manage dictionary'),
    placeholder: translate('customers.people.form.dictionary.placeholder', 'Select an option'),
    addLabel: translate('customers.people.form.dictionary.add', 'Add option'),
    addPrompt: translate('customers.people.form.dictionary.prompt', 'Name your option'),
    dialogTitle: translate('customers.people.form.dictionary.dialogTitle', 'Add option'),
  } satisfies DictionarySelectLabels

  switch (kind) {
    case 'statuses':
      return {
        ...base,
        placeholder: translate('customers.people.form.status.placeholder', 'Select a status'),
        addLabel: translate('customers.people.form.dictionary.addStatus', 'Add status'),
        addPrompt: translate('customers.people.form.dictionary.promptStatus', 'Name the status'),
        dialogTitle: translate('customers.people.form.dictionary.dialogTitleStatus', 'Add status'),
      }
    case 'lifecycle-stages':
      return {
        ...base,
        placeholder: translate('customers.people.form.lifecycleStage.placeholder', 'Select a lifecycle stage'),
        addLabel: translate('customers.people.form.dictionary.addLifecycleStage', 'Add lifecycle stage'),
        addPrompt: translate('customers.people.form.dictionary.promptLifecycleStage', 'Name the lifecycle stage'),
        dialogTitle: translate('customers.people.form.dictionary.dialogTitleLifecycleStage', 'Add lifecycle stage'),
      }
    case 'sources':
      return {
        ...base,
        placeholder: translate('customers.people.form.source.placeholder', 'Select a source'),
        addLabel: translate('customers.people.form.dictionary.addSource', 'Add source'),
        addPrompt: translate('customers.people.form.dictionary.promptSource', 'Name the source'),
        dialogTitle: translate('customers.people.form.dictionary.dialogTitleSource', 'Add source'),
      }
    case 'activity-types':
      return {
        ...base,
        placeholder: translate('customers.people.form.activityType.placeholder', 'Select an activity type'),
        addLabel: translate('customers.people.form.dictionary.addActivityType', 'Add activity type'),
        addPrompt: translate('customers.people.form.dictionary.promptActivityType', 'Name the activity type'),
        dialogTitle: translate('customers.people.form.dictionary.dialogTitleActivityType', 'Add activity type'),
      }
    case 'deal-statuses':
      return {
        ...base,
        placeholder: translate('customers.deals.form.status.placeholder', 'Select a deal status'),
        addLabel: translate('customers.deals.form.dictionary.addStatus', 'Add deal status'),
        addPrompt: translate('customers.deals.form.dictionary.promptStatus', 'Name the deal status'),
        dialogTitle: translate('customers.deals.form.dictionary.dialogTitleStatus', 'Add deal status'),
      }
    case 'pipeline-stages':
      return {
        ...base,
        placeholder: translate('customers.deals.form.pipeline.placeholder', 'Select a pipeline stage'),
        addLabel: translate('customers.deals.form.dictionary.addPipelineStage', 'Add pipeline stage'),
        addPrompt: translate('customers.deals.form.dictionary.promptPipelineStage', 'Name the pipeline stage'),
        dialogTitle: translate('customers.deals.form.dictionary.dialogTitlePipelineStage', 'Add pipeline stage'),
      }
    case 'job-titles':
      return {
        ...base,
        placeholder: translate('customers.people.form.jobTitle.placeholder', 'Select a job title'),
        addLabel: translate('customers.people.form.dictionary.addJobTitle', 'Add job title'),
        addPrompt: translate('customers.people.form.dictionary.promptJobTitle', 'Name the job title'),
        dialogTitle: translate('customers.people.form.dictionary.dialogTitleJobTitle', 'Add job title'),
      }
    case 'address-types':
      return {
        ...base,
        placeholder: translate('customers.people.form.addressType.placeholder', 'Select an address type'),
        addLabel: translate('customers.people.form.dictionary.addAddressType', 'Add address type'),
        addPrompt: translate('customers.people.form.dictionary.promptAddressType', 'Name the address type'),
        dialogTitle: translate('customers.people.form.dictionary.dialogTitleAddressType', 'Add address type'),
      }
    default:
      return base
  }
}
