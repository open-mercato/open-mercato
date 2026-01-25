'use client'

import * as React from 'react'
import { CommandPaletteProvider } from './CommandPalette/CommandPaletteProvider'
import { DockableChat } from './DockableChat'
import { AiChatHeaderButton } from './AiChatHeaderButton'

interface AiAssistantIntegrationProps {
  tenantId: string | null
  organizationId: string | null
  children?: React.ReactNode
}

/**
 * Provides the full AI Assistant integration including:
 * - CommandPaletteProvider context
 * - DockableChat (supports modal, right, left, bottom docking)
 * - Keyboard shortcuts (Cmd+K / Cmd+J)
 * - Exposes the header button component via context
 *
 * Usage:
 * ```tsx
 * <AiAssistantIntegration tenantId={auth?.tenantId} organizationId={auth?.orgId}>
 *   {children}
 * </AiAssistantIntegration>
 * ```
 *
 * Then use <AiChatHeaderButton /> anywhere within for the header button.
 */
export function AiAssistantIntegration({
  tenantId,
  organizationId,
  children,
}: AiAssistantIntegrationProps) {
  return (
    <CommandPaletteProvider
      tenantId={tenantId ?? ''}
      organizationId={organizationId}
    >
      {children}
      <DockableChat />
    </CommandPaletteProvider>
  )
}

/**
 * Standalone header button that triggers AI chat.
 * Must be used within AiAssistantIntegration or CommandPaletteProvider.
 */
export { AiChatHeaderButton }
