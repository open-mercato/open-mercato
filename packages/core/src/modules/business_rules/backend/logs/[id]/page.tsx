"use client"

import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'

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
      <div className="container mx-auto py-6 px-4 max-w-5xl">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    )
  }

  if (error || !log) {
    return (
      <div className="container mx-auto py-6 px-4 max-w-5xl">
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <p className="text-red-800">{t('business_rules.logs.errors.loadFailed')}</p>
        </div>
      </div>
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
    <div className="container mx-auto py-6 px-4 max-w-5xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            {t('business_rules.logs.detail.title')}
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {t('business_rules.logs.detail.logId')}: {log.id}
          </p>
        </div>
        <Button onClick={() => router.push('/backend/logs')} variant="outline">
          {t('common.back')}
        </Button>
      </div>

      <div className="space-y-6">
        {/* Execution Summary */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-xl font-semibold mb-4">
            {t('business_rules.logs.detail.summary')}
          </h2>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">
                {t('business_rules.logs.fields.executedAt')}
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {new Date(log.executedAt).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
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
              <dt className="text-sm font-medium text-gray-500">
                {t('business_rules.logs.fields.executionTime')}
              </dt>
              <dd className="mt-1 text-sm text-gray-900">{log.executionTimeMs}ms</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
                {t('business_rules.logs.fields.executedBy')}
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {log.executedBy || t('common.unknown')}
              </dd>
            </div>
          </dl>
        </div>

        {/* Rule Information */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-xl font-semibold mb-4">
            {t('business_rules.logs.detail.ruleInfo')}
          </h2>
          {log.rule ? (
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <dt className="text-sm font-medium text-gray-500">
                  {t('business_rules.logs.fields.ruleName')}
                </dt>
                <dd className="mt-1">
                  <Link
                    href={`/backend/rules/${log.rule.id}`}
                    className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    {log.rule.ruleName}
                  </Link>
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">
                  {t('business_rules.logs.fields.ruleType')}
                </dt>
                <dd className="mt-1 text-sm text-gray-900">{log.rule.ruleType}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-sm font-medium text-gray-500">
                  {t('business_rules.logs.fields.ruleId')}
                </dt>
                <dd className="mt-1 text-sm text-gray-900 font-mono">{log.rule.ruleId}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-gray-500">{t('business_rules.logs.ruleDeleted')}</p>
          )}
        </div>

        {/* Entity Information */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-xl font-semibold mb-4">
            {t('business_rules.logs.detail.entityInfo')}
          </h2>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">
                {t('business_rules.logs.fields.entityType')}
              </dt>
              <dd className="mt-1 text-sm text-gray-900">{log.entityType}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
                {t('business_rules.logs.fields.eventType')}
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {log.eventType || t('common.none')}
              </dd>
            </div>
            {log.entityId && (
              <div className="md:col-span-2">
                <dt className="text-sm font-medium text-gray-500">
                  {t('business_rules.logs.fields.entityId')}
                </dt>
                <dd className="mt-1 text-sm text-gray-900 font-mono break-all">
                  {log.entityId}
                </dd>
              </div>
            )}
          </dl>
        </div>

        {/* Error Message (if present) */}
        {log.errorMessage && (
          <div className="bg-red-50 rounded-lg border border-red-200 p-6">
            <h2 className="text-xl font-semibold mb-4 text-red-900">
              {t('business_rules.logs.detail.errorMessage')}
            </h2>
            <pre className="text-sm text-red-800 whitespace-pre-wrap font-mono">
              {log.errorMessage}
            </pre>
          </div>
        )}

        {/* Input Context */}
        {log.inputContext && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-xl font-semibold mb-4">
              {t('business_rules.logs.detail.inputContext')}
            </h2>
            <pre className="text-sm text-gray-900 whitespace-pre-wrap font-mono bg-gray-50 p-4 rounded overflow-x-auto">
              {JSON.stringify(log.inputContext, null, 2)}
            </pre>
          </div>
        )}

        {/* Output Context */}
        {log.outputContext && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-xl font-semibold mb-4">
              {t('business_rules.logs.detail.outputContext')}
            </h2>
            <pre className="text-sm text-gray-900 whitespace-pre-wrap font-mono bg-gray-50 p-4 rounded overflow-x-auto">
              {JSON.stringify(log.outputContext, null, 2)}
            </pre>
          </div>
        )}

        {/* Result Value */}
        {log.resultValue && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-xl font-semibold mb-4">
              {t('business_rules.logs.detail.resultValue')}
            </h2>
            <pre className="text-sm text-gray-900 whitespace-pre-wrap font-mono bg-gray-50 p-4 rounded overflow-x-auto">
              {JSON.stringify(log.resultValue, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
