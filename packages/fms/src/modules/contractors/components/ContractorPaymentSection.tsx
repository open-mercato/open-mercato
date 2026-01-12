'use client'

import * as React from 'react'
import {
  DynamicTable,
  TableEvents,
  dispatch,
  useEventHandlers,
  type ColumnDef,
  type CellEditSaveEvent,
} from '@open-mercato/ui/backend/dynamic-table'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'

type ContractorPaymentTerms = {
  id: string
  paymentDays: number
  paymentMethod?: string | null
  currencyCode: string
  bankName?: string | null
  bankAccountNumber?: string | null
  bankRoutingNumber?: string | null
  iban?: string | null
  swiftBic?: string | null
  notes?: string | null
}

type ContractorCreditLimit = {
  id: string
  creditLimit: string
  currencyCode: string
  isUnlimited: boolean
  notes?: string | null
}

type ContractorPaymentSectionProps = {
  contractorId: string
  taxId?: string | null
  paymentTerms?: ContractorPaymentTerms | null
  creditLimit?: ContractorCreditLimit | null
  onUpdated: () => void
}

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
  { value: 'GBP', label: 'GBP' },
  { value: 'PLN', label: 'PLN' },
]

const CREDIT_LIMIT_FIELDS = ['creditLimit', 'currencyCode']
const CONTRACTOR_FIELDS = ['taxId']

export function ContractorPaymentSection({
  contractorId,
  taxId,
  paymentTerms,
  creditLimit,
  onUpdated,
}: ContractorPaymentSectionProps) {
  const tableRef = React.useRef<HTMLDivElement>(null)
  const t = useT()

  const columns: ColumnDef[] = React.useMemo(() => [
    { data: 'taxId', title: 'Tax ID', type: 'text', width: 140 },
    { data: 'creditLimit', title: 'Credit Limit', type: 'numeric', width: 120 },
    { data: 'currencyCode', title: 'Currency', type: 'dropdown', source: CURRENCY_OPTIONS, width: 100 },
    { data: 'paymentDays', title: 'Payment Days', type: 'numeric', numericFormat: { pattern: '0' }, width: 110 },
  ], [])

  const tableData = React.useMemo(() => {
    return [{
      creditLimitId: creditLimit?.id ?? '',
      paymentTermsId: paymentTerms?.id ?? '',
      taxId: taxId ?? '',
      creditLimit: creditLimit?.creditLimit ?? '',
      currencyCode: creditLimit?.currencyCode ?? 'USD',
      paymentDays: paymentTerms?.paymentDays ?? 30,
    }]
  }, [creditLimit, paymentTerms, taxId])

  useEventHandlers(
    {
      [TableEvents.CELL_EDIT_SAVE]: async (payload: CellEditSaveEvent) => {
        const { prop, newValue, oldValue, rowIndex, colIndex } = payload

        if (newValue === oldValue) return

        if (tableRef.current) {
          dispatch(tableRef.current, TableEvents.CELL_SAVE_START, { rowIndex, colIndex })
        }

        try {
          const finalValue = newValue === '' ? null : newValue
          const isCreditLimitField = CREDIT_LIMIT_FIELDS.includes(prop)
          const isContractorField = CONTRACTOR_FIELDS.includes(prop)

          if (isContractorField) {
            const response = await apiCall(`/api/contractors/contractors/${contractorId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [prop]: finalValue }),
            })

            if (response.ok) {
              flash(t('contractors.drawer.contractorUpdated', 'Contractor updated'), 'success')
              if (tableRef.current) {
                dispatch(tableRef.current, TableEvents.CELL_SAVE_SUCCESS, { rowIndex, colIndex })
              }
              onUpdated()
            } else {
              const error = (response.result as { error?: string })?.error ?? 'Update failed'
              flash(error, 'error')
              if (tableRef.current) {
                dispatch(tableRef.current, TableEvents.CELL_SAVE_ERROR, { rowIndex, colIndex, error })
              }
            }
          } else if (isCreditLimitField) {
            const id = creditLimit?.id
            if (id) {
              const response = await apiCall(`/api/contractors/credit-limits?id=${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contractorId, [prop]: finalValue }),
              })

              if (response.ok) {
                flash(t('contractors.drawer.creditLimitUpdated', 'Credit limit updated'), 'success')
                if (tableRef.current) {
                  dispatch(tableRef.current, TableEvents.CELL_SAVE_SUCCESS, { rowIndex, colIndex })
                }
                onUpdated()
              } else {
                const error = (response.result as { error?: string })?.error ?? 'Update failed'
                flash(error, 'error')
                if (tableRef.current) {
                  dispatch(tableRef.current, TableEvents.CELL_SAVE_ERROR, { rowIndex, colIndex, error })
                }
              }
            } else {
              const response = await apiCall<{ id: string; error?: string }>('/api/contractors/credit-limits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  [prop]: finalValue,
                  contractorId,
                }),
              })

              if (response.ok && response.result) {
                flash(t('contractors.drawer.creditLimitCreated', 'Credit limit created'), 'success')
                if (tableRef.current) {
                  dispatch(tableRef.current, TableEvents.CELL_SAVE_SUCCESS, { rowIndex, colIndex })
                }
                onUpdated()
              } else {
                const error = response.result?.error ?? 'Creation failed'
                flash(error, 'error')
                if (tableRef.current) {
                  dispatch(tableRef.current, TableEvents.CELL_SAVE_ERROR, { rowIndex, colIndex, error })
                }
              }
            }
          } else {
            const id = paymentTerms?.id
            if (id) {
              const response = await apiCall(`/api/contractors/payment-terms?id=${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contractorId, [prop]: finalValue }),
              })

              if (response.ok) {
                flash(t('contractors.drawer.paymentTermsUpdated', 'Payment terms updated'), 'success')
                if (tableRef.current) {
                  dispatch(tableRef.current, TableEvents.CELL_SAVE_SUCCESS, { rowIndex, colIndex })
                }
                onUpdated()
              } else {
                const error = (response.result as { error?: string })?.error ?? 'Update failed'
                flash(error, 'error')
                if (tableRef.current) {
                  dispatch(tableRef.current, TableEvents.CELL_SAVE_ERROR, { rowIndex, colIndex, error })
                }
              }
            } else {
              const response = await apiCall<{ id: string; error?: string }>('/api/contractors/payment-terms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  [prop]: finalValue,
                  contractorId,
                }),
              })

              if (response.ok && response.result) {
                flash(t('contractors.drawer.paymentTermsCreated', 'Payment terms created'), 'success')
                if (tableRef.current) {
                  dispatch(tableRef.current, TableEvents.CELL_SAVE_SUCCESS, { rowIndex, colIndex })
                }
                onUpdated()
              } else {
                const error = response.result?.error ?? 'Creation failed'
                flash(error, 'error')
                if (tableRef.current) {
                  dispatch(tableRef.current, TableEvents.CELL_SAVE_ERROR, { rowIndex, colIndex, error })
                }
              }
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          flash(errorMessage, 'error')
          if (tableRef.current) {
            dispatch(tableRef.current, TableEvents.CELL_SAVE_ERROR, { rowIndex, colIndex, error: errorMessage })
          }
        }
      },
    },
    tableRef
  )

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        {t('contractors.drawer.paymentDetailsSection', 'Payment Details')}
      </h3>
      <DynamicTable
        tableRef={tableRef}
        data={tableData}
        columns={columns}
        idColumnName="creditLimitId"
        tableName=""
        height={64}
        colHeaders={true}
        rowHeaders={false}
        stretchColumns={true}
        uiConfig={{
          hideToolbar: true,
          hideSearch: true,
          hideFilterButton: true,
          hideAddRowButton: true,
          hideBottomBar: true,
          hideActionsColumn: true,
        }}
      />
    </div>
  )
}
