'use client'

import * as React from 'react'
import {
  DynamicTable,
  TableEvents,
  dispatch,
  useEventHandlers,
  type ColumnDef,
  type CellEditSaveEvent,
  type NewRowSaveEvent,
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

export function ContractorPaymentSection({
  contractorId,
  paymentTerms,
  creditLimit,
  onUpdated,
}: ContractorPaymentSectionProps) {
  const creditLimitTableRef = React.useRef<HTMLDivElement>(null)
  const paymentTermsTableRef = React.useRef<HTMLDivElement>(null)
  const t = useT()

  const creditLimitColumns: ColumnDef[] = React.useMemo(() => [
    { data: 'creditLimit', title: 'Credit Limit', type: 'numeric', width: 120 },
    { data: 'currencyCode', title: 'Currency', type: 'dropdown', source: CURRENCY_OPTIONS, width: 100 },
  ], [])

  const paymentTermsColumns: ColumnDef[] = React.useMemo(() => [
    { data: 'paymentDays', title: 'Payment Days', type: 'numeric', width: 110 },
    { data: 'currencyCode', title: 'Currency', type: 'dropdown', source: CURRENCY_OPTIONS, width: 100 },
  ], [])

  const creditLimitData = React.useMemo(() => {
    if (!creditLimit) {
      return [{
        id: '',
        creditLimit: '',
        currencyCode: 'USD',
        isUnlimited: false,
        notes: '',
      }]
    }
    return [{
      id: creditLimit.id,
      creditLimit: creditLimit.creditLimit,
      currencyCode: creditLimit.currencyCode,
      isUnlimited: creditLimit.isUnlimited,
      notes: creditLimit.notes ?? '',
    }]
  }, [creditLimit])

  const paymentTermsData = React.useMemo(() => {
    if (!paymentTerms) {
      return [{
        id: '',
        paymentDays: 30,
        paymentMethod: '',
        currencyCode: 'USD',
        bankName: '',
        bankAccountNumber: '',
        bankRoutingNumber: '',
        iban: '',
        swiftBic: '',
        notes: '',
      }]
    }
    return [{
      id: paymentTerms.id,
      paymentDays: paymentTerms.paymentDays,
      paymentMethod: paymentTerms.paymentMethod ?? '',
      currencyCode: paymentTerms.currencyCode,
      bankName: paymentTerms.bankName ?? '',
      bankAccountNumber: paymentTerms.bankAccountNumber ?? '',
      bankRoutingNumber: paymentTerms.bankRoutingNumber ?? '',
      iban: paymentTerms.iban ?? '',
      swiftBic: paymentTerms.swiftBic ?? '',
      notes: paymentTerms.notes ?? '',
    }]
  }, [paymentTerms])

  useEventHandlers(
    {
      [TableEvents.CELL_EDIT_SAVE]: async (payload: CellEditSaveEvent) => {
        const { prop, newValue, oldValue, rowIndex, colIndex, id } = payload

        if (newValue === oldValue) return

        if (creditLimitTableRef.current) {
          dispatch(creditLimitTableRef.current, TableEvents.CELL_SAVE_START, { rowIndex, colIndex })
        }

        try {
          const finalValue = newValue === '' ? null : newValue

          if (id) {
            const response = await apiCall(`/api/contractors/credit-limits?id=${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [prop]: finalValue }),
            })

            if (response.ok) {
              flash(t('contractors.drawer.creditLimitUpdated', 'Credit limit updated'), 'success')
              if (creditLimitTableRef.current) {
                dispatch(creditLimitTableRef.current, TableEvents.CELL_SAVE_SUCCESS, { rowIndex, colIndex })
              }
              onUpdated()
            } else {
              const error = (response.result as { error?: string })?.error ?? 'Update failed'
              flash(error, 'error')
              if (creditLimitTableRef.current) {
                dispatch(creditLimitTableRef.current, TableEvents.CELL_SAVE_ERROR, { rowIndex, colIndex, error })
              }
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          flash(errorMessage, 'error')
          if (creditLimitTableRef.current) {
            dispatch(creditLimitTableRef.current, TableEvents.CELL_SAVE_ERROR, { rowIndex, colIndex, error: errorMessage })
          }
        }
      },

      [TableEvents.NEW_ROW_SAVE]: async (payload: NewRowSaveEvent) => {
        const { rowData, rowIndex } = payload

        const filteredRowData = Object.fromEntries(
          Object.entries(rowData).filter(([_, value]) => value !== '')
        )

        try {
          const response = await apiCall<{ id: string; error?: string }>('/api/contractors/credit-limits', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...filteredRowData,
              contractorId,
            }),
          })

          if (response.ok && response.result) {
            flash(t('contractors.drawer.creditLimitCreated', 'Credit limit created'), 'success')
            if (creditLimitTableRef.current) {
              dispatch(creditLimitTableRef.current, TableEvents.NEW_ROW_SAVE_SUCCESS, {
                rowIndex,
                savedRowData: { ...rowData, id: response.result.id },
              })
            }
            onUpdated()
          } else {
            const error = response.result?.error ?? 'Creation failed'
            flash(error, 'error')
            if (creditLimitTableRef.current) {
              dispatch(creditLimitTableRef.current, TableEvents.NEW_ROW_SAVE_ERROR, { rowIndex, error })
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          flash(errorMessage, 'error')
          if (creditLimitTableRef.current) {
            dispatch(creditLimitTableRef.current, TableEvents.NEW_ROW_SAVE_ERROR, { rowIndex, error: errorMessage })
          }
        }
      },
    },
    creditLimitTableRef
  )

  useEventHandlers(
    {
      [TableEvents.CELL_EDIT_SAVE]: async (payload: CellEditSaveEvent) => {
        const { prop, newValue, oldValue, rowIndex, colIndex, id } = payload

        if (newValue === oldValue) return

        if (paymentTermsTableRef.current) {
          dispatch(paymentTermsTableRef.current, TableEvents.CELL_SAVE_START, { rowIndex, colIndex })
        }

        try {
          const finalValue = newValue === '' ? null : newValue

          if (id) {
            const response = await apiCall(`/api/contractors/payment-terms?id=${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [prop]: finalValue }),
            })

            if (response.ok) {
              flash(t('contractors.drawer.paymentTermsUpdated', 'Payment terms updated'), 'success')
              if (paymentTermsTableRef.current) {
                dispatch(paymentTermsTableRef.current, TableEvents.CELL_SAVE_SUCCESS, { rowIndex, colIndex })
              }
              onUpdated()
            } else {
              const error = (response.result as { error?: string })?.error ?? 'Update failed'
              flash(error, 'error')
              if (paymentTermsTableRef.current) {
                dispatch(paymentTermsTableRef.current, TableEvents.CELL_SAVE_ERROR, { rowIndex, colIndex, error })
              }
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          flash(errorMessage, 'error')
          if (paymentTermsTableRef.current) {
            dispatch(paymentTermsTableRef.current, TableEvents.CELL_SAVE_ERROR, { rowIndex, colIndex, error: errorMessage })
          }
        }
      },

      [TableEvents.NEW_ROW_SAVE]: async (payload: NewRowSaveEvent) => {
        const { rowData, rowIndex } = payload

        const filteredRowData = Object.fromEntries(
          Object.entries(rowData).filter(([_, value]) => value !== '')
        )

        try {
          const response = await apiCall<{ id: string; error?: string }>('/api/contractors/payment-terms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...filteredRowData,
              contractorId,
            }),
          })

          if (response.ok && response.result) {
            flash(t('contractors.drawer.paymentTermsCreated', 'Payment terms created'), 'success')
            if (paymentTermsTableRef.current) {
              dispatch(paymentTermsTableRef.current, TableEvents.NEW_ROW_SAVE_SUCCESS, {
                rowIndex,
                savedRowData: { ...rowData, id: response.result.id },
              })
            }
            onUpdated()
          } else {
            const error = response.result?.error ?? 'Creation failed'
            flash(error, 'error')
            if (paymentTermsTableRef.current) {
              dispatch(paymentTermsTableRef.current, TableEvents.NEW_ROW_SAVE_ERROR, { rowIndex, error })
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          flash(errorMessage, 'error')
          if (paymentTermsTableRef.current) {
            dispatch(paymentTermsTableRef.current, TableEvents.NEW_ROW_SAVE_ERROR, { rowIndex, error: errorMessage })
          }
        }
      },
    },
    paymentTermsTableRef
  )

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">
          {t('contractors.drawer.creditLimitSection', 'Credit Limit')}
        </h3>
        <DynamicTable
          tableRef={creditLimitTableRef}
          data={creditLimitData}
          columns={creditLimitColumns}
          idColumnName="id"
          tableName="CreditLimit"
          height={115}
          colHeaders={true}
          rowHeaders={false}
          uiConfig={{
            hideToolbar: false,
            hideSearch: true,
            hideFilterButton: true,
            hideAddRowButton: true,
            hideBottomBar: true,
          }}
        />
      </div>
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">
          {t('contractors.drawer.paymentTermsSection', 'Payment Terms')}
        </h3>
        <DynamicTable
          tableRef={paymentTermsTableRef}
          data={paymentTermsData}
          columns={paymentTermsColumns}
          idColumnName="id"
          tableName="PaymentTerms"
          height={115}
          colHeaders={true}
          rowHeaders={false}
          uiConfig={{
            hideToolbar: false,
            hideSearch: true,
            hideFilterButton: true,
            hideAddRowButton: true,
            hideBottomBar: true,
          }}
        />
      </div>
    </div>
  )
}
