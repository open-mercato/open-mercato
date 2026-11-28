"use client"

import * as React from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { ensureCustomerDictionary } from '../../components/detail/hooks/useCustomerDictionary'
import { createEmptyCustomerDictionaryMaps, type CustomerDictionaryKind } from '../../lib/dictionaries'

const dictionaryKinds: CustomerDictionaryKind[] = ['statuses', 'sources', 'lifecycle-stages']

export function usePeopleDictionaryMaps(queryClient: QueryClient, scopeVersion: number, reloadToken: number) {
  const [state, setState] = React.useState(() => ({
    scopeVersion,
    maps: createEmptyCustomerDictionaryMaps(),
  }))

  React.useEffect(() => {
    let cancelled = false
    setState((previous) => previous.scopeVersion === scopeVersion
      ? previous
      : { scopeVersion, maps: createEmptyCustomerDictionaryMaps() })
    for (const kind of dictionaryKinds) {
      void ensureCustomerDictionary(queryClient, kind, scopeVersion).then((data) => {
        if (cancelled) return
        setState((previous) => ({
          scopeVersion,
          maps: { ...previous.maps, [kind]: data.map },
        }))
      }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [queryClient, scopeVersion, reloadToken])

  return state.scopeVersion === scopeVersion ? state.maps : createEmptyCustomerDictionaryMaps()
}
