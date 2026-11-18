"use client"

import * as React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDate, readErrorCode } from '../leases/leaseModel'
import { fromIsoDay, toIsoDay } from '../bookings/bookingModel'
import { isSubmitShortcut } from '../buildings/useBuildingUsage'
import { usePlural } from '../plural'
import { useMondayDateLocale } from '../useMondayDateLocale'
import { endsAtOf, startsAtOf, UNAVAILABILITY_RESOURCE_KIND, type AvailabilitySubject } from './availabilityModel'
import { useAvailabilityPreview } from './useAvailabilityPreview'
import { PreviewImpactLists } from './PreviewImpactLists'

const CONTEXT_ID = 'property-management-availability'
const NO_REASON = ''
const CLEAR_REASON = '__none__'

export type AvailabilityDialogProps = { subject: AvailabilitySubject | null; onClose: () => void; onDone: () => void }

export function AvailabilityDialog({ subject, onClose, onDone }: AvailabilityDialogProps) {
  const t = useT()
  const locale = useLocale()
  const { plural, count } = usePlural()
  const dateLocale = useMondayDateLocale()
  const [reasonEntryId, setReasonEntryId] = React.useState(NO_REASON)
  const [reasonText, setReasonText] = React.useState('')
  const [pickedFrom, setPickedFrom] = React.useState<string | null>(null)
  const [serverToday, setServerToday] = React.useState<string | null>(null)
  const [until, setUntil] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('property_management.common.blocked', 'The change was blocked.'),
  })

  const subjectKey = subject ? `${subject.type}:${subject.id}` : null

  React.useEffect(() => {
    if (!subjectKey) return
    setReasonEntryId(NO_REASON)
    setReasonText('')
    setPickedFrom(null)
    setUntil(null)
    setError(null)
  }, [subjectKey])

  const today = serverToday ?? toIsoDay(new Date())
  const from = pickedFrom && pickedFrom >= today ? pickedFrom : today
  const effectiveUntil = until && until < from ? from : until
  const range = React.useMemo(() => ({ startsAt: startsAtOf(from), endsAt: endsAtOf(effectiveUntil) }), [from, effectiveUntil])
  const {
    today: fetchedToday,
    reasons,
    reasonsFailed,
    reasonsLoading,
    retryReasons,
    preview,
    previewing,
    previewError,
    previewFieldErrors,
    retryPreview,
    refreshPreview,
    refs: { reasonTriggerRef, reasonsRetryRef, previewRetryRef, previewRef },
  } = useAvailabilityPreview(subject, range)

  React.useEffect(() => {
    if (fetchedToday) setServerToday(fetchedToday)
  }, [fetchedToday])

  const reasonLabel = reasons.find((reason) => reason.id === reasonEntryId)?.label ?? null
  const effectiveReasonText = reasonText.trim() || reasonLabel || ''
  const canConfirm = Boolean(subject && preview && effectiveReasonText && !pending && !previewing)

  const confirm = async () => {
    if (!subject || !preview || !canConfirm) return
    setPending(true)
    setError(null)
    try {
      const call = await runMutation({
        operation: () => apiCallOrThrow<{ cancelledBookings?: number; queuedBookings?: number }>('/api/property_management/unavailabilities', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            subjectType: subject.type,
            subjectId: subject.id,
            reasonEntryId: reasonEntryId === NO_REASON ? null : reasonEntryId,
            reasonText: effectiveReasonText,
            ...range,
            previewToken: preview.previewToken,
          }),
        }, { errorMessage: t('property_management.availability.dialog.error', 'Could not make it unavailable.') }),
        mutationPayload: { subjectType: subject.type, subjectId: subject.id },
        context: { formId: CONTEXT_ID, resourceKind: UNAVAILABILITY_RESOURCE_KIND, retryLastMutation },
      })
      const queued = call.result?.queuedBookings ?? 0
      flash(
        queued > 0
          ? plural('property_management.availability.dialog.queued', 'Unavailable. {count} more bookings are being cancelled in the background.', queued)
          : t('property_management.availability.dialog.success', 'Unavailable from {date}.', { date: formatDate(from, locale) }),
        'success',
      )
      onDone()
    } catch (err) {
      if (readErrorCode(err) === 'preview_stale') {
        setError(t('property_management.availability.dialog.stale', 'The bookings affected changed meanwhile. Review the preview and confirm again.'))
        refreshPreview()
        return
      }
      if (!surfaceRecordConflict(err, t)) {
        setError(err instanceof Error && err.message ? err.message : t('property_management.availability.dialog.error', 'Could not make it unavailable.'))
      }
    } finally {
      setPending(false)
    }
  }

  const bookingCount = preview?.bookingCount ?? 0
  const name = subject?.name ?? ''

  return (
    <Dialog open={subject !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent size="lg" onKeyDown={(event) => { if (isSubmitShortcut(event)) { event.preventDefault(); void confirm() } }}>
        <DialogHeader>
          <DialogTitle>{t('property_management.availability.dialog.title', 'Make {name} unavailable?', { name })}</DialogTitle>
          <DialogDescription>
            {subject?.type === 'unit'
              ? t('property_management.availability.dialog.unitHint', 'It takes no new leases or bookings while it is unavailable.')
              : t('property_management.availability.dialog.areaHint', 'Its units take no new leases or bookings while it is unavailable.')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="pm-availability-reason-entry">{t('property_management.availability.dialog.reasonKind', 'Reason')}</Label>
              <Select value={reasonEntryId} onValueChange={(next) => setReasonEntryId(next === CLEAR_REASON ? NO_REASON : next)}>
                <SelectTrigger ref={reasonTriggerRef} id="pm-availability-reason-entry">
                  <SelectValue placeholder={t('property_management.availability.dialog.reasonChoose', 'Choose a reason (optional)')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CLEAR_REASON}>{t('property_management.availability.dialog.reasonNone', 'No reason')}</SelectItem>
                  {reasons.map((reason) => <SelectItem key={reason.id} value={reason.id}>{reason.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pm-availability-reason-text">{t('property_management.availability.dialog.reasonText', 'Description')}{reasonLabel ? '' : ' *'}</Label>
              <Input
                id="pm-availability-reason-text"
                value={reasonText}
                maxLength={200}
                placeholder={reasonLabel
                  ? t('property_management.availability.dialog.reasonDetailsPlaceholder', 'Optional details')
                  : t('property_management.availability.dialog.reasonPlaceholder', 'e.g. Renovation')}
                onChange={(event) => setReasonText(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('property_management.availability.dialog.from', 'From')} *</Label>
              <DatePicker
                locale={dateLocale}
                value={fromIsoDay(from)}
                onChange={(value) => {
                  if (!value) return
                  const next = toIsoDay(value)
                  setError(null)
                  setPickedFrom(next)
                  if (until && until < next) setUntil(next)
                }}
                minDate={fromIsoDay(today)}
                aria-label={t('property_management.availability.dialog.from', 'From')}
                aria-describedby={previewFieldErrors?.startsAt ? 'pm-availability-from-error' : undefined}
              />
              {previewFieldErrors?.startsAt ? <p id="pm-availability-from-error" className="text-sm text-status-error-text">{previewFieldErrors.startsAt}</p> : null}
            </div>
            <div className="space-y-1">
              <Label>{t('property_management.availability.dialog.until', 'Until')}</Label>
              <DatePicker
                locale={dateLocale}
                value={effectiveUntil ? fromIsoDay(effectiveUntil) : null}
                onChange={(value) => { setError(null); setUntil(value ? toIsoDay(value) : null) }}
                minDate={fromIsoDay(from)}
                placeholder={t('property_management.availability.dialog.openEnded', 'Open-ended')}
                aria-label={t('property_management.availability.dialog.until', 'Until')}
                aria-describedby={previewFieldErrors?.endsAt ? 'pm-availability-until-error' : undefined}
              />
              {previewFieldErrors?.endsAt ? <p id="pm-availability-until-error" className="text-sm text-status-error-text">{previewFieldErrors.endsAt}</p> : null}
            </div>
          </div>
          {reasonsFailed ? (
            <Alert status="error">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{t('property_management.availability.dialog.reasonsError', 'Could not load the reasons. You can still describe the reason yourself.')}</span>
                <Button
                  ref={reasonsRetryRef}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={retryReasons}
                  aria-disabled={reasonsLoading || undefined}
                  aria-busy={reasonsLoading || undefined}
                  className={reasonsLoading ? 'cursor-not-allowed opacity-60' : undefined}
                  data-testid="pm-availability-reasons-retry"
                >
                  {t('property_management.common.retry', 'Try again')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {previewing ? <LoadingMessage label={t('property_management.availability.dialog.previewing', 'Checking bookings and leases…')} /> : null}
          {preview ? (
            <Alert ref={previewRef} tabIndex={-1} status="warning" className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="pm-availability-preview">
              <AlertTitle>
                {t('property_management.availability.dialog.impact', '{units} · {bookings} · {leases}', {
                  units: count('units', preview.unitCount),
                  bookings: plural('property_management.availability.dialog.impactBookings', '{count} bookings cancelled', preview.bookingCount),
                  leases: plural('property_management.availability.dialog.impactLeases', '{count} leases flagged', preview.leaseCount),
                })}
              </AlertTitle>
              <AlertDescription>
                <p>{t('property_management.availability.dialog.rules', 'Bookings in that period are cancelled and their sales orders moved to the cancelled status. Active leases stay, flagged "Unit unavailable" on the Leases list.')}</p>
                <PreviewImpactLists preview={preview} />
              </AlertDescription>
            </Alert>
          ) : null}
          {previewError ? (
            <Alert status="error">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{previewError}</span>
                <Button
                  ref={previewRetryRef}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={retryPreview}
                  aria-disabled={previewing || undefined}
                  aria-busy={previewing || undefined}
                  className={previewing ? 'cursor-not-allowed opacity-60' : undefined}
                  data-testid="pm-availability-preview-retry"
                >
                  {t('property_management.common.retry', 'Try again')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert status="error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <p className="text-sm text-muted-foreground">{t('property_management.common.dialogKeys', 'Esc to cancel · ⌘↵ to confirm')}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('property_management.common.cancel', 'Cancel')}</Button>
          <Button type="button" variant="destructive-solid" disabled={!canConfirm} onClick={() => void confirm()} data-testid="pm-availability-confirm">
            {bookingCount > 0
              ? plural('property_management.availability.dialog.confirmCancel', 'Make unavailable · cancel {count} bookings', bookingCount)
              : t('property_management.availability.dialog.confirm', 'Make unavailable')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
