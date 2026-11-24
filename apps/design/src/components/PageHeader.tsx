import * as React from 'react'

type PageHeaderProps = {
  overline: string
  title: string
  lead?: string
  children?: React.ReactNode
}

export function PageHeader({ overline, title, lead, children }: PageHeaderProps) {
  return (
    <header className="space-y-3">
      <p className="text-overline uppercase tracking-widest text-muted-foreground">{overline}</p>
      <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">{title}</h1>
      {lead ? <p className="max-w-3xl text-base text-muted-foreground">{lead}</p> : null}
      {children}
    </header>
  )
}
