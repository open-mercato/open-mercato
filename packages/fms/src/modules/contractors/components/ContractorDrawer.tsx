'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Maximize2, Minimize2 } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@open-mercato/ui/primitives/sheet'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@/lib/i18n/context'
import { ContractorAddressesTab } from './ContractorAddressesTab'
import { ContractorContactsTab } from './ContractorContactsTab'
import { ContractorPaymentSection } from './ContractorPaymentSection'

type ContractorAddress = {
  id: string
  purpose: string
  label?: string | null
  addressLine: string
  city: string
  state?: string | null
  postalCode?: string | null
  countryCode: string
  isPrimary: boolean
  isActive: boolean
}

type ContractorContact = {
  id: string
  firstName: string
  lastName: string
  email?: string | null
  phone?: string | null
  isPrimary: boolean
  isActive: boolean
}

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

export type ContractorDetail = {
  id: string
  name: string
  shortName?: string | null
  parentId?: string | null
  taxId?: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  addresses: ContractorAddress[]
  contacts: ContractorContact[]
  paymentTerms?: ContractorPaymentTerms | null
  creditLimit?: ContractorCreditLimit | null
}

export type ContractorDrawerProps = {
  contractorId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onContractorUpdated?: () => void
}

export function ContractorDrawer({
  contractorId,
  open,
  onOpenChange,
  onContractorUpdated,
}: ContractorDrawerProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const [isFullscreen, setIsFullscreen] = React.useState(false)

  // Reset fullscreen when drawer closes
  React.useEffect(() => {
    if (!open) {
      setIsFullscreen(false)
    }
  }, [open])

  const { data: contractor, isLoading, error, refetch } = useQuery({
    queryKey: ['contractor', contractorId],
    queryFn: async () => {
      if (!contractorId) return null
      const response = await apiCall<ContractorDetail>(`/api/contractors/contractors/${contractorId}`)
      if (!response.ok) throw new Error('Failed to load contractor')
      return response.result
    },
    enabled: !!contractorId && open,
  })

  const handleContractorUpdated = React.useCallback(() => {
    refetch()
    queryClient.invalidateQueries({ queryKey: ['contractors'] })
    onContractorUpdated?.()
  }, [refetch, queryClient, onContractorUpdated])

  const displayTitle = contractor?.name ?? t('contractors.drawer.title', 'Contractor')

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col p-0 transition-[width,max-width] duration-300 ease-in-out"
        style={{
          width: isFullscreen ? '100vw' : '64rem',
          maxWidth: isFullscreen ? '100vw' : '64rem',
        }}
        overlayClassName="backdrop-blur-none"
      >
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 p-6">
            <Spinner className="h-6 w-6" />
            <span className="text-sm text-gray-500">
              {t('contractors.drawer.loading', 'Loading contractor...')}
            </span>
          </div>
        ) : error || !contractor ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 p-6">
            <p className="text-sm text-gray-500">
              {error instanceof Error ? error.message : t('contractors.drawer.notFound', 'Contractor not found')}
            </p>
          </div>
        ) : (
          <>
            <div className="flex-shrink-0 p-6 border-b">
              <SheetHeader>
                <div className="flex items-center gap-3">
                  <div className="bg-blue-500 rounded p-2">
                    <Building2 className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <SheetTitle className="text-lg">{displayTitle}</SheetTitle>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsFullscreen(!isFullscreen)}
                    className="p-2 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                    title={isFullscreen
                      ? t('contractors.drawer.exitFullscreen', 'Exit fullscreen')
                      : t('contractors.drawer.fullscreen', 'Fullscreen')}
                  >
                    {isFullscreen ? (
                      <Minimize2 className="w-4 h-4" />
                    ) : (
                      <Maximize2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </SheetHeader>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <ContractorAddressesTab
                contractorId={contractor.id}
                addresses={contractor.addresses}
                onUpdated={handleContractorUpdated}
              />
              <ContractorContactsTab
                contractorId={contractor.id}
                contacts={contractor.contacts}
                onUpdated={handleContractorUpdated}
              />
              <ContractorPaymentSection
                contractorId={contractor.id}
                paymentTerms={contractor.paymentTerms}
                creditLimit={contractor.creditLimit}
                onUpdated={handleContractorUpdated}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
