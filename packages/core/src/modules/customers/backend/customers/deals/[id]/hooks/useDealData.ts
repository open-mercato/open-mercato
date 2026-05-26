import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DealDetailPayload } from './types'

type UseDealDataResult = {
  data: DealDetailPayload | null
  setData: React.Dispatch<React.SetStateAction<DealDetailPayload | null>>
  isLoading: boolean
  error: string | null
  loadData: () => Promise<void>
}

export function useDealData(id: string): UseDealDataResult {
  const t = useT()
  const [data, setData] = React.useState<DealDetailPayload | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const initialLoadDoneRef = React.useRef(false)

  const loadData = React.useCallback(async () => {
    if (!id) {
      setError(t('customers.deals.detail.error.notFound', 'Deal not found.'))
      setIsLoading(false)
      return
    }
    if (!initialLoadDoneRef.current) {
      setIsLoading(true)
    }
    setError(null)
    try {
      const payload = await readApiResultOrThrow<DealDetailPayload>(
        `/api/customers/deals/${encodeURIComponent(id)}?include=stages&view=lite`,
        undefined,
        { errorMessage: t('customers.deals.detail.error.load', 'Failed to load deal.') },
      )
      setData(payload)
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : t('customers.deals.detail.error.load', 'Failed to load deal.')
      setError(message)
      if (!initialLoadDoneRef.current) setData(null)
    } finally {
      setIsLoading(false)
      initialLoadDoneRef.current = true
    }
  }, [id, t])

  return { data, setData, isLoading, error, loadData }
}
