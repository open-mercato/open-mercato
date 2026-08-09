"use client"

import * as React from 'react'
import {
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  GitBranch,
  Play,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import {
  parseGuideSteps,
  walkGuide,
  type TroubleshootingNode,
  type TroubleshootingOption,
} from '../../../lib/troubleshooting'

type BuilderFieldProps = {
  value: unknown
  setValue: (value: unknown) => void
  disabled?: boolean
}

type GraphItem = {
  id: string
  kind: 'question' | 'outcome'
  depth: number
  title: string
  subtitle: string
  nodePath: number[]
}

function createDefaultTree(t: TranslateFn): TroubleshootingNode {
  return {
    prompt: t('warranty_claims.troubleshootingGuides.builder.sample.damageQuestion', 'Does the buckle show physical damage?'),
    options: [
      {
        label: t('warranty_claims.troubleshootingGuides.builder.sample.damaged', 'Yes, cracked or snapped'),
        next: {
          prompt: t('warranty_claims.troubleshootingGuides.builder.sample.ageQuestion', 'Is the backpack younger than 24 months?'),
          options: [
            { label: t('warranty_claims.troubleshootingGuides.builder.sample.yes', 'Yes'), reasonCode: 'FLT-11', resolution: t('warranty_claims.troubleshootingGuides.builder.sample.replaceBuckle', 'Replace the buckle') },
            { label: t('warranty_claims.troubleshootingGuides.builder.sample.no', 'No'), reasonCode: 'FLT-11', resolution: t('warranty_claims.troubleshootingGuides.builder.sample.paidRepair', 'Offer a paid repair') },
          ],
        },
      },
      { label: t('warranty_claims.troubleshootingGuides.builder.sample.intact', 'No, it looks intact'), reasonCode: 'FLT-02', resolution: t('warranty_claims.troubleshootingGuides.builder.sample.photos', 'Request additional photos') },
      { label: t('warranty_claims.troubleshootingGuides.builder.sample.unsure', 'Not sure'), reasonCode: 'FLT-02', resolution: t('warranty_claims.troubleshootingGuides.builder.sample.photos', 'Request additional photos') },
    ],
  }
}

export function defaultTroubleshootingStepsJson(t: TranslateFn): string {
  return JSON.stringify(createDefaultTree(t), null, 2)
}

function parseTreeValue(value: unknown): TroubleshootingNode | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return parseGuideSteps(JSON.parse(value))
  } catch {
    return null
  }
}

function pathId(path: readonly number[]): string {
  return path.length ? path.join('.') : 'root'
}

function getNode(root: TroubleshootingNode, path: readonly number[]): TroubleshootingNode | null {
  let current: TroubleshootingNode | null = root
  for (const optionIndex of path) {
    current = current?.options[optionIndex]?.next ?? null
    if (!current) return null
  }
  return current
}

function replaceNode(
  root: TroubleshootingNode,
  path: readonly number[],
  updater: (node: TroubleshootingNode) => TroubleshootingNode,
): TroubleshootingNode {
  if (!path.length) return updater(root)
  const [optionIndex, ...rest] = path
  return {
    ...root,
    options: root.options.map((option, index) => {
      if (index !== optionIndex || !option.next) return option
      return { ...option, next: replaceNode(option.next, rest, updater) }
    }),
  }
}

function updateOption(
  root: TroubleshootingNode,
  nodePath: readonly number[],
  optionIndex: number,
  updater: (option: TroubleshootingOption) => TroubleshootingOption,
): TroubleshootingNode {
  return replaceNode(root, nodePath, (node) => ({
    ...node,
    options: node.options.map((option, index) => index === optionIndex ? updater(option) : option),
  }))
}

function flattenTree(root: TroubleshootingNode): GraphItem[] {
  const items: GraphItem[] = []
  const visit = (node: TroubleshootingNode, nodePath: number[], depth: number) => {
    items.push({
      id: `question:${pathId(nodePath)}`,
      kind: 'question',
      depth,
      title: node.prompt,
      subtitle: `${node.options.length}`,
      nodePath,
    })
    node.options.forEach((option, optionIndex) => {
      if (option.next) {
        visit(option.next, [...nodePath, optionIndex], depth + 1)
        return
      }
      items.push({
        id: `outcome:${pathId(nodePath)}:${optionIndex}`,
        kind: 'outcome',
        depth: depth + 1,
        title: option.reasonCode || option.resolution || option.label,
        subtitle: option.resolution || option.label,
        nodePath,
      })
    })
  }
  visit(root, [], 0)
  return items
}

export function TroubleshootingTreeBuilder({ value, setValue, disabled }: BuilderFieldProps) {
  const t = useT()
  const parsedTree = React.useMemo(() => parseTreeValue(value), [value])
  const tree = parsedTree ?? createDefaultTree(t)
  const initializedRef = React.useRef(false)
  const [selectedPath, setSelectedPath] = React.useState<number[]>([])
  const [testMode, setTestMode] = React.useState(false)
  const [testPath, setTestPath] = React.useState<number[]>([])

  React.useEffect(() => {
    if (initializedRef.current || parsedTree || disabled) return
    initializedRef.current = true
    setValue(JSON.stringify(tree, null, 2))
  }, [disabled, parsedTree, setValue, tree])

  const commit = React.useCallback((nextTree: TroubleshootingNode) => {
    setValue(JSON.stringify(nextTree, null, 2))
  }, [setValue])

  const selectedNode = getNode(tree, selectedPath) ?? tree
  const graphItems = React.useMemo(() => flattenTree(tree), [tree])
  const graphDepths = React.useMemo(
    () => [...new Set(graphItems.map((item) => item.depth))].sort((left, right) => left - right),
    [graphItems],
  )
  const testState = React.useMemo(() => walkGuide(tree, testPath), [testPath, tree])

  const updateSelectedNode = React.useCallback((updater: (node: TroubleshootingNode) => TroubleshootingNode) => {
    commit(replaceNode(tree, selectedPath, updater))
  }, [commit, selectedPath, tree])

  const chooseTestAnswer = React.useCallback((optionIndex: number) => {
    setTestPath((current) => [...current, optionIndex])
  }, [])

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <GitBranch className="size-4 text-accent-indigo" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-foreground">
              {t('warranty_claims.troubleshootingGuides.builder.title', 'Visual decision tree')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('warranty_claims.troubleshootingGuides.builder.description', 'Connect questions to another question or a claim outcome.')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={testMode ? 'default' : 'outline'}
            onClick={() => {
              setTestMode((current) => !current)
              setTestPath([])
            }}
          >
            <Play className="size-4" aria-hidden />
            {testMode
              ? t('warranty_claims.troubleshootingGuides.builder.edit', 'Edit')
              : t('warranty_claims.troubleshootingGuides.builder.test', 'Test')}
          </Button>
        </div>
      </div>

      {testMode ? (
        <div className="flex min-h-96 flex-col lg:flex-row">
          <div className="flex-1 bg-muted/20 p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {t('warranty_claims.troubleshootingGuides.builder.testRun', 'Test run')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('warranty_claims.troubleshootingGuides.builder.answersSoFar', '{count} answers so far', { count: testPath.length })}
                </p>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => setTestPath([])}>
                <RotateCcw className="size-4" aria-hidden />
                {t('warranty_claims.troubleshootingGuides.builder.reset', 'Reset')}
              </Button>
            </div>
            <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-5 shadow-sm">
              {testState.node ? (
                <>
                  <div className="mb-4 flex items-start gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-status-warning-bg text-status-warning-text">
                      <CircleHelp className="size-4" aria-hidden />
                    </span>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t('warranty_claims.troubleshootingGuides.builder.currentQuestion', 'Current question')}
                      </p>
                      <h3 className="mt-1 text-base font-semibold text-foreground">{testState.node.prompt}</h3>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {testState.node.options.map((option, optionIndex) => (
                      <Button
                        key={`${option.label}:${optionIndex}`}
                        type="button"
                        variant="outline"
                        className="h-auto w-full justify-between whitespace-normal py-3 text-left"
                        onClick={() => chooseTestAnswer(optionIndex)}
                      >
                        {option.label}
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      </Button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-status-success-bg text-status-success-text">
                    <CheckCircle2 className="size-4" aria-hidden />
                  </span>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t('warranty_claims.troubleshootingGuides.builder.outcome', 'Outcome')}
                    </p>
                    <h3 className="mt-1 text-base font-semibold text-foreground">
                      {testState.terminal?.reasonCode || t('warranty_claims.troubleshootingGuides.builder.completed', 'Guide completed')}
                    </h3>
                    {testState.terminal?.resolution ? (
                      <p className="mt-1 text-sm text-muted-foreground">{testState.terminal.resolution}</p>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>
          <aside className="w-full border-t border-border bg-card p-5 lg:w-80 lg:border-l lg:border-t-0">
            <h3 className="text-sm font-semibold text-foreground">
              {t('warranty_claims.troubleshootingGuides.builder.effectReport', 'Would do, dry-run effect report')}
            </h3>
            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('warranty_claims.troubleshootingGuides.builder.prefillReason', 'Prefill reason')}
                </p>
                <p className="mt-1 font-medium text-foreground">{testState.terminal?.reasonCode || '—'}</p>
              </div>
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('warranty_claims.troubleshootingGuides.builder.prefillResolution', 'Prefill resolution summary')}
                </p>
                <p className="mt-1 text-foreground">{testState.terminal?.resolution || '—'}</p>
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <div className="flex min-h-96 flex-col lg:flex-row">
          <div className="flex min-w-0 flex-1 bg-muted/20">
            <div className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-border bg-card py-3">
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={t('warranty_claims.troubleshootingGuides.builder.addQuestion', 'Add question')}
                title={t('warranty_claims.troubleshootingGuides.builder.addQuestion', 'Add question')}
                onClick={() => updateSelectedNode((node) => ({
                  ...node,
                  options: [...node.options, {
                    label: t('warranty_claims.troubleshootingGuides.builder.newAnswer', 'New answer'),
                    next: {
                      prompt: t('warranty_claims.troubleshootingGuides.builder.newQuestion', 'New question'),
                      options: [],
                    },
                  }],
                }))}
              >
                <CircleHelp className="size-4" aria-hidden />
              </IconButton>
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={t('warranty_claims.troubleshootingGuides.builder.addOutcome', 'Add outcome')}
                title={t('warranty_claims.troubleshootingGuides.builder.addOutcome', 'Add outcome')}
                onClick={() => updateSelectedNode((node) => ({
                  ...node,
                  options: [...node.options, {
                    label: t('warranty_claims.troubleshootingGuides.builder.newAnswer', 'New answer'),
                    reasonCode: 'FLT-00',
                    resolution: t('warranty_claims.troubleshootingGuides.builder.newResolution', 'Add resolution guidance'),
                  }],
                }))}
              >
                <CheckCircle2 className="size-4" aria-hidden />
              </IconButton>
            </div>
            <div className="min-w-0 flex-1 overflow-auto p-6">
              <div className="mb-6 inline-flex items-center gap-2 rounded-md border border-dashed border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                <GitBranch className="size-4" aria-hidden />
                {t('warranty_claims.troubleshootingGuides.builder.guideStarts', 'Guide starts')}
              </div>
              <div className="flex min-w-max items-start gap-10 pb-6">
                {graphDepths.map((depth, depthIndex) => (
                  <React.Fragment key={depth}>
                    {depthIndex > 0 ? <ArrowRight className="mt-10 size-5 shrink-0 text-muted-foreground" aria-hidden /> : null}
                    <div className="flex w-52 shrink-0 flex-col gap-5">
                      {graphItems.filter((item) => item.depth === depth).map((item) => {
                        const selected = item.kind === 'question' && pathId(item.nodePath) === pathId(selectedPath)
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={cn(
                              'overflow-hidden rounded-lg border bg-card text-left shadow-sm transition-colors hover:border-foreground/30 focus-visible:shadow-focus focus-visible:outline-none',
                              selected ? 'border-accent-indigo ring-1 ring-accent-indigo' : 'border-border',
                            )}
                            onClick={() => setSelectedPath(item.nodePath)}
                          >
                            <span className={cn(
                              'block h-1 w-full',
                              item.kind === 'question' ? 'bg-status-warning-border' : 'bg-status-success-border',
                            )} />
                            <span className="flex gap-2 px-3 py-3">
                              {item.kind === 'question'
                                ? <CircleHelp className="mt-0.5 size-4 shrink-0 text-status-warning-text" aria-hidden />
                                : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-status-success-text" aria-hidden />}
                              <span className="min-w-0">
                                <span className="block text-sm font-semibold text-foreground">{item.title}</span>
                                <span className="mt-1 block text-xs text-muted-foreground">
                                  {item.kind === 'question'
                                    ? t('warranty_claims.troubleshootingGuides.builder.answerCount', '{count} answers', { count: item.subtitle })
                                    : item.subtitle}
                                </span>
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>

          <aside className="w-full border-t border-border bg-card lg:w-80 lg:border-l lg:border-t-0">
            <div className="border-b border-border px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('warranty_claims.troubleshootingGuides.builder.inspector', 'Inspector')}
              </p>
              <h3 className="mt-1 text-sm font-semibold text-foreground">
                {t('warranty_claims.troubleshootingGuides.builder.question', 'Question')}
              </h3>
            </div>
            <div className="space-y-5 p-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  {t('warranty_claims.troubleshootingGuides.builder.prompt', 'Prompt')}
                </label>
                <Textarea
                  rows={3}
                  value={selectedNode.prompt}
                  disabled={disabled}
                  onChange={(event) => updateSelectedNode((node) => ({ ...node, prompt: event.target.value }))}
                />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">
                    {t('warranty_claims.troubleshootingGuides.builder.answers', 'Answers')}
                  </label>
                  <span className="text-xs text-muted-foreground">{selectedNode.options.length}</span>
                </div>
                <div className="space-y-3">
                  {selectedNode.options.map((option, optionIndex) => (
                    <div key={optionIndex} className="space-y-2 rounded-md border border-border p-3">
                      <div className="flex items-center gap-2">
                        <Input
                          size="sm"
                          value={option.label}
                          disabled={disabled}
                          aria-label={t('warranty_claims.troubleshootingGuides.builder.answerLabel', 'Answer label')}
                          onChange={(event) => commit(updateOption(tree, selectedPath, optionIndex, (current) => ({
                            ...current,
                            label: event.target.value,
                          })))}
                        />
                        <IconButton
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={disabled}
                          aria-label={t('warranty_claims.troubleshootingGuides.builder.removeAnswer', 'Remove answer')}
                          title={t('warranty_claims.troubleshootingGuides.builder.removeAnswer', 'Remove answer')}
                          onClick={() => updateSelectedNode((node) => ({
                            ...node,
                            options: node.options.filter((_, index) => index !== optionIndex),
                          }))}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </IconButton>
                      </div>
                      <Select
                        value={option.next ? 'question' : 'outcome'}
                        disabled={disabled}
                        onValueChange={(mode) => commit(updateOption(tree, selectedPath, optionIndex, (current) => (
                          mode === 'question'
                            ? {
                              label: current.label,
                              next: current.next ?? {
                                prompt: t('warranty_claims.troubleshootingGuides.builder.newQuestion', 'New question'),
                                options: [],
                              },
                            }
                            : {
                              label: current.label,
                              reasonCode: current.reasonCode ?? 'FLT-00',
                              resolution: current.resolution ?? t('warranty_claims.troubleshootingGuides.builder.newResolution', 'Add resolution guidance'),
                            }
                        )))}
                      >
                        <SelectTrigger size="sm" aria-label={t('warranty_claims.troubleshootingGuides.builder.answerDestination', 'Answer destination')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="question">{t('warranty_claims.troubleshootingGuides.builder.nextQuestion', 'Next question')}</SelectItem>
                          <SelectItem value="outcome">{t('warranty_claims.troubleshootingGuides.builder.outcome', 'Outcome')}</SelectItem>
                        </SelectContent>
                      </Select>
                      {option.next ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="w-full justify-start"
                          onClick={() => setSelectedPath([...selectedPath, optionIndex])}
                        >
                          <ArrowRight className="size-4" aria-hidden />
                          {t('warranty_claims.troubleshootingGuides.builder.editNextQuestion', 'Edit next question')}
                        </Button>
                      ) : (
                        <div className="space-y-2">
                          <Input
                            size="sm"
                            value={option.reasonCode ?? ''}
                            disabled={disabled}
                            placeholder={t('warranty_claims.troubleshootingGuides.builder.reasonCode', 'Reason code')}
                            aria-label={t('warranty_claims.troubleshootingGuides.builder.reasonCode', 'Reason code')}
                            onChange={(event) => commit(updateOption(tree, selectedPath, optionIndex, (current) => ({
                              label: current.label,
                              reasonCode: event.target.value,
                              resolution: current.resolution,
                            })))}
                          />
                          <Input
                            size="sm"
                            value={option.resolution ?? ''}
                            disabled={disabled}
                            placeholder={t('warranty_claims.troubleshootingGuides.builder.resolution', 'Resolution guidance')}
                            aria-label={t('warranty_claims.troubleshootingGuides.builder.resolution', 'Resolution guidance')}
                            onChange={(event) => commit(updateOption(tree, selectedPath, optionIndex, (current) => ({
                              label: current.label,
                              reasonCode: current.reasonCode,
                              resolution: event.target.value,
                            })))}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  disabled={disabled}
                  onClick={() => updateSelectedNode((node) => ({
                    ...node,
                    options: [...node.options, {
                      label: t('warranty_claims.troubleshootingGuides.builder.newAnswer', 'New answer'),
                      reasonCode: 'FLT-00',
                      resolution: t('warranty_claims.troubleshootingGuides.builder.newResolution', 'Add resolution guidance'),
                    }],
                  }))}
                >
                  <Plus className="size-4" aria-hidden />
                  {t('warranty_claims.troubleshootingGuides.builder.addAnswer', 'Add answer')}
                </Button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
