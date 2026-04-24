"use client"

import type { DictionarySelectLabels } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import type { CustomerDictionaryKind } from '../../lib/dictionaries'
import { CUSTOMER_INTERACTION_TASK_SOURCE, CUSTOMER_INTERACTION_TASK_TYPE } from '../../lib/interactionCompatibility'


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
  if (source === CUSTOMER_INTERACTION_TASK_SOURCE || source === CUSTOMER_INTERACTION_TASK_TYPE) return null
  const [module] = source.split(':')
  if (!module) return null
  if (module === 'example') {
    return `/backend/todos/${encodeURIComponent(todoId)}/edit`
  }
  return `/backend/${module}/todos/${encodeURIComponent(todoId)}/edit`
}

export function resolveTodoApiPath(source: string): string | null {
  if (!source) return null
  if (source === CUSTOMER_INTERACTION_TASK_SOURCE || source === CUSTOMER_INTERACTION_TASK_TYPE) {
    return '/api/customers/todos'
  }
  const [module] = source.split(':')
  if (!module) return null
  return `/api/${module}/todos`
}

export function createDictionarySelectLabels(
  kind: CustomerDictionaryKind,
  translate: (key: string, fallback: string) => string,
): DictionarySelectLabels {
  const base = {
    valueLabel: translate('customers.person.form.dictionary.valueLabel', 'Name'),
    valuePlaceholder: translate('customers.person.form.dictionary.valuePlaceholder', 'Name'),
    labelLabel: translate('customers.person.form.dictionary.labelLabel', 'Label'),
    labelPlaceholder: translate('customers.person.form.dictionary.labelPlaceholder', 'Display name shown in UI'),
    emptyError: translate('customers.person.form.dictionary.errorRequired', 'Please enter a name'),
    cancelLabel: translate('customers.person.form.dictionary.cancel', 'Cancel'),
    saveLabel: translate('customers.person.form.dictionary.save', 'Save'),
    saveShortcutHint: translate('customers.person.form.dictionary.saveShortcut', '⌘/Ctrl + Enter'),
    errorLoad: translate('customers.person.form.dictionary.errorLoad', 'Failed to load options'),
    errorSave: translate('customers.person.form.dictionary.error', 'Failed to save option'),
    loadingLabel: translate('customers.person.form.dictionary.loading', 'Loading…'),
    manageTitle: translate('customers.person.form.dictionary.manage', 'Manage dictionary'),
    placeholder: translate('customers.person.form.dictionary.placeholder', 'Select an option'),
    addLabel: translate('customers.person.form.dictionary.add', 'Add option'),
    addPrompt: translate('customers.person.form.dictionary.prompt', 'Name your option'),
    dialogTitle: translate('customers.person.form.dictionary.dialogTitle', 'Add option'),
  } satisfies DictionarySelectLabels

  switch (kind) {
    case 'statuses':
      return {
        ...base,
        placeholder: translate('customers.person.form.status.placeholder', 'Select a status'),
        addLabel: translate('customers.person.form.dictionary.addStatus', 'Add status'),
        addPrompt: translate('customers.person.form.dictionary.promptStatus', 'Name the status'),
        dialogTitle: translate('customers.person.form.dictionary.dialogTitleStatus', 'Add status'),
      }
    case 'lifecycle-stages':
      return {
        ...base,
        placeholder: translate('customers.person.form.lifecycleStage.placeholder', 'Select a lifecycle stage'),
        addLabel: translate('customers.person.form.dictionary.addLifecycleStage', 'Add lifecycle stage'),
        addPrompt: translate('customers.person.form.dictionary.promptLifecycleStage', 'Name the lifecycle stage'),
        dialogTitle: translate('customers.person.form.dictionary.dialogTitleLifecycleStage', 'Add lifecycle stage'),
      }
    case 'sources':
      return {
        ...base,
        placeholder: translate('customers.person.form.source.placeholder', 'Select a source'),
        addLabel: translate('customers.person.form.dictionary.addSource', 'Add source'),
        addPrompt: translate('customers.person.form.dictionary.promptSource', 'Name the source'),
        dialogTitle: translate('customers.person.form.dictionary.dialogTitleSource', 'Add source'),
      }
    case 'activity-types':
      return {
        ...base,
        placeholder: translate('customers.person.form.activityType.placeholder', 'Select an activity type'),
        addLabel: translate('customers.person.form.dictionary.addActivityType', 'Add activity type'),
        addPrompt: translate('customers.person.form.dictionary.promptActivityType', 'Name the activity type'),
        dialogTitle: translate('customers.person.form.dictionary.dialogTitleActivityType', 'Add activity type'),
      }
    case 'deal-statuses':
      return {
        ...base,
        placeholder: translate('customers.deal.form.status.placeholder', 'Select a deal status'),
        addLabel: translate('customers.deal.form.dictionary.addStatus', 'Add deal status'),
        addPrompt: translate('customers.deal.form.dictionary.promptStatus', 'Name the deal status'),
        dialogTitle: translate('customers.deal.form.dictionary.dialogTitleStatus', 'Add deal status'),
      }
    case 'pipeline-stages':
      return {
        ...base,
        placeholder: translate('customers.deal.form.pipeline.placeholder', 'Select a pipeline stage'),
        addLabel: translate('customers.deal.form.dictionary.addPipelineStage', 'Add pipeline stage'),
        addPrompt: translate('customers.deal.form.dictionary.promptPipelineStage', 'Name the pipeline stage'),
        dialogTitle: translate('customers.deal.form.dictionary.dialogTitlePipelineStage', 'Add pipeline stage'),
      }
    case 'job-titles':
      return {
        ...base,
        placeholder: translate('customers.person.form.jobTitle.placeholder', 'Select a job title'),
        addLabel: translate('customers.person.form.dictionary.addJobTitle', 'Add job title'),
        addPrompt: translate('customers.person.form.dictionary.promptJobTitle', 'Name the job title'),
        dialogTitle: translate('customers.person.form.dictionary.dialogTitleJobTitle', 'Add job title'),
      }
    case 'address-types':
      return {
        ...base,
        placeholder: translate('customers.person.form.addressType.placeholder', 'Select an address type'),
        addLabel: translate('customers.person.form.dictionary.addAddressType', 'Add address type'),
        addPrompt: translate('customers.person.form.dictionary.promptAddressType', 'Name the address type'),
        dialogTitle: translate('customers.person.form.dictionary.dialogTitleAddressType', 'Add address type'),
      }
    default:
      return base
  }
}

export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length === 0 || !words[0]) return '?'
  if (words.length === 1) return words[0].charAt(0).toUpperCase()
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase()
}

export function formatCurrency(amount: number, currency?: string | null): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'PLN',
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${amount.toLocaleString()} ${currency || 'PLN'}`
  }
}

export function formatFallbackLabel(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
}
