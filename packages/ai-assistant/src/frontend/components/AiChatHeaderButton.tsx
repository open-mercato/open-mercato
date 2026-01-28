'use client'

import * as React from 'react'
import { AiChatButton } from './AiChatButton'
import { useCommandPaletteContext } from './CommandPalette/CommandPaletteProvider'
import { useAiAssistantVisibility } from '../hooks/useAiAssistantVisibility'

interface AiChatHeaderButtonProps {
  className?: string
}

export function AiChatHeaderButton({ className }: AiChatHeaderButtonProps) {
  const { openChat } = useCommandPaletteContext()
  const { isEnabled, isLoaded } = useAiAssistantVisibility()

  // Don't render until visibility setting is loaded, and hide if disabled
  if (!isLoaded || !isEnabled) {
    return null
  }

  return <AiChatButton onClick={openChat} className={className} />
}
