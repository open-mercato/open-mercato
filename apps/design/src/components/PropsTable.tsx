'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import type { PropKind, PropRow } from '@/lib/props-table'

const KIND_KEYS: Record<PropKind, string> = {
  prop: 'design.api.kindProp',
  slot: 'design.api.kindSlot',
  event: 'design.api.kindEvent',
}

const DEPTH_INDENT = ['', 'pl-8', 'pl-12']

export function PropsTable({ rows }: { rows: PropRow[] }) {
  const t = useT()
  return (
    <div className="min-w-0 overflow-x-auto rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('design.api.prop')}</TableHead>
            <TableHead>{t('design.api.type')}</TableHead>
            <TableHead>{t('design.api.required')}</TableHead>
            <TableHead>{t('design.api.kind')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.name}>
              <TableCell className={cn('whitespace-nowrap font-mono text-xs text-foreground', DEPTH_INDENT[row.depth] ?? 'pl-12')}>{row.name}</TableCell>
              <TableCell className="min-w-48 font-mono text-xs text-muted-foreground">{row.type}</TableCell>
              <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{row.required ? t('design.api.yes') : t('design.api.no')}</TableCell>
              <TableCell className="whitespace-nowrap">
                {row.kind === 'prop' ? (
                  <span className="text-sm text-muted-foreground">{t(KIND_KEYS[row.kind])}</span>
                ) : (
                  <Badge variant={row.kind === 'event' ? 'info' : 'neutral'}>{t(KIND_KEYS[row.kind])}</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
