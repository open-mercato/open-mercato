'use client'

import * as React from 'react'
import { CommandPaletteProvider } from './CommandPaletteProvider'
import { CommandPalette } from './CommandPalette'

interface CommandPaletteWrapperProps {
  tenantId: string | null
  organizationId: string | null
}

export function CommandPaletteWrapper({ tenantId, organizationId }: CommandPaletteWrapperProps) {
  return (
    <CommandPaletteProvider
      tenantId={tenantId ?? ''}
      organizationId={organizationId}
    >
      <CommandPalette />
    </CommandPaletteProvider>
  )
}
