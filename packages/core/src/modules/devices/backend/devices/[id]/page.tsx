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

type DeviceDetail = {
  id: string
  user_id: string
  device_id: string
  platform: string
  client_app_version: string | null
  os_version: string | null
  push_provider: string | null
  updated_at: string | null
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
  const [userLabel, setUserLabel] = React.useState<string | null>(null)

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
  // auth.users.list, so fall back to the raw id (rendered without a link) instead of redirecting.
  React.useEffect(() => {
    const userId = device?.user_id
    if (!userId) return
    let cancelled = false
    void (async () => {
      const call = await apiCall<{ items?: { id: string; name?: string | null; email?: string | null }[] }>(
        `/api/auth/users?id=${encodeURIComponent(userId)}`,
        { headers: { 'x-om-forbidden-redirect': '0' } },
        { fallback: null },
      ).catch(() => null)
      if (cancelled || !call || !call.ok) return
      const found = call.result?.items?.find((u) => u.id === userId)
      const label = found?.name?.trim() || found?.email?.trim() || null
      if (label) setUserLabel(label)
    })()
    return () => { cancelled = true }
  }, [device?.user_id])

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
          backHref="/backend/devices"
          contentHeader={(
            <dl className="grid grid-cols-1 gap-3 rounded-md border bg-muted p-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">{t('devices.form.deviceId')}</dt>
                <dd className="mt-1"><code className="text-xs">{device.device_id}</code></dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">{t('devices.form.platform')}</dt>
                <dd className="mt-1">{device.platform}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">{t('devices.form.userId')}</dt>
                <dd className="mt-1">{userLabel ? (
                  <Link href={`/backend/users/${encodeURIComponent(device.user_id)}/edit`} className="text-primary hover:underline">{userLabel}</Link>
                ) : (
                  <code className="text-xs">{device.user_id}</code>
                )}</dd>
              </div>
            </dl>
          )}
          fields={fields}
          groups={groups}
          optimisticLockUpdatedAt={device.updated_at}
          initialValues={{
            clientAppVersion: device.client_app_version ?? '',
            osVersion: device.os_version ?? '',
            pushProvider: device.push_provider ?? '',
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
