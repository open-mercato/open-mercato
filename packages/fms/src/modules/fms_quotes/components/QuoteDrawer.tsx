'use client'

import * as React from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@open-mercato/ui/primitives/sheet'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Input } from '@open-mercato/ui/primitives/input'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { MultiPortSelect, type SelectedPort } from './MultiPortSelect'

export type QuoteDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (quoteId: string, navigateToDetail: boolean) => void
}

type SearchResultItem = {
  entityId: string
  recordId: string
  score: number
  source: string
  presenter?: {
    title: string
    subtitle?: string
    icon?: string
    badge?: string
  }
  url?: string
}

type SearchResponse = {
  results: SearchResultItem[]
  strategiesUsed: string[]
  timing: number
  query: string
  limit: number
}

type FormData = {
  clientId: string
  originPorts: SelectedPort[]
  destinationPorts: SelectedPort[]
  containerCount: string
}

export function QuoteDrawer({ open, onOpenChange, onCreated }: QuoteDrawerProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [formData, setFormData] = React.useState<FormData>({
    clientId: '',
    originPorts: [],
    destinationPorts: [],
    containerCount: '',
  })
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormData, string>>>({})

  const loadContractors = React.useCallback(async (query?: string): Promise<ComboboxOption[]> => {
    if (!query || query.trim().length === 0) return []
    const params = new URLSearchParams({
      q: query.trim(),
      limit: '20',
      entityTypes: 'contractors:contractor',
    })
    const response = await apiCall<SearchResponse>(`/api/search/search?${params}`)
    if (!response.ok || !response.result?.results) return []
    return response.result.results.map((item) => ({
      value: item.recordId,
      label: item.presenter?.title ?? '',
      description: item.presenter?.subtitle || null,
    }))
  }, [])

  const resetForm = React.useCallback(() => {
    setFormData({
      clientId: '',
      originPorts: [],
      destinationPorts: [],
      containerCount: '',
    })
    setErrors({})
  }, [])

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        resetForm()
      }
      onOpenChange(nextOpen)
    },
    [onOpenChange, resetForm]
  )

  const validate = React.useCallback(() => {
    const newErrors: Partial<Record<keyof FormData, string>> = {}
    if (!formData.clientId.trim()) {
      newErrors.clientId = 'Client is required'
    }
    if (formData.originPorts.length === 0) {
      newErrors.originPorts = 'At least one origin port is required'
    }
    if (formData.destinationPorts.length === 0) {
      newErrors.destinationPorts = 'At least one destination port is required'
    }
    if (formData.containerCount && isNaN(parseInt(formData.containerCount, 10))) {
      newErrors.containerCount = 'Must be a number'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [formData])

  const handleSubmit = React.useCallback(
    async (navigateToDetail: boolean) => {
      if (!validate()) return

      setIsSubmitting(true)
      try {
        const payload: Record<string, unknown> = {
          clientId: formData.clientId.trim() || null,
          originPortIds: formData.originPorts.map((p) => p.id),
          destinationPortIds: formData.destinationPorts.map((p) => p.id),
          status: 'draft',
        }

        if (formData.containerCount.trim()) {
          payload.containerCount = parseInt(formData.containerCount, 10)
        }

        const response = await apiCall<{ id: string; error?: string }>('/api/fms_quotes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (response.ok && response.result?.id) {
          flash('Quote created successfully', 'success')
          const quoteId = response.result.id
          handleOpenChange(false)
          onCreated?.(quoteId, navigateToDetail)
        } else {
          flash(response.result?.error || 'Failed to create quote', 'error')
        }
      } catch (error) {
        flash(error instanceof Error ? error.message : 'An unexpected error occurred', 'error')
      } finally {
        setIsSubmitting(false)
      }
    },
    [formData, validate, handleOpenChange, onCreated]
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        handleSubmit(false)
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        handleOpenChange(false)
      }
    },
    [handleSubmit, handleOpenChange]
  )

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full max-w-md sm:max-w-lg overflow-y-auto">
        <div onKeyDown={handleKeyDown}>
          <SheetHeader>
            <SheetTitle>New Quote</SheetTitle>
            <SheetDescription>
              Create a new freight quote request.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="clientId" className="text-sm font-medium">
                Client <span className="text-red-500">*</span>
              </Label>
              <ComboboxInput
                value={formData.clientId}
                onChange={(next) => setFormData((prev) => ({ ...prev, clientId: next }))}
                placeholder="Search for contractor..."
                loadSuggestions={loadContractors}
                allowCustomValues={false}
              />
              {errors.clientId && <p className="text-sm text-red-500">{errors.clientId}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="originPorts" className="text-sm font-medium">
                Origin Ports <span className="text-red-500">*</span>
              </Label>
              <MultiPortSelect
                value={formData.originPorts}
                onChange={(ports) => setFormData((prev) => ({ ...prev, originPorts: ports }))}
                placeholder="Search for ports..."
              />
              {errors.originPorts && <p className="text-sm text-red-500">{errors.originPorts}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="destinationPorts" className="text-sm font-medium">
                Destination Ports <span className="text-red-500">*</span>
              </Label>
              <MultiPortSelect
                value={formData.destinationPorts}
                onChange={(ports) => setFormData((prev) => ({ ...prev, destinationPorts: ports }))}
                placeholder="Search for ports..."
              />
              {errors.destinationPorts && <p className="text-sm text-red-500">{errors.destinationPorts}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="containerCount" className="text-sm font-medium">
                Number of Containers
              </Label>
              <Input
                id="containerCount"
                type="number"
                min="1"
                placeholder="e.g. 10"
                value={formData.containerCount}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, containerCount: e.target.value }))
                }
                className={errors.containerCount ? 'border-red-500' : ''}
              />
              {errors.containerCount && <p className="text-sm text-red-500">{errors.containerCount}</p>}
            </div>
          </div>

          <SheetFooter className="mt-8 flex-col gap-2 sm:flex-col">
            <Button
              type="button"
              variant="default"
              className="w-full"
              onClick={() => handleSubmit(true)}
              disabled={isSubmitting}
            >
              Create & Edit
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => handleSubmit(false)}
              disabled={isSubmitting}
            >
              Create & Close
            </Button>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  )
}
