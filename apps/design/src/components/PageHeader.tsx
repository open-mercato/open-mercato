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
      <h1 className="text-3xl font-normal tracking-tight text-foreground sm:text-4xl">{title}</h1>
      {lead ? <p className="max-w-3xl text-base text-muted-foreground">{lead}</p> : null}
      {children}
    </header>
  )
}
