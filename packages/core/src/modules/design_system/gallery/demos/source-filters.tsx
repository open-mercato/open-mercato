import * as React from 'react'
import { CalendarDays, Check, Filter, Settings2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { ButtonGroup } from '@open-mercato/ui/primitives/button-group'
import { Calendar } from '@open-mercato/ui/primitives/calendar'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { FilterToolbar, FilterPanelItem, FilterPanelHeader, FilterPanelFooter } from '@open-mercato/ui/primitives/filter-toolbar'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'

type Filters = { date?: Date; statuses: string[] }
const transactionRows = [
  { name: 'Apex', type: 'income', date: new Date(2023, 7, 11), amount: 1240, status: 'completed' },
  { name: 'Spotify', type: 'expense', date: new Date(2023, 7, 10), amount: -12, status: 'completed' },
  { name: 'Synergy', type: 'income', date: new Date(2023, 7, 9), amount: 680, status: 'pending' },
  { name: 'Loom', type: 'expense', date: new Date(2023, 7, 11), amount: -18, status: 'pending' },
]
const emptyFilters = (): Filters => ({ statuses: [] })

function useFilterCopy() {
  const t = useT()
  return (key: string, values?: Record<string, string | number>) => t(`design_system.gallery.examples.sourceFilters.${key}`, values)
}

export function SourceFilterPanel({ value, onApply }: { value?: Filters; onApply?: (value: Filters) => void }) {
  const copy = useFilterCopy()
  const [draft, setDraft] = React.useState<Filters>(() => value ?? emptyFilters())
  const [section, setSection] = React.useState('date')
  const [applied, setApplied] = React.useState(false)
  const panelId = React.useId()
  function clear() { setDraft(emptyFilters()); setApplied(false) }
  return <div className="w-full min-w-0 bg-background" data-example="filter-panel">
    <div className="flex flex-col sm:flex-row">
      <div className="flex shrink-0 flex-wrap gap-1 border-b border-border p-3 sm:w-[224px] sm:flex-col sm:border-b-0 sm:border-r" role="group" aria-label={copy('categories')}>
        <FilterPanelItem active={section === 'date'} leading={<CalendarDays />} aria-controls={panelId} onClick={() => setSection('date')}>{copy('date')}</FilterPanelItem>
        <FilterPanelItem active={section === 'status'} leading={<Check />} aria-controls={panelId} onClick={() => setSection('status')}>{copy('status')}</FilterPanelItem>
      </div>
      <section id={panelId} aria-label={copy(section)} className="min-w-0 flex-1">
        <FilterPanelHeader title={copy(section)} leading={section === 'date' ? <CalendarDays /> : <Check />} action={<Button variant="link" className="h-auto p-0 text-sm leading-5 text-muted-foreground" onClick={clear}>{copy('clear')}</Button>} />
        <div className="flex min-h-80 justify-center px-5 pb-5">
          {section === 'date'
            ? <Calendar mode="single" defaultMonth={draft.date ?? new Date(2023, 7, 1)} selected={draft.date} onSelect={date => { setDraft(previous => ({ ...previous, date })); setApplied(false) }} />
            : <div className="w-full space-y-4 pt-2">{['completed', 'pending'].map(status => <CheckboxField key={status} label={copy(status)} checked={draft.statuses.includes(status)} onCheckedChange={checked => { setDraft(previous => ({ ...previous, statuses: checked ? [...previous.statuses, status] : previous.statuses.filter(item => item !== status) })); setApplied(false) }} />)}</div>}
        </div>
      </section>
    </div>
    <FilterPanelFooter><Button variant="outline" onClick={clear}>{copy('clear')}</Button><Button variant="primary-filled" onClick={() => { onApply?.(draft); setApplied(true) }}>{copy('apply')}</Button></FilterPanelFooter>
    {applied ? <p role="status" className="px-5 pb-4 text-sm text-muted-foreground">{copy('applied')}</p> : null}
  </div>
}

export function SourceFilterParts() {
  const copy = useFilterCopy()
  const [active, setActive] = React.useState(2)
  const [notice, setNotice] = React.useState('')
  return <div className="grid w-full gap-6">
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {['Default', 'Hover', 'Active'].map((state, index) => <div key={state} className="w-[200px] max-w-full space-y-2">
        <p className="text-xs text-muted-foreground">{state}</p>
        <FilterPanelItem active={active === index} leading={<CalendarDays />} onClick={() => setActive(index)}>{copy('date')}</FilterPanelItem>
      </div>)}
    </div>
    <div className="w-[400px] max-w-full rounded-md border border-border"><FilterPanelHeader title={copy('date')} leading={<CalendarDays />} action={<Button variant="link" className="h-auto p-0 text-sm leading-5 text-muted-foreground" onClick={() => { setActive(-1); setNotice(copy('cleared')) }}>{copy('clear')}</Button>} /></div>
    <div className="w-[472px] max-w-full"><FilterPanelFooter><Button variant="outline" onClick={() => { setActive(-1); setNotice(copy('cleared')) }}>{copy('clear')}</Button><Button variant="primary-filled" onClick={() => setNotice(copy('applied'))}>{copy('apply')}</Button></FilterPanelFooter></div>
    <p role="status" className="min-h-5 text-sm text-muted-foreground">{notice}</p>
  </div>
}

export function SourceFilterToolbar({ type }: { type: 'table' | 'calendar' }) {
  const copy = useFilterCopy()
  const [query, setQuery] = React.useState('')
  const [category, setCategory] = React.useState('all')
  const [sort, setSort] = React.useState('recent')
  const [period, setPeriod] = React.useState('7')
  const [endDate, setEndDate] = React.useState(new Date(2023, 7, 11))
  const [filters, setFilters] = React.useState<Filters>(emptyFilters)
  const [filterOpen, setFilterOpen] = React.useState(false)
  const [showAmount, setShowAmount] = React.useState(true)
  const [dateOpen, setDateOpen] = React.useState(false)
  const periodStart = new Date(endDate)
  periodStart.setDate(endDate.getDate() - Number(period))
  const rows = transactionRows.filter(row => {
    if (category !== 'all' && row.type !== category) return false
    if (query && !row.name.toLowerCase().includes(query.trim().toLowerCase())) return false
    if (filters.statuses.length && !filters.statuses.includes(row.status)) return false
    if (filters.date && row.date.toDateString() !== filters.date.toDateString()) return false
    return type !== 'calendar' || (row.date >= periodStart && row.date <= endDate)
  }).sort((a, b) => sort === 'amount' ? b.amount - a.amount : b.date.getTime() - a.date.getTime())
  const dateText = `${periodStart.toLocaleDateString()} – ${endDate.toLocaleDateString()}`
  return <div className="w-full min-w-0 space-y-4" data-example={`filter-toolbar-${type}`}>
    <FilterToolbar className="max-w-[1104px]" leading={type === 'table'
      ? <SegmentedControl value={category} onValueChange={setCategory} aria-label={copy('transactionType')} className="h-9 w-80 max-w-full rounded-md border-0 p-1">
        {['all', 'income', 'expense'].map(item => <SegmentedControlItem key={item} value={item} className="flex-1 rounded-sm">{copy(item)}</SegmentedControlItem>)}
      </SegmentedControl>
      : <><Button variant="outline" onClick={() => { setEndDate(new Date()); setPeriod('0') }}>{copy('today')}</Button>
        <ButtonGroup size={36} aria-label={copy('dateRange')} className="max-w-full flex-wrap">
          <Select value={period} onValueChange={setPeriod}><SelectTrigger className="w-auto" aria-label={copy('period')}><SelectValue /></SelectTrigger><SelectContent>{['0', '7', '30'].map(item => <SelectItem key={item} value={item}>{copy(`period${item}`)}</SelectItem>)}</SelectContent></Select>
          <Popover open={dateOpen} onOpenChange={setDateOpen}><PopoverTrigger asChild><Button variant="outline" aria-label={copy('dateRange')}><CalendarDays className="size-5" aria-hidden="true" /><span className="truncate">{dateText}</span></Button></PopoverTrigger><PopoverContent className="w-auto p-3" align="start"><Calendar mode="single" selected={endDate} defaultMonth={endDate} onSelect={date => { if (date) { setEndDate(date); setDateOpen(false) } }} /></PopoverContent></Popover>
        </ButtonGroup></>}>
      <SearchInput value={query} onChange={setQuery} aria-label={copy('search')} placeholder={copy('search')} className="w-[300px] max-w-full [&>svg]:size-5" />
      <Popover open={filterOpen} onOpenChange={setFilterOpen}><PopoverTrigger asChild><Button variant="outline"><Filter className="size-5" aria-hidden="true" />{copy('filter')}</Button></PopoverTrigger>
        <PopoverContent className="w-[640px] max-w-[calc(100vw-24px)] overflow-hidden p-0" align="end"><SourceFilterPanel value={filters} onApply={value => { setFilters(value); setFilterOpen(false) }} /></PopoverContent>
      </Popover>
      <Popover><PopoverTrigger asChild><IconButton variant="outline" aria-label={copy('settings')}><Settings2 className="size-5" /></IconButton></PopoverTrigger><PopoverContent className="w-60"><CheckboxField checked={showAmount} onCheckedChange={checked => setShowAmount(checked === true)} label={copy('showAmount')} /></PopoverContent></Popover>
      {type === 'table' ? <Select value={sort} onValueChange={setSort}><SelectTrigger className="w-40" aria-label={copy('sort')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="recent">{copy('recent')}</SelectItem><SelectItem value="amount">{copy('amount')}</SelectItem></SelectContent></Select> : null}
    </FilterToolbar>
    <p role="status" className="text-sm text-muted-foreground">{copy('results', { count: rows.length })}</p>
    <div className="overflow-x-auto rounded-md border border-border"><Table className="min-w-[440px]">
      <TableHeader><TableRow><TableHead>{copy('name')}</TableHead><TableHead>{copy('status')}</TableHead>{showAmount ? <TableHead className="text-right">{copy('amount')}</TableHead> : null}</TableRow></TableHeader>
      <TableBody>{rows.map(row => <TableRow key={row.name}><TableCell className="font-medium">{row.name}</TableCell><TableCell>{copy(row.status)}</TableCell>{showAmount ? <TableCell className="text-right tabular-nums">{row.amount.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}</TableCell> : null}</TableRow>)}</TableBody>
    </Table></div>
    <Button size="sm" variant="ghost" onClick={() => { setQuery(''); setCategory('all'); setFilters(emptyFilters()); setPeriod('7'); setEndDate(new Date(2023, 7, 11)); setSort('recent'); setShowAmount(true) }}>{copy('reset')}</Button>
  </div>
}
