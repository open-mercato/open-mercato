'use client'

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readThemeTokens, type ThemeTokens } from './themeTokens'

const referenceTokens = [
  'brand-lime', 'brand-yellow', 'brand-violet', 'background', 'foreground',
  'card', 'card-foreground', 'muted', 'muted-foreground', 'primary', 'primary-foreground',
  'primary-hover', 'border', 'input', 'ring', 'destructive',
  'status-info-bg', 'status-info-text', 'status-success-bg', 'status-success-text',
  'status-warning-bg', 'status-warning-text', 'status-error-bg', 'status-error-text',
]
type TokenRow = { token: string; light: string; dark: string }

function displayColor(value: string, context: CanvasRenderingContext2D | null) {
  if (!context || !CSS.supports('color', value)) return value
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
  return '#' + [red, green, blue, ...(alpha === 255 ? [] : [alpha])].map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase()
}

export function ThemeTokenReference() {
  const t = useT()
  const [tokens, setTokens] = React.useState<ThemeTokens | null>(null)
  React.useEffect(() => {
    const values = readThemeTokens(document.styleSheets)
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    for (const theme of ['light', 'dark'] as const) {
      for (const token of referenceTokens) {
        const value = values[theme][`--${token}`]
        if (value) values[theme][`--${token}`] = displayColor(value, context)
      }
    }
    setTokens(values)
  }, [])
  const rows = referenceTokens.map(token => ({ token: `--${token}`, light: tokens?.light[`--${token}`] ?? '—', dark: tokens?.dark[`--${token}`] ?? '—' }))
  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token)
      flash(t('design_system.gallery.tokenCopied', { token }), 'success')
    } catch { flash(t('design_system.gallery.tokenCopyFailed'), 'error') }
  }
  const columns: ColumnDef<TokenRow, unknown>[] = [
    { accessorKey: 'token', header: t('design_system.foundations.token'), cell: ({ row }) => <Button type="button" variant="ghost" className="h-auto justify-start px-0 py-2 font-mono text-xs" aria-label={t('design_system.gallery.copyToken', { token: row.original.token })} onClick={() => copyToken(row.original.token)}>{row.original.token}</Button> },
    ...(['light', 'dark'] as const).map(theme => ({
      accessorKey: theme,
      header: t(`design_system.foundations.${theme}`),
      cell: ({ row }: { row: { original: TokenRow } }) => <span className="flex items-center gap-3 py-2"><span aria-hidden className="size-6 shrink-0 rounded-full border border-border" style={{ backgroundColor: row.original[theme] === '—' ? undefined : row.original[theme] }} /><code className="text-xs text-muted-foreground">{row.original[theme]}</code></span>,
    })),
  ]
  return <div className="space-y-4">
    <h3 className="text-xl font-medium">{t('design_system.foundations.themeReference')}</h3>
    <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{t('design_system.foundations.themeDescription')}</p>
    {tokens ? <div className="grid gap-4 sm:grid-cols-2">
      {(['light', 'dark'] as const).map(theme => <div key={theme} className="space-y-6 rounded-lg border p-6" style={{ backgroundColor: tokens[theme]['--background'], color: tokens[theme]['--foreground'], borderColor: tokens[theme]['--border'] }}>
        <p className="text-base font-medium">{t(`design_system.foundations.${theme}`)}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" style={{ backgroundColor: tokens[theme]['--primary'], color: tokens[theme]['--primary-foreground'] }}>{t('design_system.gallery.samples.primaryAction')}</Button>
          <span className="inline-flex h-9 items-center rounded-md border px-4 text-sm" style={{ borderColor: tokens[theme]['--border'] }}>Aa</span>
        </div>
        <code className="text-xs" style={{ color: tokens[theme]['--muted-foreground'] }}>{tokens[theme]['--background']} / {tokens[theme]['--foreground']}</code>
      </div>)}
    </div> : null}
    <DataTable columns={columns} data={rows} isLoading={!tokens} />
  </div>
}
