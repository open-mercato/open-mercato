"use client"

import * as React from 'react'
import { X } from 'lucide-react'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { CalendarPreferences, ConflictScope } from '../../lib/calendar/preferences'
import { getCustomerDictionaryManageHref } from '../../lib/dictionaries'
import { SegmentGroup } from './editor/SegmentGroup'

export type CalendarSettingsModalProps = {
  open: boolean
  preferences: CalendarPreferences
  seedActivityTypes: string[]
  onOpenChange(open: boolean): void
  onSave(next: CalendarPreferences): void
}

type ToggleKey = 'showCrmActivities' | 'aiSummaries' | 'conflictWarnings' | 'showWeekends'

export function CalendarSettingsModal({
  open,
  preferences,
  onOpenChange,
  onSave,
}: CalendarSettingsModalProps) {
  const t = useT()
  const [draft, setDraft] = React.useState<CalendarPreferences>(preferences)
  const openRef = React.useRef(false)

  React.useEffect(() => {
    if (open && !openRef.current) setDraft(preferences)
    openRef.current = open
  }, [open, preferences])

  const handleSave = React.useCallback(() => {
    onSave(draft)
    onOpenChange(false)
  }, [draft, onOpenChange, onSave])

  const handleKeyDown = useDialogKeyHandler({ onConfirm: handleSave })

  const toggle = (key: ToggleKey) => (checked: boolean) => setDraft((current) => ({ ...current, [key]: checked }))

  const toggleRows: Array<{ key: ToggleKey; label: string }> = [
    { key: 'showCrmActivities', label: t('customers.calendar.settings.showCrmActivities', 'Show CRM activities on calendar') },
    { key: 'aiSummaries', label: t('customers.calendar.settings.aiSummaries', 'AI summaries') },
    { key: 'conflictWarnings', label: t('customers.calendar.settings.conflictWarnings', 'Conflict warnings') },
    { key: 'showWeekends', label: t('customers.calendar.settings.showWeekends', 'Show weekends') },
  ]

  const title = t('customers.calendar.settings.title', 'Customization')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={handleKeyDown}
        aria-describedby={undefined}
        dismissible={false}
        className="flex w-full max-w-[400px] flex-col gap-0 overflow-hidden rounded-2xl border-0 bg-card p-0 shadow-xl"
      >
        <VisuallyHidden>
          <DialogTitle>{title}</DialogTitle>
        </VisuallyHidden>
        <div className="flex shrink-0 items-start gap-3.5 border-b border-border py-4 pl-5 pr-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-sm font-medium leading-5 text-foreground">{title}</p>
            <p className="text-xs leading-4 text-muted-foreground">
              {t('customers.calendar.settings.subtitle', 'Customise your calendar module.')}
            </p>
          </div>
          <IconButton
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            aria-label={t('customers.calendar.settings.close', 'Close')}
            className="shrink-0 text-muted-foreground"
          >
            <X aria-hidden className="size-5" />
          </IconButton>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-foreground">
              {t('customers.calendar.settings.activityTypes', 'Activity Types')}
            </span>
            <Button type="button" variant="outline" size="sm" asChild>
              <a href={getCustomerDictionaryManageHref('activity-types')}>
                {t('customers.calendar.settings.manageActivityTypes', 'Manage activity types')}
              </a>
            </Button>
          </div>
          {toggleRows.map((row) => (
            <React.Fragment key={row.key}>
              <div className="flex items-center gap-2">
                <Switch
                  checked={draft[row.key]}
                  onCheckedChange={toggle(row.key)}
                  aria-label={row.label}
                />
                <span className="text-sm leading-5 text-foreground">{row.label}</span>
              </div>
              {row.key === 'conflictWarnings' && draft.conflictWarnings ? (
                <div className="flex flex-col gap-1.5 pl-11">
                  <span className="text-xs leading-4 text-muted-foreground">
                    {t(
                      'customers.calendar.settings.conflictScopeHint',
                      'Choose whose overlaps the calendar flags as conflicts.',
                    )}
                  </span>
                  <SegmentGroup<ConflictScope>
                    ariaLabel={t('customers.calendar.settings.conflictScope', 'Conflict scope')}
                    value={draft.conflictScope}
                    onChange={(conflictScope) => setDraft((current) => ({ ...current, conflictScope }))}
                    options={[
                      { value: 'mine', label: t('customers.calendar.settings.conflictScopeMine', 'My meetings') },
                      { value: 'all', label: t('customers.calendar.settings.conflictScopeAll', 'All meetings') },
                    ]}
                  />
                </div>
              ) : null}
            </React.Fragment>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-border px-5 py-4">
          <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            {t('customers.calendar.settings.cancel', 'Cancel')}
          </Button>
          <Button type="button" className="flex-1" onClick={handleSave}>
            {t('customers.calendar.settings.save', 'Save Changes')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
