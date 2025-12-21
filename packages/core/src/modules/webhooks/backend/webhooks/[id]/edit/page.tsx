"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Switch } from '@open-mercato/ui/primitives/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'
import { EventsMultiSelect } from '@open-mercato/core/modules/webhooks/components/EventsMultiSelect'
import {
  WebhookConfigFields,
  type WebhookDeliveryType,
  type WebhookConfig,
} from '@open-mercato/core/modules/webhooks/components/WebhookConfigFields'

type WebhookData = {
  id: string
  name: string
  description: string | null
  deliveryType: WebhookDeliveryType
  config: WebhookConfig
  events: string[]
  active: boolean
  timeout: number
  retryConfig: {
    maxRetries: number
    retryBackoff: 'linear' | 'exponential'
    retryDelay: number
  }
  createdAt: string
  updatedAt: string
  lastTriggeredAt: string | null
}

type FormState = {
  name: string
  description: string
  deliveryType: WebhookDeliveryType
  config: Partial<WebhookConfig>
  events: string[]
  active: boolean
  timeout: number
  retryConfig: {
    maxRetries: number
    retryBackoff: 'linear' | 'exponential'
    retryDelay: number
  }
}

const deliveryTypeOptions: Array<{
  value: WebhookDeliveryType
  label: string
  description: string
  icon: React.ReactNode
}> = [
  {
    value: 'http',
    label: 'HTTP/HTTPS',
    description: 'Send webhook payloads to any HTTP endpoint',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
  {
    value: 'sqs',
    label: 'AWS SQS',
    description: 'Send messages to an Amazon SQS queue',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 9h6M9 12h6M9 15h4" />
      </svg>
    ),
  },
  {
    value: 'sns',
    label: 'AWS SNS',
    description: 'Publish messages to an Amazon SNS topic',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    ),
  },
]

export default function EditWebhookPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const router = useRouter()
  const t = useT()
  const [form, setForm] = React.useState<FormState | null>(null)
  const [originalData, setOriginalData] = React.useState<WebhookData | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [showAdvanced, setShowAdvanced] = React.useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false)

  // Load webhook data
  React.useEffect(() => {
    if (!id) return
    const webhookId = id // Capture for TypeScript narrowing
    let cancelled = false

    async function load() {
      setIsLoading(true)
      try {
        const { ok, result } = await apiCall<{ items?: WebhookData[] }>(
          `/api/webhooks?id=${encodeURIComponent(webhookId)}`,
        )

        if (!ok || cancelled) {
          if (!cancelled) flash(t('webhooks.form.errors.loadFailed'), 'error')
          return
        }

        const webhook = result?.items?.[0]
        if (!webhook) {
          if (!cancelled) flash(t('webhooks.form.errors.notFound'), 'error')
          router.push('/backend/webhooks')
          return
        }

        if (!cancelled) {
          setOriginalData(webhook)
          setForm({
            name: webhook.name,
            description: webhook.description || '',
            deliveryType: webhook.deliveryType,
            config: webhook.config,
            events: webhook.events,
            active: webhook.active,
            timeout: webhook.timeout,
            retryConfig: webhook.retryConfig,
          })
        }
      } catch (error) {
        if (!cancelled) {
          flash(t('webhooks.form.errors.loadFailed'), 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [id, t, router])

  const updateForm = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => prev ? { ...prev, [key]: value } : null)
    setErrors((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const handleDeliveryTypeChange = (type: WebhookDeliveryType) => {
    if (!form) return
    const defaultConfigs: Record<WebhookDeliveryType, Partial<WebhookConfig>> = {
      http: { url: '', method: 'POST', headers: {} },
      sqs: { queueUrl: '', region: '' },
      sns: { topicArn: '', region: '' },
    }
    setForm({
      ...form,
      deliveryType: type,
      config: type === originalData?.deliveryType ? originalData.config : defaultConfigs[type],
    })
  }

  const validate = (): boolean => {
    if (!form) return false
    const newErrors: Record<string, string> = {}

    if (!form.name.trim()) {
      newErrors.name = t('webhooks.form.errors.nameRequired')
    }

    if (form.events.length === 0) {
      newErrors.events = t('webhooks.form.errors.eventsRequired')
    }

    if (form.deliveryType === 'http') {
      const config = form.config as { url?: string }
      if (!config.url?.trim()) {
        newErrors['config.url'] = t('webhooks.form.errors.urlRequired')
      } else {
        try {
          new URL(config.url)
        } catch {
          newErrors['config.url'] = t('webhooks.form.errors.urlInvalid')
        }
      }
    } else if (form.deliveryType === 'sqs') {
      const config = form.config as { queueUrl?: string; region?: string }
      if (!config.queueUrl?.trim()) {
        newErrors['config.queueUrl'] = t('webhooks.form.errors.queueUrlRequired')
      }
      if (!config.region?.trim()) {
        newErrors['config.region'] = t('webhooks.form.errors.regionRequired')
      }
    } else if (form.deliveryType === 'sns') {
      const config = form.config as { topicArn?: string; region?: string }
      if (!config.topicArn?.trim()) {
        newErrors['config.topicArn'] = t('webhooks.form.errors.topicArnRequired')
      }
      if (!config.region?.trim()) {
        newErrors['config.region'] = t('webhooks.form.errors.regionRequired')
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form || !id) return
    if (!validate()) return

    setIsSubmitting(true)
    try {
      const payload = {
        id,
        name: form.name.trim(),
        description: form.description.trim() || null,
        deliveryType: form.deliveryType,
        config: form.config,
        events: form.events,
        active: form.active,
        timeout: form.timeout,
        retryConfig: form.retryConfig,
      }

      const { ok, result } = await apiCall<{ ok?: boolean; error?: string }>(
        '/api/webhooks',
        { method: 'PUT', body: JSON.stringify(payload) },
      )

      if (!ok) {
        const message = result?.error || t('webhooks.form.errors.updateFailed')
        flash(message, 'error')
        return
      }

      flash(t('webhooks.form.success.updated'), 'success')
      router.push('/backend/webhooks')
    } catch (error) {
      const message = error instanceof Error ? error.message : t('webhooks.form.errors.updateFailed')
      flash(message, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!id) return

    setIsDeleting(true)
    try {
      const { ok, result } = await apiCall<{ ok?: boolean; error?: string }>(
        `/api/webhooks?id=${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      )

      if (!ok) {
        const message = result?.error || t('webhooks.form.errors.deleteFailed')
        flash(message, 'error')
        return
      }

      flash(t('webhooks.form.success.deleted'), 'success')
      router.push('/backend/webhooks')
    } catch (error) {
      const message = error instanceof Error ? error.message : t('webhooks.form.errors.deleteFailed')
      flash(message, 'error')
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  // Loading state
  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="flex flex-col items-center gap-4">
              <svg className="animate-spin h-8 w-8 text-muted-foreground" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <p className="text-muted-foreground">{t('webhooks.form.loading')}</p>
            </div>
          </div>
        </PageBody>
      </Page>
    )
  }

  if (!form) {
    return (
      <Page>
        <PageBody>
          <div className="flex items-center justify-center min-h-[60vh]">
            <p className="text-muted-foreground">{t('webhooks.form.errors.notFound')}</p>
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-semibold">{t('webhooks.form.title.edit')}</h1>
              <p className="text-muted-foreground mt-1">
                {t('webhooks.form.editSubtitle')}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push('/backend/webhooks')}
            >
              {t('common.cancel')}
            </Button>
          </div>

          <div className="space-y-8">
            {/* Basic Info Section */}
            <section className="rounded-xl border bg-card overflow-hidden">
              <div className="px-6 py-4 border-b bg-muted/30">
                <h2 className="font-semibold">{t('webhooks.form.sections.basicInfo')}</h2>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-sm font-medium mb-1.5">
                      {t('webhooks.form.fields.name')} <span className="text-destructive">*</span>
                    </label>
                    <Input
                      value={form.name}
                      onChange={(e) => updateForm('name', e.target.value)}
                      placeholder={t('webhooks.form.placeholders.name')}
                      className={errors.name ? 'border-destructive' : ''}
                    />
                    {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
                  </div>
                  <div className="col-span-2 sm:col-span-1 flex items-center gap-3 pt-6">
                    <Switch
                      checked={form.active}
                      onCheckedChange={(checked) => updateForm('active', checked)}
                    />
                    <label className="text-sm font-medium">
                      {t('webhooks.form.fields.active')}
                    </label>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    {t('webhooks.form.fields.description')}
                  </label>
                  <Textarea
                    value={form.description}
                    onChange={(e) => updateForm('description', e.target.value)}
                    placeholder={t('webhooks.form.placeholders.description')}
                    rows={2}
                  />
                </div>
              </div>
            </section>

            {/* Delivery Type Section */}
            <section className="rounded-xl border bg-card overflow-hidden">
              <div className="px-6 py-4 border-b bg-muted/30">
                <h2 className="font-semibold">{t('webhooks.form.sections.deliveryType')}</h2>
              </div>
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {deliveryTypeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleDeliveryTypeChange(option.value)}
                      className={`
                        relative flex flex-col items-start gap-2 p-4 rounded-lg border-2 text-left transition-all
                        ${form.deliveryType === option.value
                          ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                          : 'border-border hover:border-muted-foreground/50 hover:bg-muted/30'
                        }
                      `}
                    >
                      <div className={`
                        p-2 rounded-md
                        ${form.deliveryType === option.value
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                        }
                      `}>
                        {option.icon}
                      </div>
                      <div>
                        <div className="font-medium text-sm">{option.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{option.description}</div>
                      </div>
                      {form.deliveryType === option.value && (
                        <div className="absolute top-2 right-2">
                          <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                            <path d="M22 4L12 14.01l-3-3" />
                          </svg>
                        </div>
                      )}
                    </button>
                  ))}
                </div>

                <div className="pt-2">
                  <WebhookConfigFields
                    deliveryType={form.deliveryType}
                    config={form.config}
                    onChange={(config) => updateForm('config', config)}
                    errors={{
                      url: errors['config.url'],
                      queueUrl: errors['config.queueUrl'],
                      topicArn: errors['config.topicArn'],
                      region: errors['config.region'],
                    }}
                  />
                </div>
              </div>
            </section>

            {/* Events Section */}
            <section className="rounded-xl border bg-card overflow-hidden">
              <div className="px-6 py-4 border-b bg-muted/30">
                <h2 className="font-semibold">{t('webhooks.form.sections.events')}</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {t('webhooks.form.sections.eventsDescription')}
                </p>
              </div>
              <div className="p-6">
                <EventsMultiSelect
                  value={form.events}
                  onChange={(events) => updateForm('events', events)}
                />
                {errors.events && (
                  <p className="text-xs text-destructive mt-2">{errors.events}</p>
                )}
              </div>
            </section>

            {/* Advanced Settings */}
            <section className="rounded-xl border bg-card overflow-hidden">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">{t('webhooks.form.sections.advanced')}</h2>
                  <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-muted">
                    {t('webhooks.form.sections.optional')}
                  </span>
                </div>
                <svg
                  className={`w-5 h-5 text-muted-foreground transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {showAdvanced && (
                <div className="px-6 pb-6 space-y-4 border-t pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1.5">
                        {t('webhooks.form.fields.timeout')}
                      </label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={form.timeout}
                          onChange={(e) => updateForm('timeout', parseInt(e.target.value, 10) || 10000)}
                          min={1000}
                          max={60000}
                          step={1000}
                          className="w-32"
                        />
                        <span className="text-sm text-muted-foreground">ms</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('webhooks.form.hints.timeout')}
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5">
                        {t('webhooks.form.fields.maxRetries')}
                      </label>
                      <Input
                        type="number"
                        value={form.retryConfig.maxRetries}
                        onChange={(e) =>
                          updateForm('retryConfig', {
                            ...form.retryConfig,
                            maxRetries: parseInt(e.target.value, 10) || 0,
                          })
                        }
                        min={0}
                        max={10}
                        className="w-32"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('webhooks.form.hints.maxRetries')}
                      </p>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">
                      {t('webhooks.form.fields.retryBackoff')}
                    </label>
                    <div className="flex gap-2">
                      {(['exponential', 'linear'] as const).map((backoff) => (
                        <button
                          key={backoff}
                          type="button"
                          onClick={() =>
                            updateForm('retryConfig', { ...form.retryConfig, retryBackoff: backoff })
                          }
                          className={`
                            px-4 py-2 rounded-md text-sm font-medium transition-all
                            ${form.retryConfig.retryBackoff === backoff
                              ? 'bg-primary text-primary-foreground shadow-sm'
                              : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                            }
                          `}
                        >
                          {backoff.charAt(0).toUpperCase() + backoff.slice(1)}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {form.retryConfig.retryBackoff === 'exponential'
                        ? t('webhooks.form.hints.exponentialBackoff')
                        : t('webhooks.form.hints.linearBackoff')}
                    </p>
                  </div>
                </div>
              )}
            </section>

            {/* Danger Zone */}
            <section className="rounded-xl border border-destructive/30 bg-destructive/5 overflow-hidden">
              <div className="px-6 py-4 border-b border-destructive/30 bg-destructive/10">
                <h2 className="font-semibold text-destructive">{t('webhooks.form.sections.dangerZone')}</h2>
              </div>
              <div className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">{t('webhooks.form.delete.title')}</h3>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {t('webhooks.form.delete.description')}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={isDeleting}
                  >
                    {t('webhooks.form.delete.button')}
                  </Button>
                </div>
              </div>
            </section>

            {/* Submit */}
            <div className="flex items-center justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/backend/webhooks')}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {t('common.saving')}
                  </>
                ) : (
                  t('webhooks.form.actions.save')
                )}
              </Button>
            </div>
          </div>
        </form>

        {/* Delete Confirmation Dialog */}
        <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-destructive/10">
                  <svg className="w-6 h-6 text-destructive" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <div>
                  <DialogTitle>{t('webhooks.form.delete.confirmTitle')}</DialogTitle>
                  <DialogDescription className="mt-1">
                    {t('webhooks.form.delete.confirmDescription').replace('{name}', form.name)}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {t('common.deleting')}
                  </>
                ) : (
                  t('webhooks.form.delete.confirm')
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageBody>
    </Page>
  )
}
