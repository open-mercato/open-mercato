import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DealDetailPayload } from './types'

type LoadDataOptions = {
  cache?: boolean
}

type UseDealDataResult = {
  data: DealDetailPayload | null
  setData: React.Dispatch<React.SetStateAction<DealDetailPayload | null>>
  isLoading: boolean
  error: string | null
  isNotFound: boolean
  loadData: (options?: LoadDataOptions) => Promise<void>
}

type DealDataCacheEntry = {
  promise: Promise<DealDetailPayload>
}

const dealDataCache = new Map<string, DealDataCacheEntry>()

function fetchDealData(id: string, errorMessage: string, useCache: boolean): Promise<DealDetailPayload> {
  const url = `/api/customers/deals/${encodeURIComponent(id)}?include=stages&view=lite`
  const cached = dealDataCache.get(url)
  if (useCache && cached) return cached.promise
  const entry: DealDataCacheEntry = {
    promise: readApiResultOrThrow<DealDetailPayload>(
      url,
      undefined,
      { errorMessage },
    ),
  }
  if (useCache) dealDataCache.set(url, entry)
  return entry.promise.finally(() => {
    if (dealDataCache.get(url) === entry) dealDataCache.delete(url)
  })
}

export function useDealData(id: string): UseDealDataResult {
  const t = useT()
  const [data, setData] = React.useState<DealDetailPayload | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const initialLoadDoneRef = React.useRef(false)

  const loadData = React.useCallback(async (options: LoadDataOptions = {}) => {
    if (!id) {
      setIsNotFound(true)
      setIsLoading(false)
      return
    }
    if (!initialLoadDoneRef.current) {
      setIsLoading(true)
    }
    setError(null)
    try {
      const payload = await fetchDealData(
        id,
        t('customers.deals.detail.error.load', 'Failed to load deal.'),
        options.cache === true,
      )
      setData(payload)
    } catch (loadError) {
      if ((loadError as { status?: number }).status === 404) {
        setIsNotFound(true)
      } else {
        const message =
          loadError instanceof Error
            ? loadError.message
            : t('customers.deals.detail.error.load', 'Failed to load deal.')
        setError(message)
      }
      if (!initialLoadDoneRef.current) setData(null)
    } finally {
      setIsLoading(false)
      initialLoadDoneRef.current = true
    }
  }, [id, t])

  return { data, setData, isLoading, error, isNotFound, loadData }
}
