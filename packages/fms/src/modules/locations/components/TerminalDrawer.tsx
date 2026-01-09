'use client'

import * as React from 'react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@open-mercato/ui/primitives/sheet'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

interface TerminalDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (terminalId: string) => void
  preselectedPortId?: string
}

const QUADRANT_OPTIONS = [
  { value: 'NE', label: 'Northeast' },
  { value: 'NW', label: 'Northwest' },
  { value: 'SE', label: 'Southeast' },
  { value: 'SW', label: 'Southwest' },
]

interface Port {
  id: string
  code: string
  name: string
}

export function TerminalDrawer({ open, onOpenChange, onCreated, preselectedPortId }: TerminalDrawerProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    quadrant: 'NE' as string,
    portId: preselectedPortId || '',
  })

  const { data: portsData } = useQuery({
    queryKey: ['fms_locations_ports_list'],
    queryFn: async () => {
      const response = await apiCall<{ items: Port[] }>('/api/fms_locations/ports?limit=100')
      return response.ok ? response.result?.items ?? [] : []
    },
    enabled: open,
  })

  React.useEffect(() => {
    if (preselectedPortId) {
      setFormData((prev) => ({ ...prev, portId: preselectedPortId }))
    }
  }, [preselectedPortId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const response = await apiCall<{ id: string; error?: string }>('/api/fms_locations/terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (response.ok && response.result?.id) {
        flash('Terminal created successfully', 'success')
        onCreated(response.result.id)
        onOpenChange(false)
        setFormData({ code: '', name: '', quadrant: 'NE', portId: preselectedPortId || '' })
      } else {
        flash(response.result?.error || 'Failed to create terminal', 'error')
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Failed to create terminal', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit(e as unknown as React.FormEvent)
    }
    if (e.key === 'Escape') {
      onOpenChange(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-[425px]" onKeyDown={handleKeyDown}>
        <SheetHeader>
          <SheetTitle>Create New Terminal</SheetTitle>
          <SheetDescription>
            Add a new terminal to a port.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="portId">Port</Label>
            <select
              id="portId"
              value={formData.portId}
              onChange={(e) => setFormData({ ...formData, portId: e.target.value })}
              disabled={!!preselectedPortId}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              required
            >
              <option value="">Select port...</option>
              {portsData?.map((port) => (
                <option key={port.id} value={port.id}>
                  {port.code} - {port.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              placeholder="PLGDN-DCT"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="Baltic Hub (DCT Gdansk)"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quadrant">Quadrant</Label>
            <select
              id="quadrant"
              value={formData.quadrant}
              onChange={(e) => setFormData({ ...formData, quadrant: e.target.value })}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {QUADRANT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !formData.portId}>
              {isSubmitting ? 'Creating...' : 'Create Terminal'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
