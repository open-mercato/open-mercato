'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Trash2 } from '../lucide-icons'
import {
  ConditionBuilder,
  type ConditionSourceOption,
} from './ConditionBuilder'
import type { FormSchema, JumpRuleEntry, JumpTarget, SectionNode } from '../schema-helpers'

export type JumpsEditorProps = {
  schema: FormSchema
  pageKey: string
  sources: ConditionSourceOption[]
  rules: JumpRuleEntry[]
  onChange: (rules: JumpRuleEntry[]) => void
}

type TargetKey = string

function encodeTarget(target: JumpTarget): TargetKey {
  if (target.type === 'page') return `page:${target.pageKey}`
  if (target.type === 'ending') return `ending:${target.endingKey}`
  return target.type
}

function decodeTarget(value: TargetKey): JumpTarget {
  if (value.startsWith('page:')) return { type: 'page', pageKey: value.slice(5) }
  if (value.startsWith('ending:')) return { type: 'ending', endingKey: value.slice(7) }
  if (value === 'submit') return { type: 'submit' }
  return { type: 'next' }
}

export function JumpsEditor({ schema, pageKey, sources, rules, onChange }: JumpsEditorProps) {
  const t = useT()
  const sections = (schema['x-om-sections'] ?? []) as SectionNode[]
  const pages = sections.filter((entry) => entry.kind === 'page')
  const endings = sections.filter((entry) => entry.kind === 'ending')
  const ruleForPage = rules.find(
    (entry) => entry.from.type === 'page' && entry.from.pageKey === pageKey,
  )
  const branches = ruleForPage?.rules ?? []
  const otherwise = ruleForPage?.otherwise

  const targetOptions = React.useMemo(() => {
    const options: Array<{ value: TargetKey; label: string }> = []
    options.push({ value: 'next', label: t('forms.studio.logic.jumps.target.next') })
    options.push({ value: 'submit', label: t('forms.studio.logic.jumps.target.submit') })
    for (const page of pages) {
      if (page.key === pageKey) continue
      const title = page.title?.en ?? page.key
      options.push({ value: encodeTarget({ type: 'page', pageKey: page.key }), label: t('forms.studio.logic.jumps.target.page', { name: title }) })
    }
    for (const ending of endings) {
      const title = ending.title?.en ?? ending.key
      options.push({
        value: encodeTarget({ type: 'ending', endingKey: ending.key }),
        label: t('forms.studio.logic.jumps.target.ending', { name: title }),
      })
    }
    return options
  }, [pages, endings, pageKey, t])

  const commit = (next: JumpRuleEntry | null) => {
    const others = rules.filter(
      (entry) => !(entry.from.type === 'page' && entry.from.pageKey === pageKey),
    )
    if (!next || (next.rules.length === 0 && !next.otherwise)) {
      onChange(others)
      return
    }
    onChange([...others, next])
  }

  const addBranch = () => {
    const next: JumpRuleEntry = {
      from: { type: 'page', pageKey },
      rules: [...branches, { if: null, goto: { type: 'next' } }],
      otherwise,
    }
    commit(next)
  }

  const updateBranch = (index: number, partial: Partial<{ if: unknown; goto: JumpTarget }>) => {
    const nextBranches = branches.map((entry, i) => (i === index ? { ...entry, ...partial } : entry))
    commit({
      from: { type: 'page', pageKey },
      rules: nextBranches,
      otherwise,
    })
  }

  const removeBranch = (index: number) => {
    const nextBranches = branches.filter((_, i) => i !== index)
    commit({
      from: { type: 'page', pageKey },
      rules: nextBranches,
      otherwise,
    })
  }

  const moveBranch = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= branches.length) return
    const next = [...branches]
    const [moved] = next.splice(index, 1)
    next.splice(targetIndex, 0, moved)
    commit({
      from: { type: 'page', pageKey },
      rules: next,
      otherwise,
    })
  }

  const updateOtherwise = (value: TargetKey) => {
    const target = decodeTarget(value)
    commit({
      from: { type: 'page', pageKey },
      rules: branches,
      otherwise: target.type === 'next' ? undefined : target,
    })
  }

  return (
    <div className="space-y-3" data-testid="jumps-editor">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('forms.studio.logic.jumps.heading')}
        </h4>
        <Button variant="outline" size="sm" type="button" onClick={addBranch}>
          {t('forms.studio.logic.jumps.addRule')}
        </Button>
      </div>
      {branches.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('forms.studio.logic.jumps.empty')}</p>
      ) : null}
      <ul className="space-y-3">
        {branches.map((branch, index) => (
          <li key={index} className="space-y-2 rounded-md border border-border bg-background p-2" data-testid="jump-branch">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {t('forms.studio.logic.jumps.branch.heading', { n: String(index + 1) })}
              </span>
              <div className="flex items-center gap-1">
                <IconButton
                  aria-label={t('forms.studio.logic.jumps.moveUp')}
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={index === 0}
                  onClick={() => moveBranch(index, -1)}
                >
                  ↑
                </IconButton>
                <IconButton
                  aria-label={t('forms.studio.logic.jumps.moveDown')}
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={index === branches.length - 1}
                  onClick={() => moveBranch(index, 1)}
                >
                  ↓
                </IconButton>
                <IconButton
                  aria-label={t('forms.studio.logic.jumps.removeBranch')}
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => removeBranch(index)}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            </div>
            <ConditionBuilder
              predicate={branch.if ?? null}
              sources={sources}
              onChange={(next) => updateBranch(index, { if: next })}
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {t('forms.studio.logic.jumps.goto')}
              </span>
              <Select
                value={encodeTarget(branch.goto)}
                onValueChange={(value) => updateBranch(index, { goto: decodeTarget(value) })}
              >
                <SelectTrigger className="h-8 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {targetOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Tag variant="neutral" className="shrink-0">
          {t('forms.studio.logic.jumps.otherwise')}
        </Tag>
        <Select
          value={otherwise ? encodeTarget(otherwise) : 'next'}
          onValueChange={updateOtherwise}
        >
          <SelectTrigger className="h-8 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {targetOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
