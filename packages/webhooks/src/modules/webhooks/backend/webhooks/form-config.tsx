"use client"

import type { CrudField, CrudFieldOption, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type TranslateFn = (key: string, fallback?: string, vars?: Record<string, unknown>) => string

export type WebhookFormValues = {
  name: string
  description?: string | null
  url: string
  subscribedEvents: string[]
  httpMethod: 'POST' | 'PUT' | 'PATCH'
  maxRetries: number
  timeoutMs: number
  rateLimitPerMinute: number
  autoDisableThreshold: number
  customHeadersText: string
}

export type WebhookFormPayload = {
  name: string
  description: string | null
  url: string
  subscribedEvents: string[]
  httpMethod: 'POST' | 'PUT' | 'PATCH'
  maxRetries: number
  timeoutMs: number
  rateLimitPerMinute: number
  autoDisableThreshold: number
  customHeaders: Record<string, string> | null
}

export async function loadWebhookEventOptions(query?: string): Promise<CrudFieldOption[]> {
  const result = await apiCall<{ data: Array<{ id: string; label: string }> }>(
    '/api/webhooks/events',
    undefined,
    { fallback: { data: [] } },
  )

  if (!result.ok || !Array.isArray(result.result?.data)) {
    return []
  }

  const normalizedQuery = query?.trim().toLowerCase() ?? ''
  return result.result.data
    .filter((event) => {
      if (!normalizedQuery) return true
      return event.id.toLowerCase().includes(normalizedQuery) || event.label.toLowerCase().includes(normalizedQuery)
    })
    .map((event) => ({ value: event.id, label: event.label }))
}

export function buildWebhookFormFields(t: TranslateFn): CrudField[] {
  return [
    {
      id: 'name',
      type: 'text',
      label: t('webhooks.form.name'),
      placeholder: t('webhooks.form.namePlaceholder'),
      required: true,
    },
    {
      id: 'description',
      type: 'textarea',
      label: t('webhooks.form.description'),
      placeholder: t('webhooks.form.descriptionPlaceholder'),
    },
    {
      id: 'url',
      type: 'text',
      label: t('webhooks.form.url'),
      placeholder: t('webhooks.form.urlPlaceholder'),
      description: t('webhooks.form.urlHint'),
      required: true,
    },
    {
      id: 'subscribedEvents',
      type: 'tags',
      label: t('webhooks.form.events'),
      placeholder: t('webhooks.form.eventsPlaceholder'),
      description: t('webhooks.form.eventsHint'),
      loadOptions: loadWebhookEventOptions,
      required: true,
    },
    {
      id: 'httpMethod',
      type: 'select',
      label: t('webhooks.form.httpMethod'),
      options: [
        { value: 'POST', label: 'POST' },
        { value: 'PUT', label: 'PUT' },
        { value: 'PATCH', label: 'PATCH' },
      ],
    },
    {
      id: 'maxRetries',
      type: 'number',
      label: t('webhooks.form.maxRetries'),
      description: t('webhooks.form.maxRetriesHint'),
    },
    {
      id: 'timeoutMs',
      type: 'number',
      label: t('webhooks.form.timeoutMs'),
      description: t('webhooks.form.timeoutMsHint'),
    },
    {
      id: 'rateLimitPerMinute',
      type: 'number',
      label: t('webhooks.form.rateLimitPerMinute'),
      description: t('webhooks.form.rateLimitPerMinuteHint'),
    },
    {
      id: 'autoDisableThreshold',
      type: 'number',
      label: t('webhooks.form.autoDisableThreshold'),
      description: t('webhooks.form.autoDisableThresholdHint'),
    },
    {
      id: 'customHeadersText',
      type: 'textarea',
      label: t('webhooks.form.customHeaders'),
      placeholder: '{\n  "X-Webhook-Source": "open-mercato"\n}',
      description: t('webhooks.form.customHeadersHint'),
    },
  ]
}

export function buildWebhookFormGroups(t: TranslateFn): CrudFormGroup[] {
  return [
    { id: 'general', title: t('webhooks.form.group.general'), column: 1, fields: ['name', 'description', 'url', 'httpMethod'] },
    { id: 'events', title: t('webhooks.form.group.events'), column: 1, fields: ['subscribedEvents'] },
    { id: 'delivery', title: t('webhooks.form.group.delivery'), column: 2, fields: ['maxRetries', 'timeoutMs', 'rateLimitPerMinute', 'autoDisableThreshold'] },
    { id: 'advanced', title: t('webhooks.form.group.advanced'), column: 2, fields: ['customHeadersText'] },
  ]
}

export function createWebhookInitialValues(webhook?: Partial<WebhookFormValues> & { customHeaders?: Record<string, string> | null }): WebhookFormValues {
  return {
    name: webhook?.name ?? '',
    description: webhook?.description ?? '',
    url: webhook?.url ?? '',
    subscribedEvents: Array.isArray(webhook?.subscribedEvents) ? webhook.subscribedEvents : [],
    httpMethod: webhook?.httpMethod ?? 'POST',
    maxRetries: typeof webhook?.maxRetries === 'number' ? webhook.maxRetries : 10,
    timeoutMs: typeof webhook?.timeoutMs === 'number' ? webhook.timeoutMs : 15000,
    rateLimitPerMinute: typeof webhook?.rateLimitPerMinute === 'number' ? webhook.rateLimitPerMinute : 0,
    autoDisableThreshold: typeof webhook?.autoDisableThreshold === 'number' ? webhook.autoDisableThreshold : 100,
    customHeadersText: webhook?.customHeaders ? JSON.stringify(webhook.customHeaders, null, 2) : '',
  }
}

export function normalizeWebhookFormPayload(values: WebhookFormValues, t: TranslateFn): WebhookFormPayload {
  const customHeadersText = typeof values.customHeadersText === 'string' ? values.customHeadersText.trim() : ''

  let customHeaders: Record<string, string> | null = null
  if (customHeadersText) {
    try {
      const parsed = JSON.parse(customHeadersText) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('invalid-shape')
      }

      const entries = Object.entries(parsed)
      const invalidEntry = entries.find(([, value]) => typeof value !== 'string')
      if (invalidEntry) {
        throw new Error('invalid-value')
      }

      customHeaders = Object.fromEntries(entries)
    } catch {
      const message = t('webhooks.form.customHeadersInvalid')
      throw createCrudFormError(message, { customHeadersText: message })
    }
  }

  if (!Array.isArray(values.subscribedEvents) || values.subscribedEvents.length === 0) {
    const message = t('webhooks.form.eventsRequired')
    throw createCrudFormError(message, { subscribedEvents: message })
  }

  return {
    name: values.name,
    description: values.description?.trim() ? values.description : null,
    url: values.url,
    subscribedEvents: values.subscribedEvents,
    httpMethod: values.httpMethod,
    maxRetries: Number(values.maxRetries),
    timeoutMs: Number(values.timeoutMs),
    rateLimitPerMinute: Number(values.rateLimitPerMinute),
    autoDisableThreshold: Number(values.autoDisableThreshold),
    customHeaders,
  }
}
