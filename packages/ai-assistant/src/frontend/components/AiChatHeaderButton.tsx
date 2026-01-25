'use client'

import * as React from 'react'
import { AiChatButton } from './AiChatButton'
import { useCommandPaletteContext } from './CommandPalette/CommandPaletteProvider'

interface AiChatHeaderButtonProps {
  className?: string
}

export function AiChatHeaderButton({ className }: AiChatHeaderButtonProps) {
  const { openChat } = useCommandPaletteContext()

  return <AiChatButton onClick={openChat} className={className} />
}
