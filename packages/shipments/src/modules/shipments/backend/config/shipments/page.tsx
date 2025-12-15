"use client"

import * as React from 'react'
import { Upload, RefreshCw } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import { invalidateDictionaryEntries } from '@open-mercato/core/modules/dictionaries/components/hooks/useDictionaryEntries'


type Dictionary = {
  id: string
  name: string
  code: string
  key: string
}

type JsonEntry = {
  value: string
  label?: string
  color?: string
  icon?: string
}

export default function DictionaryImportSettings() {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [selectedDictionaryId, setSelectedDictionaryId] = React.useState<string>('')
  const [isImporting, setIsImporting] = React.useState(false)

  const dictionariesQuery = useQuery({
    queryKey: ['dictionaries', `scope:${scopeVersion}`],
    queryFn: async (): Promise<Dictionary[]> => {
      const call = await apiCall<Record<string, unknown>>('/api/dictionaries')
      if (!call.ok) {
        throw new Error('Failed to load dictionaries')
      }
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      console.log('Fetched dictionaries:', items)
      return items
        .filter((d) => {
          console.log("filtering dictionary:", d)
          return d.id && d.key.startsWith('sea_')
        })
    },
    //staleTime: 5 * 60 * 1000,
  })

  const dictionaries = dictionariesQuery.data ?? []

  console.log('Dictionaries available for import:', dictionaries)

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !selectedDictionaryId) return

    setIsImporting(true)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const entries: JsonEntry[] = Array.isArray(data) ? data : []

      if (!entries.length) {
        flash('No entries found in JSON file', 'warning')
        return
      }

      let successCount = 0
      let errorCount = 0

      for (const entry of entries) {
        if (!entry.value?.trim()) continue

        const payload = {
          value: entry.value.trim(),
          label: entry.label?.trim() || entry.value.trim(),
          color: entry.color || null,
          icon: entry.icon || null,
        }

        try {
          const call = await apiCall(
            `/api/dictionaries/${selectedDictionaryId}/entries`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            },
          )
          if (call.ok) {
            successCount++
          } else {
            errorCount++
          }
        } catch {
          errorCount++
        }
      }

      await invalidateDictionaryEntries(queryClient, selectedDictionaryId)

      if (errorCount === 0) {
        flash(`Successfully imported ${successCount} entries`, 'success')
      } else {
        flash(`Imported ${successCount} entries, ${errorCount} failed`, 'warning')
      }
    } catch (err) {
      console.error('Import failed', err)
      flash('Failed to parse or import JSON file', 'error')
    } finally {
      setIsImporting(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Import Dictionary Entries</h2>
        <p className="text-sm text-muted-foreground">
          Select a sea_ dictionary and upload a JSON file with entries
        </p>
      </div>

      <div className="space-y-4 rounded-lg border p-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Dictionary</label>
          <div className="flex gap-2">
            <select
              value={selectedDictionaryId}
              onChange={(e) => setSelectedDictionaryId(e.target.value)}
              className="flex-1 rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              disabled={dictionariesQuery.isLoading}
            >
              <option value="">Select a dictionary...</option>
              {dictionaries.map((dict) => (
                <option key={dict.id} value={dict.id}>
                  {dict.name} ({dict.code})
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => dictionariesQuery.refetch()}
              disabled={dictionariesQuery.isLoading}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">JSON File</label>
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              disabled={!selectedDictionaryId || isImporting}
              className="flex-1 text-sm file:mr-4 file:rounded file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
            />
            {isImporting && <Spinner className="h-5 w-5" />}
          </div>
          <p className="text-xs text-muted-foreground">
            JSON format: [{`{ "value": "...", "label": "...", "color": "#...", "icon": "..." }`}, ...]
          </p>
        </div>
      </div>
    </div>
  )
}