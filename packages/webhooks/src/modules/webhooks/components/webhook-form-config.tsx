"use client"

import type { CrudCustomFieldRenderProps, CrudField, CrudFieldOption, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { JsonBuilder } from '@open-mercato/ui/backend/JsonBuilder'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'

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
  customHeaders: Record<string, string> | null
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
  const result = await apiCall<{ data: Array<{ id: string; label: string; module?: string; category?: string; description?: string }> }>(
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
      id: 'customHeaders',
      type: 'custom',
      label: t('webhooks.form.customHeaders'),
      description: t('webhooks.form.customHeadersHint'),
      component: WebhookCustomHeadersField,
    },
  ]
}

export function buildWebhookFormGroups(t: TranslateFn): CrudFormGroup[] {
  return [
    { id: 'general', title: t('webhooks.form.group.general'), column: 1, fields: ['name', 'description', 'url', 'httpMethod'] },
    {
      id: 'events',
      title: t('webhooks.form.group.events'),
      column: 1,
      component: () => <Notice compact>{t('webhooks.form.eventsPatternTip')}</Notice>,
      fields: ['subscribedEvents'],
    },
    {
      id: 'delivery',
      title: t('webhooks.form.group.delivery'),
      column: 2,
      component: () => <Notice compact>{t('webhooks.form.deliveryDefaultsTip')}</Notice>,
      fields: ['maxRetries', 'timeoutMs', 'rateLimitPerMinute', 'autoDisableThreshold'],
    },
    {
      id: 'advanced',
      title: t('webhooks.form.group.advanced'),
      column: 2,
      component: () => <Notice compact>{t('webhooks.form.advancedStrategyTip')}</Notice>,
      fields: ['customHeaders'],
    },
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
    customHeaders: webhook?.customHeaders ?? null,
  }
}

export function normalizeWebhookFormPayload(values: WebhookFormValues, t: TranslateFn): WebhookFormPayload {
  let customHeaders: Record<string, string> | null = null
  if (values.customHeaders != null) {
    if (!isRecord(values.customHeaders)) {
      const message = t('webhooks.form.customHeadersInvalid')
      throw createCrudFormError(message, { customHeaders: message })
    }

    const entries = Object.entries(values.customHeaders)
      .filter(([, value]) => value != null && String(value).trim().length > 0)
      .map(([key, value]) => [key.trim(), value] as const)
      .filter(([key]) => key.length > 0)

    const invalidEntry = entries.find(([, value]) => typeof value !== 'string')
    if (invalidEntry) {
      const message = t('webhooks.form.customHeadersInvalid')
      throw createCrudFormError(message, { customHeaders: message })
    }

    customHeaders = entries.length > 0 ? Object.fromEntries(entries) : null
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

export function buildWebhookFormContentHeader(t: TranslateFn) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Notice title={t('webhooks.form.guidanceTitle')} message={t('webhooks.form.guidanceBody')} />
      <Notice variant="warning" title={t('webhooks.form.guidanceSecurityTitle')} message={t('webhooks.form.guidanceSecurityBody')} />
    </div>
  )
}

function WebhookCustomHeadersField(props: CrudCustomFieldRenderProps) {
  const t = useT()
  const value = isRecord(props.value) ? props.value : {}

  return (
    <div className="space-y-3">
      <Notice compact>{t('webhooks.form.customHeadersTip')}</Notice>
      <JsonBuilder
        value={value}
        onChange={(nextValue) => {
          if (!isRecord(nextValue)) {
            props.setValue({})
            return
          }
          props.setValue(
            Object.fromEntries(
              Object.entries(nextValue).map(([key, value]) => [key, typeof value === 'string' ? value : String(value ?? '')]),
            ),
          )
        }}
        disabled={props.disabled}
        error={props.error}
      />
    </div>
  )
}

function isRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
