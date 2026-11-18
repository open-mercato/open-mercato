"use client"

import * as React from 'react'
import type { CrudFormGroupComponentProps } from '@open-mercato/ui/backend/CrudForm'
import { TimeInput } from '@open-mercato/ui/backend/inputs/TimeInput'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { fallbackClosingTime, MIDNIGHT_CLOSE, readOpeningRows, type OpeningRow } from './openingHoursRows'

function weekdayName(weekday: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + weekday)))
}

export function OpeningHoursEditor({ values, setValue, errors, disabled }: CrudFormGroupComponentProps & { disabled?: boolean }) {
  const t = useT()
  const locale = useLocale()
  const enabled = values.openingHoursEnabled === true
  const rows = readOpeningRows(values.openingRows)

  const updateRow = (weekday: number, patch: Partial<OpeningRow>) => {
    setValue('openingRows', rows.map((row) => (row.weekday === weekday ? { ...row, ...patch } : row)))
  }

  return (
    <div className="space-y-3">
      <SwitchField
        label={t('property_management.buildings.hours.enable', 'Set opening hours')}
        description={t(
          'property_management.buildings.hours.hint',
          'Optional. With opening hours, units can only be booked while the building is open; without them, at any time.',
        )}
        checked={enabled}
        disabled={disabled}
        onCheckedChange={(checked) => setValue('openingHoursEnabled', checked)}
      />
      {enabled ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="pm-opening-hours">
            <tbody>
              {rows.map((row) => {
                const name = weekdayName(row.weekday, locale)
                return (
                  <tr key={row.weekday} className="border-b border-border">
                    <td className="py-2 pr-3 font-medium">{name}</td>
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2">
                        <Switch
                          checked={row.open}
                          disabled={disabled}
                          aria-label={t('property_management.buildings.hours.dayOpen', '{day} open', { day: name })}
                          onCheckedChange={(checked) => updateRow(row.weekday, { open: checked })}
                        />
                        <span className="text-muted-foreground">
                          {row.open ? t('property_management.buildings.hours.open', 'Open') : t('property_management.buildings.hours.closed', 'Closed')}
                        </span>
                      </span>
                    </td>
                    <td className="py-2">
                      {row.open ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <TimeInput
                            value={row.opensAt}
                            minuteStep={15}
                            disabled={disabled}
                            hourLabel={t('property_management.buildings.hours.opensHour', '{day} opens, hour', { day: name })}
                            minuteLabel={t('property_management.buildings.hours.opensMinute', '{day} opens, minute', { day: name })}
                            onChange={(value) => updateRow(row.weekday, { opensAt: value })}
                          />
                          <span className="text-muted-foreground">{t('property_management.buildings.hours.to', 'to')}</span>
                          {row.closesAt === MIDNIGHT_CLOSE ? (
                            <span data-testid={`pm-opening-midnight-${row.weekday}`}>{t('property_management.buildings.hours.midnight', 'midnight')}</span>
                          ) : (
                            <TimeInput
                              value={row.closesAt}
                              minuteStep={15}
                              disabled={disabled}
                              hourLabel={t('property_management.buildings.hours.closesHour', '{day} closes, hour', { day: name })}
                              minuteLabel={t('property_management.buildings.hours.closesMinute', '{day} closes, minute', { day: name })}
                              onChange={(value) => updateRow(row.weekday, { closesAt: value })}
                            />
                          )}
                          <CheckboxField
                            label={t('property_management.buildings.hours.untilMidnight', 'Until midnight')}
                            aria-label={t('property_management.buildings.hours.dayUntilMidnight', '{day} open until midnight', { day: name })}
                            checked={row.closesAt === MIDNIGHT_CLOSE}
                            disabled={disabled}
                            onCheckedChange={(checked) => updateRow(row.weekday, { closesAt: checked === true ? MIDNIGHT_CLOSE : fallbackClosingTime(row.opensAt) })}
                          />
                        </span>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {errors.openingRows ? <p className="text-sm text-status-error-text">{errors.openingRows}</p> : null}
    </div>
  )
}
