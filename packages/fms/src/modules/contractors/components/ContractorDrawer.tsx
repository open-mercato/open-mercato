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
import { cn } from '@open-mercato/shared/lib/utils'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@/lib/i18n/context'
import { ContractorDetailsTab } from './ContractorDetailsTab'
import { ContractorAddressesTab } from './ContractorAddressesTab'
import { ContractorContactsTab } from './ContractorContactsTab'
import { ContractorRolesTab } from './ContractorRolesTab'

type ContractorAddress = {
  id: string
  purpose: string
  label?: string | null
  addressLine1: string
  addressLine2?: string | null
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
  jobTitle?: string | null
  department?: string | null
  email?: string | null
  phone?: string | null
  mobile?: string | null
  isPrimary: boolean
  isActive: boolean
  notes?: string | null
}

type ContractorRole = {
  id: string
  roleTypeId: string
  roleTypeName: string
  roleTypeCode: string
  roleTypeColor?: string | null
  roleTypeCategory: string
  isActive: boolean
  effectiveFrom?: string | null
  effectiveTo?: string | null
  settings?: Record<string, unknown> | null
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
  currentExposure: string
  lastCalculatedAt?: string | null
  requiresApprovalAbove?: string | null
  approvedById?: string | null
  approvedAt?: string | null
  notes?: string | null
}

export type ContractorDetail = {
  id: string
  name: string
  shortName?: string | null
  code?: string | null
  parentId?: string | null
  taxId?: string | null
  legalName?: string | null
  registrationNumber?: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  addresses: ContractorAddress[]
  contacts: ContractorContact[]
  roles: ContractorRole[]
  paymentTerms?: ContractorPaymentTerms | null
  creditLimit?: ContractorCreditLimit | null
}

export type TabId = 'details' | 'addresses' | 'contacts' | 'roles'

export type ContractorDrawerProps = {
  contractorId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onContractorUpdated?: () => void
  initialTab?: TabId
  autoFocusFirstCell?: boolean
}

type TabDefinition = {
  id: TabId
  label: string
}

export function ContractorDrawer({
  contractorId,
  open,
  onOpenChange,
  onContractorUpdated,
  initialTab = 'details',
  autoFocusFirstCell = false,
}: ContractorDrawerProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = React.useState<TabId>(initialTab)
  const [isFullscreen, setIsFullscreen] = React.useState(false)

  // Reset to initialTab when drawer opens or initialTab changes
  React.useEffect(() => {
    if (open) {
      setActiveTab(initialTab)
    } else {
      setIsFullscreen(false)
    }
  }, [open, initialTab])

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

  const handleContractorDeleted = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['contractors'] })
    onContractorUpdated?.()
    onOpenChange(false)
  }, [queryClient, onContractorUpdated, onOpenChange])

  const tabs: TabDefinition[] = React.useMemo(() => [
    { id: 'details', label: t('contractors.drawer.tabs.details', 'Details') },
    { id: 'addresses', label: t('contractors.drawer.tabs.addresses', 'Addresses') },
    { id: 'contacts', label: t('contractors.drawer.tabs.contacts', 'Contacts') },
    { id: 'roles', label: t('contractors.drawer.tabs.roles', 'Roles') },
  ], [t])

  const displayTitle = contractor?.name ?? t('contractors.drawer.title', 'Contractor')
  const displayCode = contractor?.code ?? null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col p-0 transition-[width,max-width] duration-300 ease-in-out"
        style={{
          width: isFullscreen ? '100vw' : '56rem',
          maxWidth: isFullscreen ? '100vw' : '56rem',
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
                    {displayCode && (
                      <p className="text-sm text-gray-500">{displayCode}</p>
                    )}
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

            <div className="flex-shrink-0 px-6 pt-4 border-b">
              <nav
                className="flex flex-wrap items-center gap-4 text-sm"
                role="tablist"
                aria-label={t('contractors.drawer.tabs.aria', 'Contractor sections')}
              >
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'relative -mb-px border-b-2 px-0 py-2 text-sm font-medium transition-colors',
                      activeTab === tab.id
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === 'details' && (
                <ContractorDetailsTab
                  contractor={contractor}
                  onUpdated={handleContractorUpdated}
                  onDeleted={handleContractorDeleted}
                  autoFocusFirstCell={autoFocusFirstCell}
                />
              )}
              {activeTab === 'addresses' && (
                <ContractorAddressesTab
                  contractorId={contractor.id}
                  addresses={contractor.addresses}
                  onUpdated={handleContractorUpdated}
                  autoFocusFirstCell={autoFocusFirstCell}
                />
              )}
              {activeTab === 'contacts' && (
                <ContractorContactsTab
                  contractorId={contractor.id}
                  contacts={contractor.contacts}
                  onUpdated={handleContractorUpdated}
                  autoFocusFirstCell={autoFocusFirstCell}
                />
              )}
              {activeTab === 'roles' && (
                <ContractorRolesTab
                  contractorId={contractor.id}
                  roles={contractor.roles}
                  onUpdated={handleContractorUpdated}
                  autoFocusFirstCell={autoFocusFirstCell}
                />
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
