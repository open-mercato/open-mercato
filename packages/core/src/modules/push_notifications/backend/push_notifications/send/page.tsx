"use client"
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFieldOption, type CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@open-mercato/ui/primitives/select'
import { Input } from '@open-mercato/ui/primitives/input'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type KeyValue = { key: string; value: string }

type FormValues = {
  userId: string
  deviceId: string
  mode: string
  title: string
  body: string
  data: KeyValue[]
  sound: string
  badge: number | string
  image: string
  priority: string
  channelId: string
  // form-only helper (never sent): drives channelId visibility (hidden in silent / for an iOS target)
  showChannelId: boolean
}

const DELIVERIES_HREF = '/backend/push_notifications'
const FORM_ID = 'push-custom-send-form'
// Radix Select forbids an empty-string item value, so "all devices" uses a sentinel that we map
// back to '' (the form value that means "fan out to every push-capable device").
const ALL_DEVICES = '__all__'

type DeviceOption = { id: string; label: string; platform: string }
// Reported up to the page so the (custom) submit button can disable when there is nothing to send to.
type DeviceState = { userId: string; count: number; loading: boolean }

// Dependent picker: loads the *selected recipient's* push-capable devices (admin devices API,
// filtered by userId) so an admin can target one device or all of them. Reads the live form values,
// so it re-loads whenever the recipient changes and clears a stale selection. It also derives
// `showChannelId` (Android channel id is Android-only + visible-only) so the channelId field can hide
// itself for a selected iOS device or in silent mode. Degrades to "All devices" when the admin lacks
// devices.admin or the recipient has no push-capable device.
function DeviceField({ value, setValue, setFormValue, values, onState }: CrudCustomFieldRenderProps & { onState?: (s: DeviceState) => void }) {
  const t = useT()
  const userId = typeof values?.userId === 'string' ? values.userId : ''
  const mode = typeof values?.mode === 'string' ? values.mode : 'visible'
  const selected = typeof value === 'string' && value ? value : ''
  const [devices, setDevices] = React.useState<DeviceOption[]>([])
  const [loading, setLoading] = React.useState(false)

  // Report the recipient + push-capable device count up so the page can disable "Send" when there is
  // nowhere to deliver (no recipient, or the recipient has zero push-capable devices).
  React.useEffect(() => {
    onState?.({ userId, count: devices.length, loading })
  }, [userId, devices.length, loading, onState])

  React.useEffect(() => {
    if (!userId) {
      setDevices([])
      if (selected) setValue('')
      return
    }
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ userId, pageSize: '50' })
    apiCall<{ items?: Array<{ id: string; device_id: string; platform: string; push_provider?: string | null }> }>(
      `/api/devices/admin/devices?${params.toString()}`,
      { headers: { 'x-om-forbidden-redirect': '0' } },
      { fallback: null },
    )
      .catch(() => null)
      .then((call) => {
        if (cancelled) return
        const items = (call && call.ok ? call.result?.items : []) ?? []
        const opts = items
          .filter((d): d is { id: string; device_id: string; platform: string; push_provider?: string | null } =>
            !!d && typeof d.id === 'string' && !!d.push_provider)
          .map((d) => ({ id: d.id, label: `${d.device_id} · ${d.platform}${d.push_provider ? ` · ${d.push_provider}` : ''}`, platform: d.platform }))
        setDevices(opts)
        if (selected && !opts.some((o) => o.id === selected)) setValue('')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // Reload only when the recipient changes; `selected`/`setValue` are handled inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // channelId is Android-only and irrelevant to silent pushes → hide it for a selected iOS device or
  // in silent mode. Only write when the derived value actually changes (avoids a render loop).
  const selectedPlatform = React.useMemo(() => devices.find((d) => d.id === selected)?.platform, [devices, selected])
  React.useEffect(() => {
    const show = mode !== 'silent' && selectedPlatform !== 'ios'
    if (values?.showChannelId !== show) setFormValue?.('showChannelId', show)
  }, [mode, selectedPlatform, values?.showChannelId, setFormValue])

  return (
    <div className="space-y-1">
      <Select value={selected || ALL_DEVICES} onValueChange={(v) => setValue(v === ALL_DEVICES ? '' : v)} disabled={!userId}>
        <SelectTrigger>
          <SelectValue placeholder={`${t('push_notifications.send.deviceAll')} (${devices.length})`} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_DEVICES}>{`${t('push_notifications.send.deviceAll')} (${devices.length})`}</SelectItem>
          {devices.map((d) => (
            <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className={`text-xs ${userId && !loading && devices.length === 0 ? 'text-status-warning-text' : 'text-muted-foreground'}`}>
        {!userId
          ? t('push_notifications.send.deviceSelectUserFirst')
          : loading
            ? t('common.loading', 'Loading…')
            : devices.length === 0
              ? t('push_notifications.send.deviceNone')
              : t('push_notifications.send.deviceHint')}
      </p>
    </div>
  )
}

// Arbitrary key/value payload delivered inside the push `data` map (the app reads it). Shown for both
// visible and silent sends — for silent it is the entire payload.
function DataField({ value, setValue }: CrudCustomFieldRenderProps) {
  const t = useT()
  const pairs: KeyValue[] = Array.isArray(value) ? (value as KeyValue[]) : []
  const update = (next: KeyValue[]) => setValue(next)
  return (
    <div className="space-y-2">
      {pairs.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('push_notifications.send.dataEmpty')}</p>
      ) : null}
      {pairs.map((pair, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            placeholder={t('push_notifications.send.dataKey')}
            value={pair.key}
            onChange={(e) => update(pairs.map((p, i) => (i === index ? { ...p, key: e.target.value } : p)))}
          />
          <Input
            placeholder={t('push_notifications.send.dataValue')}
            value={pair.value}
            onChange={(e) => update(pairs.map((p, i) => (i === index ? { ...p, value: e.target.value } : p)))}
          />
          <IconButton
            type="button"
            variant="ghost"
            aria-label={t('push_notifications.send.dataRemove')}
            onClick={() => update(pairs.filter((_, i) => i !== index))}
          >
            <X className="h-4 w-4" />
          </IconButton>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => update([...pairs, { key: '', value: '' }])}>
        <Plus className="h-4 w-4 mr-1" />
        {t('push_notifications.send.dataAdd')}
      </Button>
    </div>
  )
}

export default function PushCustomSendPage() {
  const router = useRouter()
  const t = useT()
  const [deviceState, setDeviceState] = React.useState<DeviceState>({ userId: '', count: 0, loading: false })
  const [submitting, setSubmitting] = React.useState(false)

  // Stable reporter for the device picker → bails when unchanged so it can't loop the render.
  const reportDeviceState = React.useCallback((next: DeviceState) => {
    setDeviceState((prev) =>
      prev.userId === next.userId && prev.count === next.count && prev.loading === next.loading ? prev : next)
  }, [])

  // Recipient search by name/email via /api/auth/users (mirrors the devices list + admin
  // notification-preferences picker). Return results only — the combobox retains them internally, so
  // pushing them into state that `fields` depends on would re-render the whole form per keystroke.
  const loadUserOptions = React.useCallback(async (query?: string): Promise<CrudFieldOption[]> => {
    const params = new URLSearchParams()
    params.set('page', '1')
    params.set('pageSize', '20')
    if (query && query.trim().length > 0) params.set('search', query.trim())
    const call = await apiCall<{ items?: { id: string; name?: string | null; email?: string | null }[] }>(
      `/api/auth/users?${params.toString()}`,
      { headers: { 'x-om-forbidden-redirect': '0' } },
      { fallback: null },
    ).catch(() => null)
    if (!call || !call.ok) return []
    return (call.result?.items ?? []).flatMap((item): CrudFieldOption[] => {
      if (!item || typeof item.id !== 'string' || !item.id.trim()) return []
      const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : null
      const email = typeof item.email === 'string' && item.email.trim() ? item.email.trim() : null
      const label = name && email ? `${name} — ${email}` : email ?? name ?? item.id
      return [{ value: item.id, label }]
    })
  }, [])

  const visibleOnly = { field: 'mode', equals: 'visible' } as const

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'userId', label: t('push_notifications.send.userId'), type: 'combobox', required: true, description: t('push_notifications.send.userIdHint'), loadOptions: loadUserOptions },
    { id: 'deviceId', label: t('push_notifications.send.device'), type: 'custom', component: (props) => <DeviceField {...props} onState={reportDeviceState} /> },
    {
      id: 'mode',
      label: t('push_notifications.send.mode'),
      type: 'select',
      required: true,
      description: t('push_notifications.send.modeHint'),
      options: [
        { value: 'visible', label: t('push_notifications.send.modeVisible') },
        { value: 'silent', label: t('push_notifications.send.modeSilent') },
      ],
    },
    { id: 'title', label: t('push_notifications.send.title'), type: 'text', required: true, visibleWhen: visibleOnly },
    { id: 'body', label: t('push_notifications.send.body'), type: 'textarea', visibleWhen: visibleOnly },
    { id: 'data', label: t('push_notifications.send.data'), type: 'custom', description: t('push_notifications.send.dataHint'), component: (props) => <DataField {...props} /> },
    { id: 'sound', label: t('push_notifications.send.sound'), type: 'text', visibleWhen: visibleOnly },
    { id: 'badge', label: t('push_notifications.send.badge'), type: 'number', visibleWhen: visibleOnly },
    { id: 'image', label: t('push_notifications.send.image'), type: 'text', visibleWhen: visibleOnly },
    {
      id: 'priority',
      label: t('push_notifications.send.priority'),
      type: 'select',
      options: [
        { value: '', label: t('push_notifications.send.priorityDefault') },
        { value: 'high', label: t('push_notifications.send.priorityHigh') },
        { value: 'normal', label: t('push_notifications.send.priorityNormal') },
      ],
    },
    { id: 'channelId', label: t('push_notifications.send.channelId'), type: 'text', visibleWhen: { field: 'showChannelId', equals: true } },
  ], [t, loadUserOptions, reportDeviceState])

  // NOTE: intentionally a flat field list (no `groups`). CrudForm only applies `visibleWhen` in the
  // ungrouped render path — grouped fields ignore it — and this form relies on mode/platform-driven
  // field visibility (silent hides title/body/options; iOS hides channelId).

  return (
    <Page>
      <PageBody>
        <CrudForm<FormValues>
          title={t('push_notifications.send.pageTitle')}
          backHref={DELIVERIES_HREF}
          formId={FORM_ID}
          hideFooterActions
          fields={fields}
          initialValues={{ userId: '', deviceId: '', mode: 'visible', title: '', body: '', data: [], sound: '', badge: '', image: '', priority: '', channelId: '', showChannelId: true }}
          submitLabel={t('push_notifications.send.submit')}
          onSubmit={async (values) => {
            setSubmitting(true)
            try {
            const silent = values.mode === 'silent'
            const body = (values.body ?? '').trim()

            const dataMap: Record<string, string> = {}
            for (const pair of Array.isArray(values.data) ? values.data : []) {
              const key = (pair?.key ?? '').trim()
              if (key) dataMap[key] = `${pair?.value ?? ''}`
            }
            const hasData = Object.keys(dataMap).length > 0

            // Options that only affect a visible banner are dropped for silent.
            const pushOptions: Record<string, unknown> = {}
            if (!silent) {
              if (typeof values.sound === 'string' && values.sound.trim()) pushOptions.sound = values.sound.trim()
              const badgeNum = typeof values.badge === 'number' ? values.badge : Number.parseInt(String(values.badge ?? ''), 10)
              if (Number.isFinite(badgeNum) && badgeNum >= 0) pushOptions.badge = badgeNum
              if (typeof values.image === 'string' && values.image.trim()) pushOptions.image = values.image.trim()
              if (typeof values.channelId === 'string' && values.channelId.trim()) pushOptions.channelId = values.channelId.trim()
            }
            if (values.priority === 'high' || values.priority === 'normal') pushOptions.priority = values.priority
            const hasOptions = Object.keys(pushOptions).length > 0

            // Silent hides the title field; the API still needs one, so use a stable label for the log.
            const title = silent ? (values.title ?? '').trim() || 'Silent push' : (values.title ?? '').trim()

            await apiCallOrThrow('/api/push_notifications/custom-send', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                recipientUserId: (values.userId ?? '').trim(),
                deviceId: (values.deviceId ?? '').trim() || undefined,
                title,
                body: !silent && body.length > 0 ? body : undefined,
                silent,
                data: hasData ? dataMap : undefined,
                pushOptions: hasOptions ? pushOptions : undefined,
              }),
            })
            flash(t('push_notifications.send.success'), 'success')
            router.push(DELIVERIES_HREF)
            } finally {
              setSubmitting(false)
            }
          }}
        />
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-xs">
            {!deviceState.userId ? (
              <span className="text-muted-foreground">{t('push_notifications.send.deviceSelectUserFirst')}</span>
            ) : deviceState.count === 0 && !deviceState.loading ? (
              <span className="text-status-warning-text">{t('push_notifications.send.deviceNone')}</span>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={DELIVERIES_HREF}>{t('common.cancel', 'Cancel')}</Link>
            </Button>
            <Button
              type="submit"
              form={FORM_ID}
              disabled={!deviceState.userId || deviceState.count === 0 || deviceState.loading || submitting}
            >
              {t('push_notifications.send.submit')}
            </Button>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
