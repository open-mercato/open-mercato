"use client"

import * as React from 'react'
import { Info, X } from 'lucide-react'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { TagInput } from '@open-mercato/ui/primitives/tag-input'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import {
  CalendarPreferences,
  ConflictScope,
  MAX_ACTIVITY_TYPES,
  MAX_EVENT_CATEGORIES,
} from '../../lib/calendar/preferences'
import { SegmentGroup } from './editor/SegmentGroup'

export type CalendarSettingsModalProps = {
  open: boolean
  preferences: CalendarPreferences
  seedActivityTypes: string[]
  onOpenChange(open: boolean): void
  onSave(next: CalendarPreferences): void
}

type ToggleKey = 'showCrmActivities' | 'aiSummaries' | 'conflictWarnings' | 'showWeekends'

// An empty Activity Types list is an intentional floor meaning "surface all
// dictionary types" (see buildEditorCategoryOptions) rather than "surface none" —
// it keeps the editor's category picker usable. So when the stored list is empty
// the modal seeds the dictionary types for display; curating a non-empty subset
// persists and filters the editor as expected.
function buildDraft(preferences: CalendarPreferences, seedActivityTypes: string[]): CalendarPreferences {
  return {
    ...preferences,
    eventCategories: [...preferences.eventCategories],
    activityTypes:
      preferences.activityTypes.length > 0
        ? [...preferences.activityTypes]
        : seedActivityTypes.slice(0, MAX_ACTIVITY_TYPES),
  }
}

export function CalendarSettingsModal({
  open,
  preferences,
  seedActivityTypes,
  onOpenChange,
  onSave,
}: CalendarSettingsModalProps) {
  const t = useT()
  const [draft, setDraft] = React.useState<CalendarPreferences>(() => buildDraft(preferences, seedActivityTypes))
  const openRef = React.useRef(false)

  React.useEffect(() => {
    if (open && !openRef.current) setDraft(buildDraft(preferences, seedActivityTypes))
    openRef.current = open
  }, [open, preferences, seedActivityTypes])

  const handleSave = React.useCallback(() => {
    onSave(draft)
    onOpenChange(false)
  }, [draft, onOpenChange, onSave])

  const handleKeyDown = useDialogKeyHandler({ onConfirm: handleSave })

  const toggle = (key: ToggleKey) => (checked: boolean) => setDraft((current) => ({ ...current, [key]: checked }))

  const toggleRows: Array<{ key: ToggleKey; label: string }> = [
    { key: 'showCrmActivities', label: t('customers.calendar.settings.showCrmActivities', 'Show CRM activities on calendar') },
    { key: 'aiSummaries', label: t('customers.calendar.settings.aiSummaries', 'AI summaries & quick actions') },
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
          <SettingsTagInput
            label={t('customers.calendar.settings.eventCategories', 'Event Categories')}
            maxLabel={t('customers.calendar.settings.max', '(max. {count})', { count: MAX_EVENT_CATEGORIES })}
            hint={t(
              'customers.calendar.settings.eventCategoriesHint',
              'Your own grouping labels (e.g. Team Meeting, Sales Call). Offered when creating an event.',
            )}
            placeholder={t('customers.calendar.settings.addCategory', 'Add a category…')}
            value={draft.eventCategories}
            maxTags={MAX_EVENT_CATEGORIES}
            onChange={(eventCategories) => setDraft((current) => ({ ...current, eventCategories }))}
          />
          <SettingsTagInput
            label={t('customers.calendar.settings.activityTypes', 'Activity Types')}
            maxLabel={t('customers.calendar.settings.max', '(max. {count})', { count: MAX_ACTIVITY_TYPES })}
            hint={t(
              'customers.calendar.settings.activityTypesHint',
              'The activity types your calendar surfaces when creating an event. Seeded from your workspace dictionary.',
            )}
            placeholder={t('customers.calendar.settings.addType', 'Add a type…')}
            value={draft.activityTypes}
            maxTags={MAX_ACTIVITY_TYPES}
            onChange={(activityTypes) => setDraft((current) => ({ ...current, activityTypes }))}
          />
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
                      { value: 'mine', label: t('customers.calendar.settings.conflictScopeMine', 'My meetings only') },
                      { value: 'all', label: t('customers.calendar.settings.conflictScopeAll', 'All org meetings') },
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

type SettingsTagInputProps = {
  label: string
  maxLabel: string
  hint: string
  placeholder: string
  value: string[]
  maxTags: number
  onChange(value: string[]): void
}

function SettingsTagInput({ label, maxLabel, hint, placeholder, value, maxTags, onChange }: SettingsTagInputProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <span className="text-sm font-medium leading-5 text-foreground">{label}</span>
        <span className="text-sm leading-5 text-muted-foreground">{maxLabel}</span>
        <SimpleTooltip content={hint}>
          <span className="inline-flex text-muted-foreground" tabIndex={0} role="img" aria-label={hint}>
            <Info aria-hidden className="size-4" />
          </span>
        </SimpleTooltip>
      </div>
      <TagInput value={value} onChange={onChange} placeholder={placeholder} maxTags={maxTags} aria-label={label} />
    </div>
  )
}
