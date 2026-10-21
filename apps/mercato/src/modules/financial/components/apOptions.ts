'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'

export type VendorOption = {
  id: string
  code: string
  name: string
}

export type AccountOption = {
  id: string
  code: string
  name: string
}

export function useVendorOptions() {
  const query = useQuery({
    queryKey: ['financial-ap-vendor-options'],
    queryFn: () => fetchCrudList<VendorOption>('financial/ap/vendors', {
      pageSize: 100,
      sortField: 'name',
      sortDir: 'asc',
    }),
    staleTime: 5 * 60 * 1000,
  })
  const vendors = query.data?.items ?? []
  return {
    vendors,
    labels: React.useMemo(() => new Map(vendors.map((vendor) => [vendor.id, `${vendor.code} — ${vendor.name}`])), [vendors]),
  }
}

export function useExpenseAccountOptions() {
  const query = useQuery({
    queryKey: ['financial-expense-account-options'],
    queryFn: () => fetchCrudList<AccountOption>('financial/accounts', {
      pageSize: 100,
      accountClass: 'expense',
      isActive: 'true',
      sortField: 'code',
      sortDir: 'asc',
    }),
    staleTime: 5 * 60 * 1000,
  })
  const accounts = query.data?.items ?? []
  return {
    accounts,
    labels: React.useMemo(() => new Map(accounts.map((account) => [account.id, `${account.code} — ${account.name}`])), [accounts]),
  }
}

export function useCashBankAccountOptions() {
  const query = useQuery({
    queryKey: ['financial-cash-bank-account-options'],
    queryFn: () => fetchCrudList<AccountOption>('financial/accounts', {
      pageSize: 100,
      isActive: 'true',
      sortField: 'code',
      sortDir: 'asc',
    }),
    staleTime: 5 * 60 * 1000,
  })
  const accounts = query.data?.items ?? []
  return {
    accounts,
    labels: React.useMemo(() => new Map(accounts.map((account) => [account.id, `${account.code} — ${account.name}`])), [accounts]),
  }
}
