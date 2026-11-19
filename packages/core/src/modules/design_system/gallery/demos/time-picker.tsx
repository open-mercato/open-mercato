import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TimePickerDurationChip, TimePickerSlot, TimePickerStatusChip } from '@open-mercato/ui/primitives/time-picker'

const states = ['default', 'hover', 'selected', 'disabled'] as const
const statuses = ['available', 'busy', 'in-meeting', 'offline'] as const

export function TimePickerStatusExamples() {
  const t = useT()
  const [active, setActive] = React.useState<string[]>(statuses.map(status => `selected-${status}`))
  return <div className="grid w-full gap-4 sm:grid-cols-2">{states.map(state => <div key={state} className="space-y-2">
    <p className="text-xs text-muted-foreground">{state}</p><div className="flex flex-wrap gap-2">{statuses.map(status => {
      const key = `${state}-${status}`
      return <TimePickerStatusChip key={key} variant={status} label={t(`design_system.gallery.samples.time.${status}`)} state={state === 'selected' ? 'default' : state} selected={active.includes(key)} disabled={state === 'disabled'} onSelect={() => setActive(value => value.includes(key) ? value.filter(item => item !== key) : [...value, key])} />
    })}</div>
  </div>)}</div>
}

export function TimePickerDurationExamples() {
  const t = useT()
  const [active, setActive] = React.useState<string[]>(['selected'])
  return <div className="flex flex-wrap gap-4">{states.map(state => <div key={state} className="space-y-2"><p className="text-xs text-muted-foreground">{state === 'selected' ? 'active' : state}</p><TimePickerDurationChip value={30} label={t('design_system.gallery.samples.time.duration')} state={state === 'selected' ? 'default' : state} selected={active.includes(state)} disabled={state === 'disabled'} onSelect={() => setActive(value => value.includes(state) ? value.filter(item => item !== state) : [...value, state])} /></div>)}</div>
}

export function TimePickerSlotExamples() {
  const [active, setActive] = React.useState<string[]>(['right-selected', 'center-selected'])
  return <div className="grid w-full gap-5 sm:grid-cols-2">{(['right', 'center'] as const).map(position => <div key={position} className="w-full max-w-80 space-y-2"><p className="text-xs text-muted-foreground">{position}</p>{states.map(state => {
    const key = `${position}-${state}`
    return <TimePickerSlot key={key} value="09:30" rightText="09:30" checkPosition={position} state={state === 'selected' ? 'default' : state} selected={active.includes(key)} disabled={state === 'disabled'} onSelect={() => setActive(value => value.includes(key) ? value.filter(item => item !== key) : [...value, key])} />
  })}</div>)}</div>
}
