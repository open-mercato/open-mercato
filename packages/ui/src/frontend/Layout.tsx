import * as React from 'react'
import { FlashMessages } from '../backend/FlashMessages'

export function FrontendLayout({ header, footer, children }: { header?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-svh flex flex-col">
      <FlashMessages />
      {header ? <div className="border-b bg-background/60">{header}</div> : null}
      <div className="flex-1 min-h-0">{children}</div>
      {footer ? <div className="border-t bg-background/60">{footer}</div> : null}
    </div>
  )
}
