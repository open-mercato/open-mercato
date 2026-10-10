"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DRIVER_INCENTIVE_TYPE_FALLBACKS, DRIVER_INCENTIVE_TYPE_VALUES, RATE_BASIS_FALLBACKS, RATE_BASIS_VALUES } from '../lib/freightEnums'
import type { ContractRouteRow } from './ContractRoutesSection'

const ENTITY_ID = 'freight_operations:freight_contract_route'
const RESOURCE = 'freight_operations/contract-routes'

export type ContractRouteFormValues = {
  id: string
  lineNumber: string
  origin: string
  destination: string
  rateBasis: string
  rateAmount: string
  minimumCharge: string
  currencyCode: string
  vatRateOverride: string
  isActive: boolean
  includesTolls: boolean
  includesWaiting: boolean
  freeWaitingMinutes: string
  waitingRatePerHour: string
  equipmentType: string
  driverIncentiveType: string
  driverIncentiveValue: string
  effectiveFrom: string
  effectiveTo: string
  updatedAt?: string | null
}

function textOf(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function dateOnly(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : ''
}

export function toRouteFormValues(row: ContractRouteRow): ContractRouteFormValues {
  return {
    id: row.id,
    lineNumber: textOf(row.line_number),
    origin: textOf(row.origin),
    destination: textOf(row.destination),
    rateBasis: textOf(row.rate_basis) || 'per_trip',
    rateAmount: textOf(row.rate_amount),
    minimumCharge: textOf(row.minimum_charge),
    currencyCode: textOf(row.currency_code) || 'SAR',
    vatRateOverride: textOf(row.vat_rate_override),
    isActive: row.is_active !== false,
    includesTolls: Boolean(row.includes_tolls),
    includesWaiting: Boolean(row.includes_waiting),
    freeWaitingMinutes: textOf(row.free_waiting_minutes),
    waitingRatePerHour: textOf(row.waiting_rate_per_hour),
    equipmentType: textOf(row.equipment_type),
    driverIncentiveType: textOf(row.driver_incentive_type) || 'none',
    driverIncentiveValue: textOf(row.driver_incentive_value),
    effectiveFrom: dateOnly(row.effective_from),
    effectiveTo: dateOnly(row.effective_to),
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildRouteFormDefaults(currencyCode = 'SAR'): ContractRouteFormValues {
  return {
    id: '',
    lineNumber: '',
    origin: '',
    destination: '',
    rateBasis: 'per_trip',
    rateAmount: '',
    minimumCharge: '',
    currencyCode,
    vatRateOverride: '',
    isActive: true,
    includesTolls: false,
    includesWaiting: false,
    freeWaitingMinutes: '',
    waitingRatePerHour: '',
    equipmentType: '',
    driverIncentiveType: 'none',
    driverIncentiveValue: '',
    effectiveFrom: '',
    effectiveTo: '',
    updatedAt: null,
  }
}

function optional(value: string): string | null {
  return value && value.trim().length ? value.trim() : null
}

export function toRoutePayload(values: ContractRouteFormValues): Record<string, unknown> {
  return {
    ...(values.lineNumber ? { lineNumber: values.lineNumber } : {}),
    origin: values.origin.trim(),
    destination: values.destination.trim(),
    rateBasis: values.rateBasis || 'per_trip',
    rateAmount: values.rateAmount,
    minimumCharge: optional(values.minimumCharge),
    currencyCode: optional(values.currencyCode) ?? 'SAR',
    vatRateOverride: optional(values.vatRateOverride),
    isActive: values.isActive,
    includesTolls: values.includesTolls,
    includesWaiting: values.includesWaiting,
    freeWaitingMinutes: optional(values.freeWaitingMinutes),
    waitingRatePerHour: optional(values.waitingRatePerHour),
    equipmentType: optional(values.equipmentType),
    driverIncentiveType: values.driverIncentiveType || 'none',
    driverIncentiveValue: values.driverIncentiveType === 'none' ? null : optional(values.driverIncentiveValue),
    effectiveFrom: optional(values.effectiveFrom),
    effectiveTo: optional(values.effectiveTo),
  }
}

function useRouteFields(t: ReturnType<typeof useT>): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'lineNumber',
      label: t('freight_operations.contract_routes.form.fields.lineNumber', 'Line number'),
      type: 'number',
      layout: 'third',
      placeholder: t('freight_operations.contract_routes.form.fields.lineNumberHint', 'Auto'),
    },
    {
      id: 'origin',
      label: t('freight_operations.contract_routes.form.fields.origin', 'Origin'),
      type: 'text',
      required: true,
      layout: 'half',
    },
    {
      id: 'destination',
      label: t('freight_operations.contract_routes.form.fields.destination', 'Destination'),
      type: 'text',
      required: true,
      layout: 'half',
    },
    {
      id: 'rateBasis',
      label: t('freight_operations.contract_routes.form.fields.rateBasis', 'Rate basis'),
      type: 'select',
      layout: 'half',
      options: RATE_BASIS_VALUES.map((value) => ({
        value,
        label: t(`freight_operations.contracts.rate_basis.${value}`, RATE_BASIS_FALLBACKS[value] ?? value),
      })),
    },
    {
      id: 'rateAmount',
      label: t('freight_operations.contract_routes.form.fields.rateAmount', 'Rate (net)'),
      type: 'number',
      required: true,
      layout: 'half',
    },
    {
      id: 'minimumCharge',
      label: t('freight_operations.contract_routes.form.fields.minimumCharge', 'Minimum charge'),
      type: 'number',
      layout: 'third',
    },
    {
      id: 'currencyCode',
      label: t('freight_operations.contract_routes.form.fields.currency', 'Currency'),
      type: 'text',
      layout: 'third',
    },
    {
      id: 'vatRateOverride',
      label: t('freight_operations.contract_routes.form.fields.vatOverride', 'VAT override (%)'),
      type: 'number',
      layout: 'third',
    },
    {
      id: 'effectiveFrom',
      label: t('freight_operations.contract_routes.form.fields.effectiveFrom', 'Effective from'),
      type: 'date',
      layout: 'half',
    },
    {
      id: 'effectiveTo',
      label: t('freight_operations.contract_routes.form.fields.effectiveTo', 'Effective to'),
      type: 'date',
      layout: 'half',
    },
    {
      id: 'includesTolls',
      label: t('freight_operations.contract_routes.form.fields.includesTolls', 'Tolls included'),
      type: 'checkbox',
      layout: 'third',
    },
    {
      id: 'includesWaiting',
      label: t('freight_operations.contract_routes.form.fields.includesWaiting', 'Waiting included'),
      type: 'checkbox',
      layout: 'third',
    },
    {
      id: 'freeWaitingMinutes',
      label: t('freight_operations.contract_routes.form.fields.freeWaiting', 'Free waiting (min)'),
      type: 'number',
      layout: 'third',
    },
    {
      id: 'waitingRatePerHour',
      label: t('freight_operations.contract_routes.form.fields.waitingRate', 'Waiting rate / hour'),
      type: 'number',
      layout: 'half',
    },
    {
      id: 'isActive',
      label: t('freight_operations.contract_routes.form.fields.isActive', 'Active'),
      type: 'checkbox',
      layout: 'half',
    },
    {
      id: 'equipmentType',
      label: t('freight_operations.contract_routes.form.fields.equipmentType', 'Equipment'),
      type: 'text',
      layout: 'half',
      placeholder: t('freight_operations.contract_routes.form.fields.equipmentTypePlaceholder', 'Flatbed 40ft, refrigerated, tanker…'),
    },
    {
      id: 'driverIncentiveType',
      label: t('freight_operations.contract_routes.form.fields.driverIncentiveType', 'Driver incentive'),
      type: 'select',
      layout: 'half',
      options: DRIVER_INCENTIVE_TYPE_VALUES.map((value) => ({
        value,
        label: t(`freight_operations.contract_routes.driver_incentive.${value}`, DRIVER_INCENTIVE_TYPE_FALLBACKS[value] ?? value),
      })),
    },
    {
      id: 'driverIncentiveValue',
      label: t('freight_operations.contract_routes.form.fields.driverIncentiveValue', 'Incentive value'),
      type: 'number',
      layout: 'half',
      description: t(
        'freight_operations.contract_routes.form.fields.driverIncentiveValueHint',
        'An amount, or a percentage when the incentive is a share of the net rate.',
      ),
    },
  ], [t])
}

function useRouteGroups(t: ReturnType<typeof useT>): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'lane',
      title: t('freight_operations.contract_routes.form.groups.lane', 'Lane'),
      column: 1,
      fields: ['lineNumber', 'origin', 'destination', 'effectiveFrom', 'effectiveTo'],
    },
    {
      id: 'rate',
      title: t('freight_operations.contract_routes.form.groups.rate', 'Rate'),
      column: 2,
      fields: ['rateBasis', 'rateAmount', 'minimumCharge', 'currencyCode', 'vatRateOverride'],
    },
    {
      id: 'conditions',
      title: t('freight_operations.contract_routes.form.groups.conditions', 'Included conditions'),
      column: 1,
      fields: ['equipmentType', 'driverIncentiveType', 'driverIncentiveValue', 'includesTolls', 'includesWaiting', 'freeWaitingMinutes', 'waitingRatePerHour', 'isActive'],
    },
  ], [t])
}

export function ContractRouteDialog({
  contractId,
  currencyCode,
  item,
  open,
  onOpenChange,
  onSaved,
}: {
  contractId: string
  currencyCode: string
  item: ContractRouteRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const t = useT()
  const fields = useRouteFields(t)
  const groups = useRouteGroups(t)
  const dialogContentRef = React.useRef<HTMLDivElement | null>(null)

  // CrudForm owns the submit button; the dialog forwards Cmd/Ctrl+Enter to it so
  // the keyboard contract every dialog owes holds without a second handler.
  const handleSubmitForm = React.useCallback(
    () => dialogContentRef.current?.querySelector('form')?.requestSubmit(),
    [],
  )
  const handleKeyDown = useDialogKeyHandler({
    onConfirm: handleSubmitForm,
    onCancel: () => onOpenChange(false),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent ref={dialogContentRef} onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>
            {item
              ? t('freight_operations.contract_routes.form.edit.title', 'Edit rate line')
              : t('freight_operations.contract_routes.form.create.title', 'New rate line')}
          </DialogTitle>
        </DialogHeader>
        <CrudForm<ContractRouteFormValues>
          embedded
          entityId={ENTITY_ID}
          fields={fields}
          groups={groups}
          initialValues={item ? toRouteFormValues(item) : buildRouteFormDefaults(currencyCode)}
          submitLabel={item
            ? t('freight_operations.contract_routes.form.edit.submit', 'Save rate line')
            : t('freight_operations.contract_routes.form.create.submit', 'Create rate line')}
          onSubmit={async (values) => {
            if (item) {
              await updateCrud(RESOURCE, { id: item.id, ...toRoutePayload(values) })
            } else {
              await createCrud(RESOURCE, { contractId, ...toRoutePayload(values) })
            }
            onSaved()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
