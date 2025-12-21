"use client"
import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'

// AWS Regions for SQS/SNS
const AWS_REGIONS = [
  { value: 'us-east-1', label: 'US East (N. Virginia)' },
  { value: 'us-east-2', label: 'US East (Ohio)' },
  { value: 'us-west-1', label: 'US West (N. California)' },
  { value: 'us-west-2', label: 'US West (Oregon)' },
  { value: 'eu-west-1', label: 'EU (Ireland)' },
  { value: 'eu-west-2', label: 'EU (London)' },
  { value: 'eu-west-3', label: 'EU (Paris)' },
  { value: 'eu-central-1', label: 'EU (Frankfurt)' },
  { value: 'eu-north-1', label: 'EU (Stockholm)' },
  { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
  { value: 'ap-northeast-2', label: 'Asia Pacific (Seoul)' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
  { value: 'ap-southeast-2', label: 'Asia Pacific (Sydney)' },
  { value: 'ap-south-1', label: 'Asia Pacific (Mumbai)' },
  { value: 'sa-east-1', label: 'South America (São Paulo)' },
  { value: 'ca-central-1', label: 'Canada (Central)' },
]

export type WebhookDeliveryType = 'http' | 'sqs' | 'sns'

export interface HttpConfig {
  url: string
  method: 'POST' | 'PUT'
  headers?: Record<string, string>
}

export interface SqsConfig {
  queueUrl: string
  region: string
  accessKeyId?: string
  secretAccessKey?: string
  messageGroupId?: string
}

export interface SnsConfig {
  topicArn: string
  region: string
  accessKeyId?: string
  secretAccessKey?: string
}

export type WebhookConfig = HttpConfig | SqsConfig | SnsConfig

interface WebhookConfigFieldsProps {
  deliveryType: WebhookDeliveryType
  config: Partial<WebhookConfig>
  onChange: (config: Partial<WebhookConfig>) => void
  disabled?: boolean
  errors?: Record<string, string>
}

export function WebhookConfigFields({
  deliveryType,
  config,
  onChange,
  disabled,
  errors = {},
}: WebhookConfigFieldsProps) {
  const updateConfig = (key: string, value: unknown) => {
    onChange({ ...config, [key]: value })
  }

  if (deliveryType === 'http') {
    const httpConfig = config as Partial<HttpConfig>
    return (
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">
            Endpoint URL <span className="text-destructive">*</span>
          </label>
          <Input
            type="url"
            placeholder="https://api.example.com/webhooks"
            value={httpConfig.url || ''}
            onChange={(e) => updateConfig('url', e.target.value)}
            disabled={disabled}
            className={errors.url ? 'border-destructive' : ''}
          />
          {errors.url && <p className="text-xs text-destructive mt-1">{errors.url}</p>}
          <p className="text-xs text-muted-foreground mt-1">
            The URL that will receive webhook payloads. Must be HTTPS for production use.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">HTTP Method</label>
          <div className="flex gap-2">
            {(['POST', 'PUT'] as const).map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => updateConfig('method', method)}
                disabled={disabled}
                className={`
                  px-4 py-2 rounded-md text-sm font-medium transition-all
                  ${(httpConfig.method || 'POST') === method
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                  }
                  ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                {method}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">Custom Headers</label>
          <HeadersEditor
            value={httpConfig.headers || {}}
            onChange={(headers) => updateConfig('headers', headers)}
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Additional headers to include with each webhook request.
          </p>
        </div>
      </div>
    )
  }

  if (deliveryType === 'sqs') {
    const sqsConfig = config as Partial<SqsConfig>
    return (
      <div className="space-y-4">
        <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            <div className="text-sm text-amber-800 dark:text-amber-200">
              <strong>AWS SQS</strong> — Messages will be sent to your Amazon SQS queue.
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">
            Queue URL <span className="text-destructive">*</span>
          </label>
          <Input
            type="url"
            placeholder="https://sqs.us-east-1.amazonaws.com/123456789012/my-queue"
            value={sqsConfig.queueUrl || ''}
            onChange={(e) => updateConfig('queueUrl', e.target.value)}
            disabled={disabled}
            className={errors.queueUrl ? 'border-destructive' : ''}
          />
          {errors.queueUrl && <p className="text-xs text-destructive mt-1">{errors.queueUrl}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">
            AWS Region <span className="text-destructive">*</span>
          </label>
          <select
            value={sqsConfig.region || ''}
            onChange={(e) => updateConfig('region', e.target.value)}
            disabled={disabled}
            className={`
              w-full h-9 rounded-md border bg-background px-3 text-sm
              focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
              ${errors.region ? 'border-destructive' : 'border-input'}
              ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            `}
          >
            <option value="">Select a region...</option>
            {AWS_REGIONS.map((region) => (
              <option key={region.value} value={region.value}>
                {region.label} ({region.value})
              </option>
            ))}
          </select>
          {errors.region && <p className="text-xs text-destructive mt-1">{errors.region}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Access Key ID</label>
            <Input
              type="text"
              placeholder="AKIA..."
              value={sqsConfig.accessKeyId || ''}
              onChange={(e) => updateConfig('accessKeyId', e.target.value)}
              disabled={disabled}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Secret Access Key</label>
            <Input
              type="password"
              placeholder="••••••••"
              value={sqsConfig.secretAccessKey || ''}
              onChange={(e) => updateConfig('secretAccessKey', e.target.value)}
              disabled={disabled}
              autoComplete="off"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          Optional. Leave blank to use IAM role-based authentication.
        </p>

        <div>
          <label className="block text-sm font-medium mb-1.5">Message Group ID</label>
          <Input
            type="text"
            placeholder="webhooks"
            value={sqsConfig.messageGroupId || ''}
            onChange={(e) => updateConfig('messageGroupId', e.target.value)}
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Required for FIFO queues. Optional for standard queues.
          </p>
        </div>
      </div>
    )
  }

  if (deliveryType === 'sns') {
    const snsConfig = config as Partial<SnsConfig>
    return (
      <div className="space-y-4">
        <div className="p-3 rounded-md bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-purple-600 dark:text-purple-400 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            <div className="text-sm text-purple-800 dark:text-purple-200">
              <strong>AWS SNS</strong> — Messages will be published to your Amazon SNS topic.
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">
            Topic ARN <span className="text-destructive">*</span>
          </label>
          <Input
            type="text"
            placeholder="arn:aws:sns:us-east-1:123456789012:my-topic"
            value={snsConfig.topicArn || ''}
            onChange={(e) => updateConfig('topicArn', e.target.value)}
            disabled={disabled}
            className={errors.topicArn ? 'border-destructive' : ''}
          />
          {errors.topicArn && <p className="text-xs text-destructive mt-1">{errors.topicArn}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">
            AWS Region <span className="text-destructive">*</span>
          </label>
          <select
            value={snsConfig.region || ''}
            onChange={(e) => updateConfig('region', e.target.value)}
            disabled={disabled}
            className={`
              w-full h-9 rounded-md border bg-background px-3 text-sm
              focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
              ${errors.region ? 'border-destructive' : 'border-input'}
              ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            `}
          >
            <option value="">Select a region...</option>
            {AWS_REGIONS.map((region) => (
              <option key={region.value} value={region.value}>
                {region.label} ({region.value})
              </option>
            ))}
          </select>
          {errors.region && <p className="text-xs text-destructive mt-1">{errors.region}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Access Key ID</label>
            <Input
              type="text"
              placeholder="AKIA..."
              value={snsConfig.accessKeyId || ''}
              onChange={(e) => updateConfig('accessKeyId', e.target.value)}
              disabled={disabled}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Secret Access Key</label>
            <Input
              type="password"
              placeholder="••••••••"
              value={snsConfig.secretAccessKey || ''}
              onChange={(e) => updateConfig('secretAccessKey', e.target.value)}
              disabled={disabled}
              autoComplete="off"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          Optional. Leave blank to use IAM role-based authentication.
        </p>
      </div>
    )
  }

  return null
}

// Headers Editor Component
interface HeadersEditorProps {
  value: Record<string, string>
  onChange: (headers: Record<string, string>) => void
  disabled?: boolean
}

function HeadersEditor({ value, onChange, disabled }: HeadersEditorProps) {
  const [headers, setHeaders] = React.useState<Array<{ key: string; value: string }>>(
    Object.entries(value).length > 0
      ? Object.entries(value).map(([key, val]) => ({ key, value: val }))
      : [{ key: '', value: '' }]
  )

  const updateHeaders = (newHeaders: Array<{ key: string; value: string }>) => {
    setHeaders(newHeaders)
    const result: Record<string, string> = {}
    newHeaders.forEach((h) => {
      if (h.key.trim()) {
        result[h.key.trim()] = h.value
      }
    })
    onChange(result)
  }

  const addHeader = () => {
    updateHeaders([...headers, { key: '', value: '' }])
  }

  const removeHeader = (index: number) => {
    if (headers.length === 1) {
      updateHeaders([{ key: '', value: '' }])
    } else {
      updateHeaders(headers.filter((_, i) => i !== index))
    }
  }

  const updateHeader = (index: number, field: 'key' | 'value', newValue: string) => {
    const newHeaders = headers.map((h, i) =>
      i === index ? { ...h, [field]: newValue } : h
    )
    updateHeaders(newHeaders)
  }

  return (
    <div className="space-y-2">
      {headers.map((header, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            type="text"
            placeholder="Header name"
            value={header.key}
            onChange={(e) => updateHeader(index, 'key', e.target.value)}
            disabled={disabled}
            className="flex-1"
          />
          <Input
            type="text"
            placeholder="Header value"
            value={header.value}
            onChange={(e) => updateHeader(index, 'value', e.target.value)}
            disabled={disabled}
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => removeHeader(index)}
            disabled={disabled}
            className="p-2 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
            aria-label="Remove header"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addHeader}
        disabled={disabled}
        className="flex items-center gap-1 text-sm text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add header
      </button>
    </div>
  )
}
