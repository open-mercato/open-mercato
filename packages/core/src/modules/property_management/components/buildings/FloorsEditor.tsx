"use client"

import * as React from 'react'
import Link from 'next/link'
import type { CrudFormGroupComponentProps } from '@open-mercato/ui/backend/CrudForm'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FloorRow } from './buildingRecord'
import { findCountIssue, parseCount, readFloorRows, relayFloorRows } from './floorRows'

export type FloorsEditorProps = CrudFormGroupComponentProps & {
  buildingId: string | null
  savedFloors: readonly FloorRow[]
}

export function FloorsEditor({ values, setValue, errors, buildingId, savedFloors }: FloorsEditorProps) {
  const t = useT()
  const below = parseCount(values.below, 0)
  const above = parseCount(values.above, 1)
  const rows = readFloorRows(values.floors)
  const issue = findCountIssue(savedFloors, below, above)
  const issueMessage = issue
    ? t(
        'property_management.buildings.form.countBlocked',
        'Floor {number} ({name}) still has units on it, so this count cannot go below {minimum}.',
        { number: issue.floor.number, name: issue.floor.name, minimum: issue.minimum },
      )
    : null

  const updateCounts = (nextBelow: number, nextAbove: number) => {
    setValue('below', nextBelow)
    setValue('above', nextAbove)
    setValue('floors', relayFloorRows(rows, nextBelow, nextAbove))
  }

  const updateRow = (number: number, patch: Partial<FloorRow>) => {
    setValue('floors', rows.map((row) => (row.number === number ? { ...row, ...patch } : row)))
  }

  const belowError = (issue?.field === 'below' ? issueMessage : null) ?? errors.below
  const aboveError = (issue?.field === 'above' ? issueMessage : null) ?? errors.above
  const totalSpaces = rows.reduce((sum, row) => sum + row.spaceCount, 0)
  const totalUnits = rows.reduce((sum, row) => sum + row.unitCount, 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="pm-floors-below">{t('property_management.buildings.form.below', 'Floors below ground')}</Label>
          <Input
            id="pm-floors-below"
            type="number"
            min={0}
            value={String(below)}
            aria-invalid={belowError ? true : undefined}
            onChange={(event) => updateCounts(parseCount(event.target.value, 0), above)}
          />
          {belowError ? <p className="text-sm text-status-error-text">{belowError}</p> : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="pm-floors-above">{t('property_management.buildings.form.above', 'Floors above ground')} *</Label>
          <Input
            id="pm-floors-above"
            type="number"
            min={1}
            value={String(above)}
            aria-invalid={aboveError ? true : undefined}
            onChange={(event) => updateCounts(below, Math.max(1, parseCount(event.target.value, 1)))}
          />
          {aboveError ? <p className="text-sm text-status-error-text">{aboveError}</p> : null}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {t(
          'property_management.buildings.form.countsHint',
          'Including the ground floor. Floors are numbered from these counts — 0 is the ground floor, 1 upwards above it, −1 downwards below it.',
        )}
      </p>
      <p className="text-sm text-muted-foreground">
        {t('property_management.buildings.form.floorsSummary', '{floors} floors · {spaces} spaces · {units} units', {
          floors: rows.length,
          spaces: totalSpaces,
          units: totalUnits,
        })}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="pm-floors-table">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-3 font-medium">{t('property_management.buildings.form.floorNumber', 'Floor')}</th>
              <th className="py-2 pr-3 font-medium">{t('property_management.buildings.form.floorName', 'Name')}</th>
              <th className="py-2 pr-3 font-medium">{t('property_management.buildings.form.floorSize', 'Size, x × y (m)')} *</th>
              <th className="py-2 pr-3 font-medium">{t('property_management.buildings.form.floorSpaces', 'Spaces')}</th>
              <th className="py-2 pr-3 font-medium">{t('property_management.buildings.form.floorUnits', 'Units')}</th>
              {buildingId ? <th className="py-2 font-medium"><span className="sr-only">{t('property_management.common.actions', 'Actions')}</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.number} className="border-b border-border" data-testid="pm-floor-row">
                <td className="py-2 pr-3 tabular-nums">{row.number}</td>
                <td className="py-2 pr-3">
                  <Input
                    value={row.name}
                    aria-label={t('property_management.buildings.form.floorNameAria', 'Name of floor {number}', { number: row.number })}
                    placeholder={t('property_management.buildings.form.floorNamePlaceholder', 'e.g. Ground Floor — Reception')}
                    onChange={(event) => updateRow(row.number, { name: event.target.value })}
                  />
                </td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      step="0.5"
                      value={row.sizeX}
                      placeholder="x"
                      aria-label={t('property_management.buildings.form.floorWidthAria', 'Floor {number} width (x), metres', { number: row.number })}
                      onChange={(event) => updateRow(row.number, { sizeX: event.target.value })}
                    />
                    <span className="text-muted-foreground">×</span>
                    <Input
                      type="number"
                      min={0}
                      step="0.5"
                      value={row.sizeY}
                      placeholder="y"
                      aria-label={t('property_management.buildings.form.floorDepthAria', 'Floor {number} depth (y), metres', { number: row.number })}
                      onChange={(event) => updateRow(row.number, { sizeY: event.target.value })}
                    />
                  </div>
                </td>
                <td className="py-2 pr-3 tabular-nums text-muted-foreground">{row.id ? row.spaceCount : 1}</td>
                <td className="py-2 pr-3 tabular-nums text-muted-foreground">{row.unitCount}</td>
                {buildingId ? (
                  <td className="py-2">
                    {row.id ? (
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/backend/property_management/buildings/${buildingId}/floors/${row.id}`}>
                          {t('property_management.buildings.form.openFloor', 'Open floor')}
                        </Link>
                      </Button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {errors.floors ? <p className="text-sm text-status-error-text">{errors.floors}</p> : null}
    </div>
  )
}
