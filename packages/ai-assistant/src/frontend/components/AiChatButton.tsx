'use client'

import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@open-mercato/ui/primitives/tooltip'

interface AiChatButtonProps {
  onClick?: () => void
  className?: string
}

export function AiChatButton({ onClick, className }: AiChatButtonProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    onClick?.()
  }

  const isMac = typeof navigator !== 'undefined' && navigator.platform?.toUpperCase().indexOf('MAC') >= 0

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClick}
            className={className}
            aria-label="Open AI Assistant"
          >
            <Sparkles className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>AI Assistant ({isMac ? '⌘' : 'Ctrl+'}J)</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
