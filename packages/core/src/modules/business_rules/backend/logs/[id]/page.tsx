"use client"

import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'

type RuleExecutionLog = {
  id: string
  ruleId: string
  rule?: {
    id: string
    ruleId: string
    ruleName: string
    ruleType: string
  } | null
  entityType: string
  entityId: string | null
  eventType: string | null
  executedAt: string
  executionTimeMs: number
  executionResult: 'SUCCESS' | 'FAILURE' | 'ERROR'
  resultValue: any | null
  errorMessage: string | null
  inputContext: any | null
  outputContext: any | null
  executedBy: string | null
  tenantId: string | null
  organizationId: string | null
}

export default function ExecutionLogDetailPage() {
  const router = useRouter()
  const params = useParams()

  // Handle catch-all route: params.slug = ['logs', 'id']
  let logId: string | undefined
  if (params?.slug && Array.isArray(params.slug)) {
    logId = params.slug[1] // Second element is the ID
  } else if (params?.id) {
    logId = Array.isArray(params.id) ? params.id[0] : params.id
  }

  const t = useT()

  const { data: log, isLoading, error } = useQuery({
    queryKey: ['business-rules', 'logs', logId],
    queryFn: async () => {
      const response = await apiFetch(`/api/business_rules/logs/${logId}`)
      if (!response.ok) {
        throw new Error(t('business_rules.logs.errors.fetchFailed'))
      }
      const result = await response.json()
      return result as RuleExecutionLog
    },
    enabled: !!logId,
  })

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="h-6 w-6" />
            <span>{t('business_rules.logs.detail.loading')}</span>
          </div>
        </PageBody>
      </Page>
    )
  }

  if (error || !log) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <p>{error ? t('business_rules.logs.errors.loadFailed') : t('business_rules.logs.errors.notFound')}</p>
            <Button asChild variant="outline">
              <Link href="/backend/logs">{t('business_rules.logs.backToList')}</Link>
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  const getResultBadgeClass = (result: string) => {
    switch (result) {
      case 'SUCCESS':
        return 'bg-green-100 text-green-800'
      case 'FAILURE':
        return 'bg-yellow-100 text-yellow-800'
      case 'ERROR':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {t('business_rules.logs.detail.title')}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {t('business_rules.logs.detail.logId')}: {log.id}
              </p>
            </div>
            <Button onClick={() => router.push('/backend/logs')} variant="outline">
              {t('business_rules.logs.backToList')}
            </Button>
          </div>

          {/* Execution Summary */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-semibold mb-4">
              {t('business_rules.logs.detail.summary')}
            </h2>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('business_rules.logs.fields.executedAt')}
                </dt>
                <dd className="mt-1 text-sm text-foreground">
                  {new Date(log.executedAt).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('business_rules.logs.fields.result')}
                </dt>
                <dd className="mt-1">
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${getResultBadgeClass(
                      log.executionResult
                    )}`}
                  >
                    {t(`business_rules.logs.result.${log.executionResult.toLowerCase()}`)}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('business_rules.logs.fields.executionTime')}
                </dt>
                <dd className="mt-1 text-sm text-foreground">{log.executionTimeMs}ms</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('business_rules.logs.fields.executedBy')}
                </dt>
                <dd className="mt-1 text-sm text-foreground">
                  {log.executedBy || t('common.unknown')}
                </dd>
              </div>
            </dl>
          </div>

          {/* Rule Information */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-semibold mb-4">
              {t('business_rules.logs.detail.ruleInfo')}
            </h2>
            {log.rule ? (
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">
                    {t('business_rules.logs.fields.ruleName')}
                  </dt>
                  <dd className="mt-1">
                    <Link
                      href={`/backend/rules/${log.rule.id}`}
                      className="text-sm text-primary hover:underline"
                    >
                      {log.rule.ruleName}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">
                    {t('business_rules.logs.fields.ruleType')}
                  </dt>
                  <dd className="mt-1 text-sm text-foreground">{log.rule.ruleType}</dd>
                </div>
                <div className="md:col-span-2">
                  <dt className="text-sm font-medium text-muted-foreground">
                    {t('business_rules.logs.fields.ruleId')}
                  </dt>
                  <dd className="mt-1 text-sm text-foreground font-mono">{log.rule.ruleId}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">{t('business_rules.logs.ruleDeleted')}</p>
            )}
          </div>

          {/* Entity Information */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-semibold mb-4">
              {t('business_rules.logs.detail.entityInfo')}
            </h2>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('business_rules.logs.fields.entityType')}
                </dt>
                <dd className="mt-1 text-sm text-foreground">{log.entityType}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('business_rules.logs.fields.eventType')}
                </dt>
                <dd className="mt-1 text-sm text-foreground">
                  {log.eventType || t('common.none')}
                </dd>
              </div>
              {log.entityId && (
                <div className="md:col-span-2">
                  <dt className="text-sm font-medium text-muted-foreground">
                    {t('business_rules.logs.fields.entityId')}
                  </dt>
                  <dd className="mt-1 text-sm text-foreground font-mono break-all">
                    {log.entityId}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Error Message (if present) */}
          {log.errorMessage && (
            <div className="rounded-lg border border-destructive bg-destructive/5 p-6">
              <h2 className="text-lg font-semibold mb-4 text-destructive">
                {t('business_rules.logs.detail.errorMessage')}
              </h2>
              <pre className="text-sm text-destructive whitespace-pre-wrap font-mono">
                {log.errorMessage}
              </pre>
            </div>
          )}

          {/* Input Context */}
          {log.inputContext && (
            <JsonDisplay
              data={log.inputContext}
              title={t('business_rules.logs.detail.inputContext')}
            />
          )}

          {/* Output Context */}
          {log.outputContext && (
            <JsonDisplay
              data={log.outputContext}
              title={t('business_rules.logs.detail.outputContext')}
            />
          )}

          {/* Result Value */}
          {log.resultValue && (
            <JsonDisplay
              data={log.resultValue}
              title={t('business_rules.logs.detail.resultValue')}
            />
          )}
        </div>
      </PageBody>
    </Page>
  )
}
