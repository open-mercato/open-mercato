'use client'

import * as React from 'react'
import { Plus, Trash2, Star } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'

const USAGE_VALUES = ['stock', 'purchase', 'sales', 'production'] as const
type UnitUsage = (typeof USAGE_VALUES)[number]

type MaterialUnitRow = {
  id: string
  material_id: string
  code: string
  label: string
  usage: UnitUsage
  factor: string
  is_base: boolean
  is_default_for_usage: boolean
  is_active: boolean
  organization_id: string
  tenant_id: string
}

type UnitFormValues = {
  code: string
  label: string
  usage: UnitUsage
  factor: string
  isBase?: boolean
  isDefaultForUsage?: boolean
}

type UnitsTabProps = {
  materialId: string
  organizationId: string
  tenantId: string
}

/**
 * Phase 1 Step 6 — Units management for a single material.
 *
 * - Compact list (no DataTable here — usually 1-5 rows per material).
 * - Inline create/edit dialog. Server enforces base / default-per-usage uniqueness via
 *   partial unique indexes plus command-level rebalance.
 * - Soft-delete with confirm; refuses to drop the last base unit (server returns 409).
 */
export function UnitsTab({ materialId, organizationId, tenantId }: UnitsTabProps) {
  const t = useT()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  const [units, setUnits] = React.useState<MaterialUnitRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [editing, setEditing] = React.useState<MaterialUnitRow | null>(null)
  const [isCreating, setIsCreating] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setLoading(true)
        const fallback = { items: [] as MaterialUnitRow[], total: 0, page: 1, totalPages: 1 }
        const call = await apiCall<{ items: MaterialUnitRow[] }>(
          `/api/material-units?materialId=${encodeURIComponent(materialId)}&pageSize=100`,
          undefined,
          { fallback },
        )
        if (cancelled) return
        if (call.ok && call.result) setUnits(call.result.items ?? [])
        else setUnits([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [materialId, reloadToken])

  const formGroups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'identity',
        column: 1,
        title: t('materials.detail.units.section.identity', 'Identity'),
        fields: [
          {
            id: 'code',
            type: 'text',
            label: t('materials.detail.units.field.code', 'Code'),
            placeholder: 'KG / PCS / PALLET',
            required: true,
            maxLength: 16,
          },
          {
            id: 'label',
            type: 'text',
            label: t('materials.detail.units.field.label', 'Label'),
            required: true,
            maxLength: 64,
          },
          {
            id: 'usage',
            type: 'select',
            label: t('materials.detail.units.field.usage', 'Usage'),
            required: true,
            options: USAGE_VALUES.map((u) => ({ value: u, label: t(`materials.unit.usage.${u}`, u) })),
          },
        ],
      },
      {
        id: 'conversion',
        column: 2,
        title: t('materials.detail.units.section.conversion', 'Conversion'),
        description: t(
          'materials.detail.units.section.conversion.help',
          'Factor multiplies this unit to the material base unit. Base units always have factor 1.',
        ),
        fields: [
          {
            id: 'factor',
            type: 'text',
            label: t('materials.detail.units.field.factor', 'Conversion factor'),
            placeholder: '1.000000',
            required: true,
            helpText: t(
              'materials.detail.units.field.factor.help',
              'Positive number with up to 6 decimals. Ignored when "Base unit" is on (forced to 1).',
            ),
          },
          {
            id: 'isBase',
            type: 'checkbox',
            label: t('materials.detail.units.field.isBase', 'Base unit (max one per material)'),
          },
          {
            id: 'isDefaultForUsage',
            type: 'checkbox',
            label: t(
              'materials.detail.units.field.isDefaultForUsage',
              'Default for this usage (max one per usage)',
            ),
          },
        ],
      },
    ],
    [t],
  )

  const startCreate = React.useCallback(() => {
    setEditing(null)
    setIsCreating(true)
  }, [])

  const startEdit = React.useCallback((unit: MaterialUnitRow) => {
    setIsCreating(false)
    setEditing(unit)
  }, [])

  const closeDialog = React.useCallback(() => {
    setEditing(null)
    setIsCreating(false)
  }, [])

  const submitForm = React.useCallback(
    async (values: UnitFormValues) => {
      setSaving(true)
      try {
        const body: Record<string, unknown> = {
          materialId,
          organizationId,
          tenantId,
          code: values.code.trim(),
          label: values.label.trim(),
          usage: values.usage,
          factor: values.factor?.trim() ?? '1',
          isBase: !!values.isBase,
          isDefaultForUsage: !!values.isDefaultForUsage,
        }
        if (editing) {
          await apiCallOrThrow('/api/material-units', {
            method: 'PUT',
            body: JSON.stringify({ ...body, id: editing.id }),
            headers: { 'content-type': 'application/json' },
          })
          flash(t('materials.detail.units.update.success', 'Unit updated'), 'success')
        } else {
          await apiCallOrThrow('/api/material-units', {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'content-type': 'application/json' },
          })
          flash(t('materials.detail.units.create.success', 'Unit created'), 'success')
        }
        closeDialog()
        setReloadToken((x) => x + 1)
      } catch {
        flash(
          editing
            ? t('materials.detail.units.update.error', 'Failed to update unit')
            : t('materials.detail.units.create.error', 'Failed to create unit'),
          'error',
        )
      } finally {
        setSaving(false)
      }
    },
    [closeDialog, editing, materialId, organizationId, t, tenantId],
  )

  const removeUnit = React.useCallback(
    async (unit: MaterialUnitRow) => {
      const confirmed = await confirmDialog({
        title: t('materials.detail.units.delete.title', 'Delete unit?'),
        description: t(
          'materials.detail.units.delete.description',
          'Unit "{{code}}" will be soft-deleted. The base unit cannot be deleted while other units exist.',
        ).replace('{{code}}', unit.code),
        confirmLabel: t('materials.detail.units.delete.confirm', 'Delete'),
        cancelLabel: t('materials.detail.units.delete.cancel', 'Cancel'),
        variant: 'destructive',
      })
      if (!confirmed) return
      try {
        const result = await apiCall<{ ok: boolean; error?: string }>(
          `/api/material-units?id=${encodeURIComponent(unit.id)}`,
          { method: 'DELETE' },
        )
        if (!result.ok) {
          const message = (result.result as any)?.error ?? t('materials.detail.units.delete.error', 'Failed to delete unit')
          flash(message, 'error')
          return
        }
        flash(t('materials.detail.units.delete.success', 'Unit deleted'), 'success')
        setReloadToken((x) => x + 1)
      } catch {
        flash(t('materials.detail.units.delete.error', 'Failed to delete unit'), 'error')
      }
    },
    [confirmDialog, t],
  )

  const initialValues = React.useMemo<UnitFormValues>(
    () =>
      editing
        ? {
            code: editing.code,
            label: editing.label,
            usage: editing.usage,
            factor: editing.factor,
            isBase: editing.is_base,
            isDefaultForUsage: editing.is_default_for_usage,
          }
        : {
            code: '',
            label: '',
            usage: 'stock',
            factor: '1',
            isBase: units.length === 0,
            isDefaultForUsage: false,
          },
    [editing, units.length],
  )

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t('materials.detail.units.title', 'Units')}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t(
              'materials.detail.units.description',
              'Measurement units for this material. Each material has exactly one base unit; other units convert to the base via the factor. Each usage (stock/purchase/sales/production) may have one default unit.',
            )}
          </p>
        </div>
        <Button size="sm" className="gap-1" onClick={startCreate}>
          <Plus className="h-4 w-4" />
          {t('materials.detail.units.add', 'Add unit')}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" />
          {t('materials.detail.units.loading', 'Loading units…')}
        </div>
      ) : units.length === 0 ? (
        <p className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
          {t(
            'materials.detail.units.empty',
            'No units yet. Add the base unit first (e.g. KG, PCS) — every material needs one.',
          )}
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">{t('materials.detail.units.column.code', 'Code')}</th>
                <th className="px-3 py-2">{t('materials.detail.units.column.label', 'Label')}</th>
                <th className="px-3 py-2">{t('materials.detail.units.column.usage', 'Usage')}</th>
                <th className="px-3 py-2 text-right">
                  {t('materials.detail.units.column.factor', 'Factor')}
                </th>
                <th className="px-3 py-2">{t('materials.detail.units.column.flags', 'Flags')}</th>
                <th className="px-3 py-2 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {units.map((unit) => (
                <tr key={unit.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono text-xs">{unit.code}</td>
                  <td className="px-3 py-2">{unit.label}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline">
                      {t(`materials.unit.usage.${unit.usage}`, unit.usage)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{unit.factor}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      {unit.is_base ? (
                        <Badge className="gap-1">
                          <Star className="h-3 w-3" />
                          {t('materials.detail.units.flag.base', 'Base')}
                        </Badge>
                      ) : null}
                      {unit.is_default_for_usage ? (
                        <Badge variant="secondary">
                          {t('materials.detail.units.flag.default', 'Default')}
                        </Badge>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(unit)}>
                        {t('materials.detail.units.actions.edit', 'Edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeUnit(unit)}
                        aria-label={t('materials.detail.units.actions.delete', 'Delete unit')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={isCreating || editing !== null} onOpenChange={(open) => (open ? null : closeDialog())}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t('materials.detail.units.dialog.editTitle', 'Edit unit')
                : t('materials.detail.units.dialog.createTitle', 'Add unit')}
            </DialogTitle>
          </DialogHeader>
          <CrudForm<UnitFormValues>
            groups={formGroups}
            initialValues={initialValues}
            submitLabel={
              editing
                ? t('materials.detail.units.dialog.save', 'Save changes')
                : t('materials.detail.units.dialog.create', 'Create unit')
            }
            onSubmit={submitForm}
          />
          {saving ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner size="sm" />
              {t('materials.detail.units.dialog.saving', 'Saving…')}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {ConfirmDialogElement}
    </div>
  )
}

export default UnitsTab
