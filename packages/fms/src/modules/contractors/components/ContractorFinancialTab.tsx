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
import { Button } from '@open-mercato/ui/primitives/button'
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
  currentExposure: string
  lastCalculatedAt?: string | null
  requiresApprovalAbove?: string | null
  approvedById?: string | null
  approvedAt?: string | null
  notes?: string | null
}

type ContractorFinancialTabProps = {
  contractorId: string
  paymentTerms?: ContractorPaymentTerms | null
  creditLimit?: ContractorCreditLimit | null
  onUpdated: () => void
}

const PAYMENT_METHOD_OPTIONS = [
  { value: '', label: '-' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
]

const PAYMENT_TERMS_COLUMNS: ColumnDef[] = [
  { data: 'paymentDays', title: 'Payment Days', type: 'numeric', width: 110 },
  { data: 'paymentMethod', title: 'Payment Method', type: 'dropdown', source: PAYMENT_METHOD_OPTIONS, width: 130 },
  { data: 'currencyCode', title: 'Currency', type: 'text', width: 80 },
  { data: 'bankName', title: 'Bank Name', type: 'text', width: 150 },
  { data: 'iban', title: 'IBAN', type: 'text', width: 180 },
  { data: 'swiftBic', title: 'SWIFT/BIC', type: 'text', width: 100 },
]

const CREDIT_LIMIT_COLUMNS: ColumnDef[] = [
  { data: 'creditLimit', title: 'Credit Limit', type: 'numeric', width: 120 },
  { data: 'currencyCode', title: 'Currency', type: 'text', width: 80 },
  { data: 'isUnlimited', title: 'Unlimited', type: 'boolean', width: 80 },
  { data: 'currentExposure', title: 'Current Exposure', type: 'numeric', readOnly: true, width: 130 },
  { data: 'requiresApprovalAbove', title: 'Approval Threshold', type: 'numeric', width: 140 },
]

export function ContractorFinancialTab({
  contractorId,
  paymentTerms,
  creditLimit,
  onUpdated,
}: ContractorFinancialTabProps) {
  const paymentTableRef = React.useRef<HTMLDivElement>(null)
  const creditTableRef = React.useRef<HTMLDivElement>(null)
  const t = useT()

  const paymentData = React.useMemo(() => {
    if (!paymentTerms) return []
    return [{
      id: paymentTerms.id,
      paymentDays: paymentTerms.paymentDays,
      paymentMethod: paymentTerms.paymentMethod ?? '',
      currencyCode: paymentTerms.currencyCode,
      bankName: paymentTerms.bankName ?? '',
      iban: paymentTerms.iban ?? '',
      swiftBic: paymentTerms.swiftBic ?? '',
    }]
  }, [paymentTerms])

  const creditData = React.useMemo(() => {
    if (!creditLimit) return []
    return [{
      id: creditLimit.id,
      creditLimit: creditLimit.creditLimit,
      currencyCode: creditLimit.currencyCode,
      isUnlimited: creditLimit.isUnlimited,
      currentExposure: creditLimit.currentExposure,
      requiresApprovalAbove: creditLimit.requiresApprovalAbove ?? '',
    }]
  }, [creditLimit])

  const handleCreatePaymentTerms = async () => {
    try {
      const response = await apiCall('/api/contractors/payment-terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractorId }),
      })

      if (response.ok) {
        flash(t('contractors.drawer.paymentTermsCreated', 'Payment terms created'), 'success')
        onUpdated()
      } else {
        const error = (response.result as { error?: string })?.error ?? 'Creation failed'
        flash(error, 'error')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      flash(errorMessage, 'error')
    }
  }

  const handleCreateCreditLimit = async () => {
    try {
      const response = await apiCall('/api/contractors/credit-limits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractorId, creditLimit: '0' }),
      })

      if (response.ok) {
        flash(t('contractors.drawer.creditLimitCreated', 'Credit limit created'), 'success')
        onUpdated()
      } else {
        const error = (response.result as { error?: string })?.error ?? 'Creation failed'
        flash(error, 'error')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      flash(errorMessage, 'error')
    }
  }

  useEventHandlers(
    {
      [TableEvents.CELL_EDIT_SAVE]: async (payload: CellEditSaveEvent) => {
        const { prop, newValue, oldValue, rowIndex, colIndex, id } = payload

        if (newValue === oldValue) return

        if (paymentTableRef.current) {
          dispatch(paymentTableRef.current, TableEvents.CELL_SAVE_START, { rowIndex, colIndex })
        }

        try {
          const finalValue = newValue === '' ? null : newValue

          const response = await apiCall(`/api/contractors/payment-terms?id=${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [prop]: finalValue }),
          })

          if (response.ok) {
            flash(t('contractors.drawer.paymentTermsUpdated', 'Payment terms updated'), 'success')
            if (paymentTableRef.current) {
              dispatch(paymentTableRef.current, TableEvents.CELL_SAVE_SUCCESS, { rowIndex, colIndex })
            }
            onUpdated()
          } else {
            const error = (response.result as { error?: string })?.error ?? 'Update failed'
            flash(error, 'error')
            if (paymentTableRef.current) {
              dispatch(paymentTableRef.current, TableEvents.CELL_SAVE_ERROR, { rowIndex, colIndex, error })
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          flash(errorMessage, 'error')
          if (paymentTableRef.current) {
            dispatch(paymentTableRef.current, TableEvents.CELL_SAVE_ERROR, { rowIndex, colIndex, error: errorMessage })
          }
        }
      },
    },
    paymentTableRef
  )

  useEventHandlers(
    {
      [TableEvents.CELL_EDIT_SAVE]: async (payload: CellEditSaveEvent) => {
        const { prop, newValue, oldValue, rowIndex, colIndex, id } = payload

        if (newValue === oldValue) return

        if (creditTableRef.current) {
          dispatch(creditTableRef.current, TableEvents.CELL_SAVE_START, { rowIndex, colIndex })
        }

        try {
          const finalValue = newValue === '' ? null : newValue

          const response = await apiCall(`/api/contractors/credit-limits?id=${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [prop]: finalValue }),
          })

          if (response.ok) {
            flash(t('contractors.drawer.creditLimitUpdated', 'Credit limit updated'), 'success')
            if (creditTableRef.current) {
              dispatch(creditTableRef.current, TableEvents.CELL_SAVE_SUCCESS, { rowIndex, colIndex })
            }
            onUpdated()
          } else {
            const error = (response.result as { error?: string })?.error ?? 'Update failed'
            flash(error, 'error')
            if (creditTableRef.current) {
              dispatch(creditTableRef.current, TableEvents.CELL_SAVE_ERROR, { rowIndex, colIndex, error })
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          flash(errorMessage, 'error')
          if (creditTableRef.current) {
            dispatch(creditTableRef.current, TableEvents.CELL_SAVE_ERROR, { rowIndex, colIndex, error: errorMessage })
          }
        }
      },
    },
    creditTableRef
  )

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-700">
            {t('contractors.drawer.paymentTermsSection', 'Payment Terms')}
          </h3>
          {!paymentTerms && (
            <Button size="sm" variant="outline" onClick={handleCreatePaymentTerms}>
              {t('contractors.drawer.addPaymentTerms', 'Add Payment Terms')}
            </Button>
          )}
        </div>
        {paymentTerms ? (
          <DynamicTable
            tableRef={paymentTableRef}
            data={paymentData}
            columns={PAYMENT_TERMS_COLUMNS}
            idColumnName="id"
            tableName="Payment Terms"
            height={100}
            colHeaders={true}
            rowHeaders={false}
            uiConfig={{
              hideToolbar: true,
              hideSearch: true,
              hideFilterButton: true,
              hideAddRowButton: true,
              hideBottomBar: true,
            }}
          />
        ) : (
          <p className="text-sm text-gray-500 italic">
            {t('contractors.drawer.noPaymentTerms', 'No payment terms configured')}
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-700">
            {t('contractors.drawer.creditLimitSection', 'Credit Limit')}
          </h3>
          {!creditLimit && (
            <Button size="sm" variant="outline" onClick={handleCreateCreditLimit}>
              {t('contractors.drawer.addCreditLimit', 'Add Credit Limit')}
            </Button>
          )}
        </div>
        {creditLimit ? (
          <DynamicTable
            tableRef={creditTableRef}
            data={creditData}
            columns={CREDIT_LIMIT_COLUMNS}
            idColumnName="id"
            tableName="Credit Limit"
            height={100}
            colHeaders={true}
            rowHeaders={false}
            uiConfig={{
              hideToolbar: true,
              hideSearch: true,
              hideFilterButton: true,
              hideAddRowButton: true,
              hideBottomBar: true,
            }}
          />
        ) : (
          <p className="text-sm text-gray-500 italic">
            {t('contractors.drawer.noCreditLimit', 'No credit limit configured')}
          </p>
        )}
      </div>
    </div>
  )
}
