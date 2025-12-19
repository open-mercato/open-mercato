'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@/lib/i18n/context'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import type { WorkflowInstance } from '../../../data/entities'

interface PageProps {
  params?: {
    id?: string
  }
}

export default function WorkflowInstanceDetailPage({ params }: PageProps) {
  const id = params?.id || ''
  const t = useT()
  const router = useRouter()
  const [instance, setInstance] = useState<WorkflowInstance | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    // Don't fetch if id is not available yet
    if (!id) {
      return
    }

    const fetchInstance = async () => {
      try {
        const response = await apiFetch(`/api/workflows/instances/${id}`)
        if (response.ok) {
          const data = await response.json()
          setInstance(data.data)
        } else {
          setError(t('workflows.instances.notFound') || 'Instance not found')
        }
      } catch (err) {
        console.error('Error fetching instance:', err)
        setError(t('workflows.instances.loadFailed') || 'Failed to load instance')
      } finally {
        setIsLoading(false)
      }
    }

    fetchInstance()
  }, [id, t])

  const getStatusBadgeClass = (status: WorkflowInstance['status']) => {
    switch (status) {
      case 'RUNNING':
        return 'bg-blue-100 text-blue-800'
      case 'PAUSED':
        return 'bg-yellow-100 text-yellow-800'
      case 'COMPLETED':
        return 'bg-green-100 text-green-800'
      case 'FAILED':
        return 'bg-red-100 text-red-800'
      case 'CANCELLED':
        return 'bg-gray-100 text-gray-800'
      case 'COMPENSATING':
        return 'bg-orange-100 text-orange-800'
      case 'COMPENSATED':
        return 'bg-purple-100 text-purple-800'
      default:
        return 'bg-gray-100 text-gray-600'
    }
  }

  const handleCancel = async () => {
    if (!instance || !confirm(t('workflows.instances.confirmCancel'))) {
      return
    }

    setActionLoading(true)
    try {
      const response = await apiFetch(`/api/workflows/instances/${instance.id}/cancel`, {
        method: 'POST',
      })

      if (response.ok) {
        const data = await response.json()
        setInstance(data.data)
      } else {
        alert(t('workflows.instances.cancelFailed'))
      }
    } catch (error) {
      console.error('Error cancelling instance:', error)
      alert(t('workflows.instances.cancelFailed'))
    } finally {
      setActionLoading(false)
    }
  }

  const handleRetry = async () => {
    if (!instance || !confirm(t('workflows.instances.confirmRetry'))) {
      return
    }

    setActionLoading(true)
    try {
      const response = await apiFetch(`/api/workflows/instances/${instance.id}/retry`, {
        method: 'POST',
      })

      if (response.ok) {
        const data = await response.json()
        setInstance(data.data)
      } else {
        alert(t('workflows.instances.retryFailed'))
      }
    } catch (error) {
      console.error('Error retrying instance:', error)
      alert(t('workflows.instances.retryFailed'))
    } finally {
      setActionLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">{t('common.loading') || 'Loading...'}</div>
      </div>
    )
  }

  if (error || !instance) {
    return (
      <div className="space-y-4">
        <div className="text-red-600">{error}</div>
        <Link href="/backend/instances" className="text-blue-600 hover:text-blue-800">
          ← {t('workflows.backToList') || 'Back to list'}
        </Link>
      </div>
    )
  }

  const canCancel = ['RUNNING', 'PAUSED'].includes(instance.status)
  const canRetry = instance.status === 'FAILED'

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <Link href="/backend/instances" className="hover:text-gray-900">
          {t('workflows.instances.title')}
        </Link>
        <span>/</span>
        <span className="text-gray-900">{instance.workflowId}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{instance.workflowId}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {t('workflows.instances.fields.instanceId')}: {instance.id}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${getStatusBadgeClass(
              instance.status
            )}`}
          >
            {t(`workflows.instances.status.${instance.status}`)}
          </span>
          {canCancel && (
            <Button
              onClick={handleCancel}
              disabled={actionLoading}
              variant="outline"
              size="sm"
            >
              {t('workflows.instances.actions.cancel')}
            </Button>
          )}
          {canRetry && (
            <Button
              onClick={handleRetry}
              disabled={actionLoading}
              variant="outline"
              size="sm"
            >
              {t('workflows.instances.actions.retry')}
            </Button>
          )}
        </div>
      </div>

      {/* Overview Card */}
      <div className="bg-white shadow rounded-lg border border-gray-200">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {t('workflows.instances.sections.overview')}
          </h2>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <dt className="text-sm font-medium text-gray-500">
                {t('workflows.instances.fields.workflowId')}
              </dt>
              <dd className="mt-1 text-sm text-gray-900">{instance.workflowId}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
                {t('workflows.instances.fields.version')}
              </dt>
              <dd className="mt-1 text-sm text-gray-900">{instance.version}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
                {t('workflows.instances.fields.currentStep')}
              </dt>
              <dd className="mt-1 text-sm text-gray-900">{instance.currentStepId || '-'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
                {t('workflows.instances.fields.correlationKey')}
              </dt>
              <dd className="mt-1 text-sm text-gray-900">{instance.correlationKey || '-'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
                {t('workflows.instances.fields.startedAt')}
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {new Date(instance.startedAt).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
                {t('workflows.instances.fields.completedAt')}
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {instance.completedAt ? new Date(instance.completedAt).toLocaleString() : '-'}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
                {t('workflows.instances.fields.retryCount')}
              </dt>
              <dd className="mt-1 text-sm text-gray-900">{instance.retryCount}</dd>
            </div>
            {instance.errorMessage && (
              <div className="col-span-2">
                <dt className="text-sm font-medium text-red-500">
                  {t('workflows.instances.fields.lastError')}
                </dt>
                <dd className="mt-1 text-sm text-red-700 bg-red-50 p-3 rounded">
                  <p className="whitespace-pre-wrap">{instance.errorMessage}</p>
                  {instance.errorDetails && (
                    <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">
                      {JSON.stringify(instance.errorDetails, null, 2)}
                    </pre>
                  )}
                </dd>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Context Card */}
      <div className="bg-white shadow rounded-lg border border-gray-200">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {t('workflows.instances.sections.context')}
          </h2>
          <pre className="bg-gray-50 p-4 rounded text-xs font-mono overflow-x-auto">
            {JSON.stringify(instance.context, null, 2)}
          </pre>
        </div>
      </div>

      {/* Metadata Card */}
      {instance.metadata && Object.keys(instance.metadata).length > 0 && (
        <div className="bg-white shadow rounded-lg border border-gray-200">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              {t('workflows.instances.sections.metadata')}
            </h2>
            <pre className="bg-gray-50 p-4 rounded text-xs font-mono overflow-x-auto">
              {JSON.stringify(instance.metadata, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* Execution History - TODO: Implement when execution logging is added */}
      {/*
      <div className="bg-white shadow rounded-lg border border-gray-200">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {t('workflows.instances.sections.executionHistory')}
          </h2>
          <p className="text-sm text-gray-500">{t('workflows.instances.noExecutionHistory')}</p>
        </div>
      </div>
      */}
    </div>
  )
}
