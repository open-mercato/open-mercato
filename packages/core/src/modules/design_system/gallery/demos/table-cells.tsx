import * as React from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { ButtonGroup } from '@open-mercato/ui/primitives/button-group'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { Rating } from '@open-mercato/ui/primitives/rating'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'

const examples = ['Leading', 'Regular', 'Passive', 'Empty', 'Button', 'ButtonGroup', 'Switch', 'Rating', 'Progress', 'StatusBadge', 'BadgeGroup', 'AvatarStack']

export function TableHeaderExamples() {
  const t = useT()
  const [selected, setSelected] = React.useState(false)
  const [order, setOrder] = React.useState<'none' | 'ascending' | 'descending'>('none')
  const SortIcon = order === 'ascending' ? ArrowUp : order === 'descending' ? ArrowDown : ArrowUpDown
  return <div className="w-full space-y-3 overflow-x-auto">
    <Table className="w-[576px] table-fixed">
      <TableCaption className="sr-only">{t('design_system.gallery.samples.table.caption')}</TableCaption>
      <TableHeader><TableRow>
        <TableHead scope="col" aria-sort={order} className="h-9 w-64 bg-muted px-3 py-0">
          <div className="flex items-center gap-2.5">
            <Checkbox checked={selected} onCheckedChange={value => setSelected(value === true)} aria-label={t('design_system.gallery.samples.table.selection')} />
            <Button size="sm" variant="ghost" className="h-auto gap-0.5 p-0 font-normal" onClick={() => setOrder(value => value === 'none' ? 'ascending' : value === 'ascending' ? 'descending' : 'none')}>
              {t('design_system.gallery.samples.table.component')}<SortIcon className="size-5" aria-hidden="true" />
            </Button>
          </div>
        </TableHead>
        <TableHead scope="col" className="h-9 w-64 bg-muted px-3 py-0">
          <div className="flex items-center gap-2.5">
            <Checkbox disabled aria-label={t('design_system.gallery.samples.table.selection')} />
            <Button disabled size="sm" variant="ghost" className="h-auto gap-0.5 p-0 font-normal">{t('design_system.gallery.samples.table.preview')}<ArrowUpDown className="size-5" aria-hidden="true" /></Button>
          </div>
        </TableHead>
        <TableHead scope="col" className="h-9 w-16 bg-muted px-3 py-0"><span className="sr-only">{t('design_system.gallery.samples.table.empty')}</span></TableHead>
      </TableRow></TableHeader>
      <TableBody><TableRow data-state={selected ? 'selected' : undefined}>
        <TableCell>{t('design_system.gallery.variantTitles.default')}</TableCell><TableCell>{t('design_system.gallery.variantTitles.disabled')}</TableCell><TableCell>{t('design_system.gallery.variantTitles.empty')}</TableCell>
      </TableRow></TableBody>
    </Table>
    <p role="status" className="text-sm text-muted-foreground">{t('design_system.gallery.samples.table.selected', { count: Number(selected) })}</p>
  </div>
}

export function TableCellExamples({ rowHeight }: { rowHeight: 48 | 64 }) {
  const t = useT()
  const [selected, setSelected] = React.useState(['Leading'])
  const [order, setOrder] = React.useState<'none' | 'ascending' | 'descending'>('none')
  const [rating, setRating] = React.useState(3)
  const [notice, setNotice] = React.useState('')
  const typeLabel = (type: string) => t(`design_system.gallery.samples.table.types.${type}`, type)
  const sorted = order === 'none' ? examples : [...examples].sort((a, b) => order === 'ascending' ? typeLabel(a).localeCompare(typeLabel(b)) : typeLabel(b).localeCompare(typeLabel(a)))
  const SortIcon = order === 'ascending' ? ArrowUp : order === 'descending' ? ArrowDown : ArrowUpDown
  const label = t('design_system.gallery.samples.table.label')
  function cell(type: string) {
    switch (type) {
      case 'Leading': return <div className="flex items-center gap-3"><Avatar label="Wei Chen" size={rowHeight === 48 ? 32 : 40} /><div className="space-y-0.5"><p className="text-sm font-medium leading-5">Wei Chen</p>{rowHeight === 64 ? <p className="text-xs leading-4 text-muted-foreground">{t('design_system.gallery.samples.table.description')}</p> : null}</div></div>
      case 'Regular': return <span>{label}</span>
      case 'Passive': return <span className="text-muted-foreground">{label}</span>
      case 'Empty': return <span className="sr-only">{t('design_system.gallery.samples.table.empty')}</span>
      case 'Button': return <Button size="sm" variant="outline" onClick={() => setNotice(t('design_system.gallery.samples.table.actionDone'))}>{t('design_system.gallery.samples.table.action')}</Button>
      case 'ButtonGroup': return <ButtonGroup size={32} aria-label={t('design_system.gallery.samples.table.actions')}><Button variant="outline" size="icon" aria-label={t('design_system.gallery.examples.navigation.previous')} onClick={() => setNotice(t('design_system.gallery.examples.navigation.previous'))}><ChevronLeft /></Button><Button variant="outline" size="icon" aria-label={t('design_system.gallery.examples.navigation.next')} onClick={() => setNotice(t('design_system.gallery.examples.navigation.next'))}><ChevronRight /></Button></ButtonGroup>
      case 'Switch': return <Switch aria-label={t('design_system.gallery.samples.table.enabled')} defaultChecked />
      case 'Rating': return <Rating value={rating} onChange={setRating} aria-label={t('design_system.gallery.samples.rating.label')} />
      case 'Progress': return <Progress value={65} className="w-40" aria-label={t('design_system.gallery.examples.navigation.progress')} />
      case 'StatusBadge': return <StatusBadge variant="success" appearance="light" dot>{t('design_system.gallery.samples.table.ready')}</StatusBadge>
      case 'BadgeGroup': return <div className="flex gap-1"><Badge size={20} appearance="lighter" tone="purple">CRM</Badge><Badge size={20} appearance="lighter" tone="sky">ERP</Badge><Badge size={20} appearance="stroke" tone="neutral" numeric>+2</Badge></div>
      case 'AvatarStack': return <AvatarStack max={3} size={24}><Avatar size={24} label="Wei Chen" /><Avatar size={24} label="Laura Perez" /><Avatar size={24} label="Omar Haddad" /><Avatar size={24} label="James Brown" /></AvatarStack>
      default: return null
    }
  }
  return <div className="w-full min-w-0 space-y-3">
    <div className="w-full overflow-x-auto rounded-lg border border-border">
      <Table className="min-w-[600px]">
        <TableCaption className="sr-only">{t('design_system.gallery.samples.table.caption')}</TableCaption>
        <TableHeader><TableRow>
          <TableHead className="h-9 w-12 py-1"><span className="sr-only">{t('design_system.gallery.samples.table.selection')}</span></TableHead>
          <TableHead aria-sort={order} className="h-9 py-1"><Button variant="ghost" size="sm" className="h-auto gap-2 p-0" onClick={() => setOrder(value => value === 'ascending' ? 'descending' : 'ascending')}>{t('design_system.gallery.samples.table.component')}<SortIcon aria-hidden="true" className="size-5" /></Button></TableHead>
          <TableHead className="h-9 py-1">{t('design_system.gallery.samples.table.preview')}</TableHead>
        </TableRow></TableHeader>
        <TableBody>{sorted.map(type => <TableRow key={type} data-state={selected.includes(type) ? 'selected' : undefined} className="data-[state=selected]:bg-muted">
          <TableCell className={rowHeight === 48 ? 'h-12 py-0' : 'h-16 py-0'}><Checkbox checked={selected.includes(type)} aria-label={t('design_system.gallery.samples.table.select', { name: typeLabel(type) })} onCheckedChange={checked => setSelected(value => checked ? [...value, type] : value.filter(item => item !== type))} /></TableCell>
          <TableCell className="font-medium">{typeLabel(type)}</TableCell>
          <TableCell className={rowHeight === 48 ? 'h-12 py-0' : 'h-16 py-0'}>{cell(type)}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div>
    <p role="status" className="min-h-5 text-sm text-muted-foreground">{notice || t('design_system.gallery.samples.table.selected', { count: selected.length })}</p>
  </div>
}

export function tableCellExampleCode(rowHeight: 48 | 64) {
  return `import * as React from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { ButtonGroup } from '@open-mercato/ui/primitives/button-group'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { Rating } from '@open-mercato/ui/primitives/rating'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@open-mercato/ui/primitives/table'

function Example() {
  const [rating, setRating] = React.useState(3)
  const [selected, setSelected] = React.useState<string[]>(['Leading'])
  const [action, setAction] = React.useState('')
  const [order, setOrder] = React.useState<'none' | 'ascending' | 'descending'>('none')
  const SortIcon = order === 'ascending' ? ArrowUp : order === 'descending' ? ArrowDown : ArrowUpDown
  const cells = [
    { name: 'Leading', content: <div className="flex items-center gap-3"><Avatar size={${rowHeight === 48 ? 32 : 40}} label="Wei Chen" /><div><p className="font-medium">Wei Chen</p>${rowHeight === 64 ? '<p className="text-xs text-muted-foreground">Account manager</p>' : ''}</div></div> },
    { name: 'Regular', content: <span>Label</span> },
    { name: 'Passive', content: <span className="text-muted-foreground">Label</span> },
    { name: 'Empty', content: null },
    { name: 'Button', content: <Button size="sm" variant="outline" onClick={() => setAction('Opened')}>Open</Button> },
    { name: 'ButtonGroup', content: <ButtonGroup size={32} aria-label="Related actions"><Button variant="outline" size="icon" aria-label="Previous" onClick={() => setAction('Previous')}><ChevronLeft /></Button><Button variant="outline" size="icon" aria-label="Next" onClick={() => setAction('Next')}><ChevronRight /></Button></ButtonGroup> },
    { name: 'Switch', content: <Switch defaultChecked aria-label="Enabled" /> },
    { name: 'Rating', content: <Rating value={rating} onChange={setRating} aria-label="Rating" /> },
    { name: 'Progress', content: <Progress value={65} className="w-40" aria-label="Progress" /> },
    { name: 'StatusBadge', content: <StatusBadge variant="success" appearance="light" dot>Ready</StatusBadge> },
    { name: 'BadgeGroup', content: <div className="flex gap-1"><Badge size={20} appearance="lighter" tone="purple">CRM</Badge><Badge size={20} appearance="lighter" tone="sky">ERP</Badge><Badge size={20} appearance="stroke" tone="neutral" numeric>+2</Badge></div> },
    { name: 'AvatarStack', content: <AvatarStack max={3} size={24}><Avatar size={24} label="Wei Chen" /><Avatar size={24} label="Laura Perez" /><Avatar size={24} label="Omar Haddad" /><Avatar size={24} label="James Brown" /></AvatarStack> },
  ]
  const sorted = order === 'none' ? cells : [...cells].sort((a, b) => order === 'ascending' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name))
  return <div className="w-full overflow-x-auto">
    <Table className="min-w-[600px]">
      <TableHeader><TableRow><TableHead>Selection</TableHead><TableHead aria-sort={order}><Button size="sm" variant="ghost" onClick={() => setOrder(value => value === 'ascending' ? 'descending' : 'ascending')}>Component<SortIcon /></Button></TableHead><TableHead>Preview</TableHead></TableRow></TableHeader>
      <TableBody>{sorted.map(cell => <TableRow key={cell.name} data-state={selected.includes(cell.name) ? 'selected' : undefined} className="data-[state=selected]:bg-muted">
        <TableCell className="${rowHeight === 48 ? 'h-12 py-0' : 'h-16 py-0'}"><Checkbox checked={selected.includes(cell.name)} aria-label={\`Select \${cell.name}\`} onCheckedChange={checked => setSelected(value => checked ? [...value, cell.name] : value.filter(name => name !== cell.name))} /></TableCell>
        <TableCell className="font-medium">{cell.name}</TableCell>
        <TableCell className="${rowHeight === 48 ? 'h-12 py-0' : 'h-16 py-0'}">{cell.content}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
    <p role="status">{action || selected.length + ' rows selected'}</p>
  </div>
}`
}
