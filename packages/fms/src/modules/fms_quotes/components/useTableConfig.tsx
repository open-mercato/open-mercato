'use client'

import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

export interface TableColumnConfig {
  data: string
  title: string
  width: number
  type?: 'text' | 'numeric' | 'date' | 'dropdown' | 'checkbox'
  dateFormat?: string
  readOnly?: boolean
  source?: string[]
  renderer?: string
}

export interface TableConfigResponse {
  columns: TableColumnConfig[]
  meta: {
    entity: string
    totalColumns: number
    generatedAt: string
  }
}

export function useTableConfig(entity: string) {
  return useQuery({
    queryKey: ['table-config', entity],
    queryFn: async () => {
      const response = await apiCall<TableConfigResponse>(`/api/${entity}/table-config`)

      if (!response.ok) {
        throw new Error('Failed to load table configuration')
      }

      return response.result
    },
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  })
}
