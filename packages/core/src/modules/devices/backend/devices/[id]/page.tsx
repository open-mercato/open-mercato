"use client"
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useDeviceUserLabels } from '../useDeviceUserLabels'

type DeviceDetail = {
  id: string
  userId: string
  deviceId: string
  platform: string
  clientAppVersion: string | null
  osVersion: string | null
  pushProvider: string | null
  updatedAt: string | null
}

type FormValues = {
  clientAppVersion: string
  osVersion: string
  pushProvider: string
}

export default function DeviceAdminEditPage({ params }: { params?: { id?: string } }) {
  const router = useRouter()
  const t = useT()
  const id = typeof params?.id === 'string' ? params.id : ''
  const [device, setDevice] = React.useState<DeviceDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      setNotFound(false)
      const call = await apiCall<{ item?: DeviceDetail }>(
        `/api/devices/admin/devices/${encodeURIComponent(id)}`,
        undefined,
        { fallback: null },
      )
      if (cancelled) return
      if (call.ok && call.result?.item) {
        setDevice(call.result.item)
      } else if (call.status === 404 || (call.ok && !call.result?.item)) {
        setNotFound(true)
      } else {
        setError(t('devices.form.error.loadFailed'))
      }
      setIsLoading(false)
    }
    if (id) load()
    return () => { cancelled = true }
  }, [id, t])

  // Resolve the owner's display name for a link to their profile. Devices admins may not hold
  // auth.users.list, so this falls back to the raw id (rendered without a link) instead of redirecting.
  const ownerIds = React.useMemo(() => [device?.userId], [device?.userId])
  const userLabels = useDeviceUserLabels(ownerIds)
  const userLabel = device?.userId ? userLabels[device.userId] ?? null : null

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'clientAppVersion', label: t('devices.form.appVersion'), type: 'text' },
    { id: 'osVersion', label: t('devices.form.osVersion'), type: 'text' },
    { id: 'pushProvider', label: t('devices.form.pushProvider'), type: 'text' },
  ], [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => ([
    { id: 'details', title: t('devices.form.details'), column: 1, fields: ['clientAppVersion', 'osVersion', 'pushProvider'] },
  ]), [t])

  if (isLoading) {
    return <Page><PageBody><LoadingMessage label={t('common.loading')} /></PageBody></Page>
  }
  if (notFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('devices.errors.not_found')}
            backHref="/backend/devices"
            backLabel={t('devices.list.title')}
          />
        </PageBody>
      </Page>
    )
  }
  if (error || !device) {
    return <Page><PageBody><ErrorMessage label={error ?? t('devices.form.error.loadFailed')} /></PageBody></Page>
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<FormValues>
          title={t('devices.form.editTitle')}
          titleHeadingLevel={1}
          backHref="/backend/devices"
          contentHeader={(
            <dl className="grid grid-cols-1 gap-3 rounded-md border bg-muted p-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">{t('devices.form.deviceId')}</dt>
                <dd className="mt-1"><code className="text-xs">{device.deviceId}</code></dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">{t('devices.form.platform')}</dt>
                <dd className="mt-1">{device.platform}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">{t('devices.form.userId')}</dt>
                <dd className="mt-1">{userLabel ? (
                  <Link href={`/backend/users/${encodeURIComponent(device.userId)}/edit`} className="text-primary hover:underline">{userLabel}</Link>
                ) : (
                  <code className="text-xs">{device.userId}</code>
                )}</dd>
              </div>
            </dl>
          )}
          fields={fields}
          groups={groups}
          optimisticLockUpdatedAt={device.updatedAt}
          initialValues={{
            clientAppVersion: device.clientAppVersion ?? '',
            osVersion: device.osVersion ?? '',
            pushProvider: device.pushProvider ?? '',
          }}
          submitLabel={t('common.save')}
          cancelHref="/backend/devices"
          onSubmit={async (values) => {
            await updateCrud(`devices/admin/devices/${encodeURIComponent(id)}`, {
              clientAppVersion: values.clientAppVersion.trim() || null,
              osVersion: values.osVersion.trim() || null,
              pushProvider: values.pushProvider.trim() || null,
            })
            flash(t('devices.form.success.updated'), 'success')
            router.push('/backend/devices')
          }}
        />
      </PageBody>
    </Page>
  )
}
