'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { CrudFormSectionConfiguredHostLedger } from '@open-mercato/shared/lib/crud/form-sections/composition'

const CrudFormSectionLedgerContext = createContext<CrudFormSectionConfiguredHostLedger | null>(null)

export function CrudFormSectionLedgerProvider({
  value,
  children,
}: {
  value: CrudFormSectionConfiguredHostLedger
  children: ReactNode
}) {
  return <CrudFormSectionLedgerContext.Provider value={value}>{children}</CrudFormSectionLedgerContext.Provider>
}

export function useCrudFormSectionLedger(): CrudFormSectionConfiguredHostLedger | null {
  return useContext(CrudFormSectionLedgerContext)
}
