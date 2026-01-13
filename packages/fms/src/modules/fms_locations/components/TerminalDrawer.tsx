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
    portId: preselectedPortId || '',
    lat: '',
    lng: '',
    city: '',
    country: '',
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
      const payload = {
        ...formData,
        portId: formData.portId || null,
        lat: formData.lat ? parseFloat(formData.lat) : null,
        lng: formData.lng ? parseFloat(formData.lng) : null,
        city: formData.city || null,
        country: formData.country || null,
      }

      const response = await apiCall<{ id: string; error?: string }>('/api/fms_locations/terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (response.ok && response.result?.id) {
        flash('Terminal created successfully', 'success')
        onCreated(response.result.id)
        onOpenChange(false)
        setFormData({ code: '', name: '', portId: preselectedPortId || '', lat: '', lng: '', city: '', country: '' })
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
      <SheetContent className="sm:max-w-[425px] overflow-y-auto" onKeyDown={handleKeyDown}>
        <SheetHeader>
          <SheetTitle>Create New Terminal</SheetTitle>
          <SheetDescription>
            Add a new terminal. Optionally assign it to a port.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="portId">Port (optional)</Label>
            <select
              id="portId"
              value={formData.portId}
              onChange={(e) => setFormData({ ...formData, portId: e.target.value })}
              disabled={!!preselectedPortId}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">No port (standalone terminal)</option>
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
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="lat">Latitude</Label>
              <Input
                id="lat"
                type="number"
                step="any"
                placeholder="54.3520"
                value={formData.lat}
                onChange={(e) => setFormData({ ...formData, lat: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lng">Longitude</Label>
              <Input
                id="lng"
                type="number"
                step="any"
                placeholder="18.6466"
                value={formData.lng}
                onChange={(e) => setFormData({ ...formData, lng: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              placeholder="Gdansk"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="country">Country</Label>
            <Input
              id="country"
              placeholder="Poland"
              value={formData.country}
              onChange={(e) => setFormData({ ...formData, country: e.target.value })}
            />
          </div>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Terminal'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
