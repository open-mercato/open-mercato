'use client'

import * as React from 'react'
import { ArrowRight, ListChecks, RotateCcw } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@open-mercato/ui/primitives/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import scenarioData from '../data/scenarios.json'
import ledgerScenarios from '../data/ledger-spec-scenarios.json'
import operationsScenarios from '../data/operations-spec-scenarios.json'
import taxScenarios from '../data/tax-spec-scenarios.json'

type Scenario = {
  id: string
  title: string
  role: string
  goal: string
  resetKeys: string[]
  steps: Array<{ screen: string; task: string }>
}

const scenarios = [
  ...scenarioData,
  ...ledgerScenarios,
  ...operationsScenarios,
  ...taxScenarios,
] as Scenario[]
const selectionKey = 'finance-preview-selected-scenario'
const screenKey = 'finance-preview-selected-scenario-screen'

export function ScenarioGuide({
  activeId,
  goTo,
  onStart,
}: {
  activeId: string
  goTo: (id: string) => void
  onStart: (screenId: string, resetKeys: string[]) => void
}) {
  const t = useT()
  const [activeScenarioId, setActiveScenarioId] = React.useState('')
  const [draftId, setDraftId] = React.useState('')
  const [resumeScreen, setResumeScreen] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const selected = scenarios.find((scenario) => scenario.id === draftId)
  const activeScenario = scenarios.find(
    (scenario) => scenario.id === activeScenarioId,
  )

  React.useEffect(() => {
    const saved = window.sessionStorage.getItem(selectionKey)
    const scenario = scenarios.find((item) => item.id === saved)
    if (!scenario) return
    setActiveScenarioId(scenario.id)
    setDraftId(scenario.id)
    const savedScreen = window.sessionStorage.getItem(screenKey)
    setResumeScreen(
      savedScreen && scenario.steps.some((step) => step.screen === savedScreen)
        ? savedScreen
        : scenario.steps[0].screen,
    )
  }, [])

  React.useEffect(() => {
    if (!activeScenario?.steps.some((step) => step.screen === activeId)) return
    setResumeScreen(activeId)
    window.sessionStorage.setItem(screenKey, activeId)
  }, [activeId, activeScenario])

  const start = () => {
    if (!selected) return
    const firstScreen = selected.steps[0].screen
    setActiveScenarioId(selected.id)
    setResumeScreen(firstScreen)
    window.sessionStorage.setItem(selectionKey, selected.id)
    window.sessionStorage.setItem(screenKey, firstScreen)
    onStart(firstScreen, selected.resetKeys)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <ListChecks className="size-4" aria-hidden="true" />
          {t('finance_previews.scenario.launcher')}
        </Button>
      </DialogTrigger>
      <DialogContent
        size="lg"
        data-testid="scenario-guide"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            start()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('finance_previews.scenario.title')}</DialogTitle>
          <DialogDescription>
            {t('finance_previews.scenario.hint')}
          </DialogDescription>
        </DialogHeader>
        <Select value={draftId} onValueChange={setDraftId}>
          <SelectTrigger
            className="w-full"
            aria-label={t('finance_previews.scenario.select')}
          >
            <SelectValue placeholder={t('finance_previews.scenario.select')} />
          </SelectTrigger>
          <SelectContent>
            {scenarios.map((scenario) => (
              <SelectItem key={scenario.id} value={scenario.id}>
                {scenario.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selected ? (
          <div className="space-y-4">
            <div>
              <p className="font-medium">{selected.role}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {selected.goal}
              </p>
            </div>
            <ol className="max-h-64 list-decimal space-y-3 overflow-y-auto border-y border-border py-4 pl-6 pr-3 text-sm">
              {selected.steps.map((step, index) => (
                <li key={selected.id + '-' + index} className="pl-1">
                  {step.task}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        <DialogFooter>
          {selected && selected.id === activeScenarioId ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                goTo(resumeScreen || selected.steps[0].screen)
                setOpen(false)
              }}
            >
              {t('finance_previews.scenario.resume')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="primary-filled"
            disabled={!selected}
            onClick={start}
          >
            {selected?.id === activeScenarioId ? (
              <RotateCcw aria-hidden="true" />
            ) : (
              <ArrowRight aria-hidden="true" />
            )}
            {t(
              selected?.id === activeScenarioId
                ? 'finance_previews.scenario.restart'
                : 'finance_previews.scenario.start',
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
