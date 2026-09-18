/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../accordion'
import { ActivityFeedComment, ActivityFeedFileChip } from '../activity-feed'
import { Alert } from '../alert'
import { Badge } from '../badge'
import { Calendar } from '../calendar'
import { ColorPicker } from '../color-picker'
import { CommandMenu, CommandMenuContent, CommandMenuInput } from '../command-menu'
import { Checkbox } from '../checkbox'
import { CounterInput } from '../counter-input'
import { DatePicker } from '../date-picker'
import { DateRangePicker } from '../date-range-picker'
import { Dialog, DialogContent } from '../dialog'
import { Drawer, DrawerContent } from '../drawer'
import { Pagination } from '../pagination'
import { PasswordInput } from '../password-input'
import { Radio, RadioGroup } from '../radio'
import { Rating } from '../rating'
import { RichEditorColorPalette, richEditorItemVariants } from '../rich-editor'
import { SearchInput } from '../search-input'
import { SegmentedControl, SegmentedControlItem } from '../segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select'
import { Sheet, SheetContent } from '../sheet'
import { StepIndicator } from '../step-indicator'
import { Tabs, TabsList, TabsTrigger } from '../tabs'
import { Tag } from '../tag'
import { TimePicker } from '../time-picker'

// Tailwind v4 dropped the preflight rule that gave `button` and `[role="button"]`
// a pointer cursor, so every clickable primitive has to carry `cursor-pointer`
// itself. Nothing breaks without it — the control just stops looking pressable —
// which is exactly why it needs a test.
const render: typeof rtlRender = (ui: React.ReactElement, options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(<I18nProvider locale="en" dict={{}}>{ui}</I18nProvider>, options)

function expectPointer(element: Element | null | undefined) {
  expect(element).toBeTruthy()
  expect(element!.className).toContain('cursor-pointer')
}

describe('clickable primitives advertise a pointer cursor', () => {
  it('AccordionTrigger', () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="a">
          <AccordionTrigger>Section</AccordionTrigger>
          <AccordionContent>Body</AccordionContent>
        </AccordionItem>
      </Accordion>,
    )
    expectPointer(screen.getByRole('button', { name: 'Section' }))
  })

  it('Checkbox', () => {
    render(<Checkbox aria-label="Accept" />)
    expectPointer(screen.getByRole('checkbox', { name: 'Accept' }))
  })

  it('Radio', () => {
    render(
      <RadioGroup>
        <Radio value="one" aria-label="One" />
      </RadioGroup>,
    )
    expectPointer(screen.getByRole('radio', { name: 'One' }))
  })

  it('SelectTrigger', () => {
    render(
      <Select>
        <SelectTrigger aria-label="Status">
          <SelectValue />
        </SelectTrigger>
      </Select>,
    )
    expectPointer(screen.getByRole('combobox', { name: 'Status' }))
  })

  it('SelectItem', () => {
    render(
      <Select defaultOpen>
        <SelectTrigger aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="open">Open</SelectItem>
        </SelectContent>
      </Select>,
    )
    expectPointer(document.querySelector('[role="option"]'))
  })

  it('SegmentedControlItem', () => {
    render(
      <SegmentedControl value="all" onValueChange={() => {}} aria-label="View">
        <SegmentedControlItem value="all">All</SegmentedControlItem>
      </SegmentedControl>,
    )
    expectPointer(screen.getByRole('radio', { name: 'All' }))
  })

  it('TabsTrigger (underline variant)', () => {
    render(
      <Tabs defaultValue="a" variant="underline">
        <TabsList>
          <TabsTrigger value="a">First</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    expectPointer(screen.getByRole('tab', { name: 'First' }))
  })

  it('Pagination page cells and nav buttons', () => {
    render(<Pagination page={2} pageSize={10} total={50} onPageChange={() => {}} />)
    expectPointer(document.querySelector('[data-slot="pagination-next"]'))
    expectPointer(document.querySelector('[data-slot="pagination-page"]'))
  })

  it('CounterInput steppers', () => {
    render(<CounterInput value={1} onChange={() => {}} />)
    expectPointer(screen.getByRole('button', { name: 'Increase' }))
    expectPointer(screen.getByRole('button', { name: 'Decrease' }))
  })

  it('Rating stars', () => {
    render(<Rating value={2} max={3} onChange={() => {}} />)
    expectPointer(document.querySelector('[data-slot="rating-item"]'))
  })

  it('PasswordInput reveal toggle', () => {
    render(<PasswordInput defaultValue="secret" />)
    expectPointer(screen.getByRole('button'))
  })

  it('SearchInput clear button', () => {
    render(<SearchInput value="query" onChange={() => {}} />)
    expectPointer(screen.getByRole('button', { name: 'Clear search' }))
  })

  it('Tag remove button', () => {
    render(<Tag onRemove={() => {}}>Berlin</Tag>)
    expectPointer(document.querySelector('[data-slot="tag-remove"]'))
  })

  it('Calendar day and month-navigation buttons', () => {
    render(<Calendar mode="single" month={new Date(2026, 4, 1)} />)
    expectPointer(document.querySelector('[role="gridcell"] button'))
    expectPointer(document.querySelector('[aria-label^="Go to previous month"]'))
  })

  it('DatePicker trigger', () => {
    render(<DatePicker value={null} onChange={() => {}} />)
    expectPointer(document.querySelector('[data-slot="date-picker-trigger"]'))
  })

  it('DateRangePicker trigger', () => {
    render(<DateRangePicker value={null} onChange={() => {}} />)
    expectPointer(document.querySelector('[data-slot="date-range-picker-trigger"]'))
  })
  it('ActivityFeed download and reply buttons', () => {
    render(
      <>
        <ActivityFeedFileChip name="report.pdf" onDownload={() => {}} />
        <ActivityFeedComment onReply={() => {}}>Looks good</ActivityFeedComment>
      </>,
    )
    expectPointer(document.querySelector('[data-slot="activity-feed-file-chip-download"]'))
    expectPointer(document.querySelector('[data-slot="activity-feed-comment-reply"]'))
  })

  it('Alert dismiss button', () => {
    render(<Alert dismissible onDismiss={() => {}}>Heads up</Alert>)
    expectPointer(document.querySelector('[data-slot="alert-dismiss"]'))
  })

  it('Badge remove button', () => {
    render(<Badge removable onRemove={() => {}}>Draft</Badge>)
    expectPointer(document.querySelector('[data-slot="badge-remove"]'))
  })

  it('ColorPicker trigger and swatches', async () => {
    render(<ColorPicker value="#112233" onChange={() => {}} />)
    const trigger = document.querySelector('[data-slot="color-picker-trigger"]')
    expectPointer(trigger)
    await act(async () => {
      fireEvent.click(trigger!)
    })
    expectPointer(document.querySelector('[data-slot="color-picker-swatch"]'))
  })

  it('CommandMenu input clear button', () => {
    render(
      <CommandMenu open>
        <CommandMenuContent>
          <CommandMenuInput value="query" onValueChange={() => {}} />
        </CommandMenuContent>
      </CommandMenu>,
    )
    expectPointer(document.querySelector('[data-slot="command-menu-input-clear"]'))
  })

  it('DateRangePicker preset buttons', async () => {
    render(<DateRangePicker value={null} onChange={() => {}} />)
    await act(async () => {
      fireEvent.click(document.querySelector('[data-slot="date-range-picker-trigger"]')!)
    })
    expectPointer(document.querySelector('[data-slot="date-range-presets"] button'))
  })

  it('Dialog, Drawer and Sheet close buttons', () => {
    render(
      <>
        <Dialog open>
          <DialogContent>Dialog body</DialogContent>
        </Dialog>
        <Drawer open>
          <DrawerContent>Drawer body</DrawerContent>
        </Drawer>
        <Sheet open>
          <SheetContent closeLabel="Close sheet">Sheet body</SheetContent>
        </Sheet>
      </>,
    )
    expectPointer(document.querySelector('[data-slot="dialog-close-button"]'))
    expectPointer(document.querySelector('[data-slot="drawer-close-button"]'))
    expectPointer(document.querySelector('[aria-label="Close sheet"]'))
  })

  it('RichEditor toolbar items and colour palette', () => {
    expect(richEditorItemVariants()).toContain('cursor-pointer')
    render(<RichEditorColorPalette value="default" onChange={() => {}} />)
    expectPointer(document.querySelector('[role="option"]'))
  })

  it('StepIndicator clickable steps', () => {
    render(
      <StepIndicator
        steps={[
          { id: 'one', label: 'One', status: 'complete' },
          { id: 'two', label: 'Two', status: 'current' },
        ]}
        onStepClick={() => {}}
      />,
    )
    expectPointer(document.querySelector('[data-slot="step-indicator-item"] button'))
  })

  it('TimePicker close button', () => {
    render(<TimePicker value={null} onChange={() => {}} onClose={() => {}} />)
    expectPointer(document.querySelector('[data-slot="time-picker-close"]'))
  })
})
