"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type DeviceDetail = {
  id: string
  user_id: string
  device_id: string
  platform: string
  client_app_version: string | null
  os_version: string | null
  push_provider: string | null
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

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      const call = await apiCall<{ item?: DeviceDetail }>(
        `/api/devices/admin/devices/${encodeURIComponent(id)}`,
        undefined,
        { fallback: null },
      )
      if (cancelled) return
      if (!call.ok || !call.result?.item) {
        setError(t('devices.form.error.loadFailed'))
      } else {
        setDevice(call.result.item)
      }
      setIsLoading(false)
    }
    if (id) load()
    return () => { cancelled = true }
  }, [id, t])

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
  if (error || !device) {
    return <Page><PageBody><ErrorMessage label={error ?? t('devices.form.error.loadFailed')} /></PageBody></Page>
  }

  return (
    <Page>
      <PageBody>
        <div className="mb-4 rounded-md border bg-muted/30 p-4 text-sm space-y-1">
          <div><span className="text-muted-foreground">{t('devices.form.deviceId')}: </span><code className="text-xs">{device.device_id}</code></div>
          <div><span className="text-muted-foreground">{t('devices.form.platform')}: </span>{device.platform}</div>
          <div><span className="text-muted-foreground">{t('devices.form.userId')}: </span><code className="text-xs">{device.user_id}</code></div>
        </div>
        <CrudForm<FormValues>
          title={t('devices.form.editTitle')}
          backHref="/backend/devices"
          fields={fields}
          groups={groups}
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
