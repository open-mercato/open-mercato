import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Combobox, type ComboboxItem } from './combobox'
import { Checkbox } from './checkbox'

const meta = {
  title: 'Primitives/Combobox',
  component: Combobox,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Editable combobox (list autocomplete) for search typeahead and address lookup. The input keeps focus; arrows move `aria-activedescendant`, Enter selects, Escape closes then clears. `idle` holds recent and popular searches, `footer` holds “See all results” or “Enter address manually”.',
      },
    },
  },
} satisfies Meta<typeof Combobox>

export default meta
type Story = StoryObj<typeof meta>

const catalogue: ComboboxItem[] = [
  { id: 'guji', group: 'Products', label: 'Guji Hambela', description: 'Ethiopia, jasmine and peach', trailing: '129,00 zł' },
  { id: 'nyama', group: 'Products', label: 'Nyamasheke', description: 'Rwanda, natural, plum', trailing: '129,00 zł' },
  { id: 'huila', group: 'Products', label: 'Huila Pink Bourbon', description: 'Colombia, red fruit', trailing: '99,00 zł' },
  { id: 'cat-eth', group: 'Categories', label: 'Coffee / Ethiopia' },
  { id: 'guide', group: 'Categories', label: 'Brewing guides / Ethiopian coffees' },
]

function SearchDemo() {
  const [value, setValue] = React.useState('ethi')
  const items = value ? catalogue.filter((item) => String(item.label).toLowerCase().includes(value.toLowerCase()) || item.group === 'Categories') : []
  return (
    <div className="max-w-lg">
      <Combobox
        label="Search"
        placeholder="Search coffee, gear, SKU"
        value={value}
        onValueChange={setValue}
        items={items}
        onSelect={(item) => setValue(String(item.label))}
        clearLabel="Clear search"
        empty={`Nothing found for “${value}”`}
        footer={<a href="#results">See all 12 results</a>}
        idle={
          <div className="flex flex-col gap-3">
            <p className="text-sf-body-xs text-muted-foreground">Popular searches</p>
            <div className="flex flex-wrap gap-2">
              {['decaf', 'v60 filters', 'kenya'].map((term) => (
                <Checkbox key={term} variant="chip" label={term} onCheckedChange={() => setValue(term)} />
              ))}
            </div>
          </div>
        }
      />
    </div>
  )
}

export const Search: Story = { render: () => <SearchDemo /> }

function ToneDemo({ tone }: { tone: 'quiet' | 'inverse' }) {
  const [value, setValue] = React.useState('')
  return (
    <div className={tone === 'inverse' ? 'max-w-lg rounded-sf-card bg-primary p-6' : 'max-w-lg'}>
      <Combobox label="Search" placeholder="Search coffee, gear, SKU" tone={tone} value={value} onValueChange={setValue} items={value ? catalogue : []} onSelect={(item) => setValue(String(item.label))} clearLabel="Clear search" />
    </div>
  )
}

export const Quiet: Story = { name: 'Tone quiet, site header', render: () => <ToneDemo tone="quiet" /> }
export const Inverse: Story = { name: 'Tone inverse, on the primary colour or a photo', render: () => <ToneDemo tone="inverse" /> }

function AddressDemo() {
  const [value, setValue] = React.useState('Józefa 1')
  const items: ComboboxItem[] = value.length > 2 ? [
    { id: 'a1', label: 'ul. Józefa 11, 31-056 Kraków' },
    { id: 'a2', label: 'ul. Józefa 12, 31-056 Kraków' },
    { id: 'a3', label: 'ul. Józefa 1, 31-056 Kraków' },
  ] : []
  return (
    <div className="max-w-lg">
      <Combobox
        label="Street and number"
        placeholder="Start typing your address"
        leadingIcon={false}
        size="lg"
        value={value}
        onValueChange={setValue}
        items={items}
        onSelect={(item) => setValue(String(item.label))}
        footer={<button type="button">Enter address manually</button>}
      />
    </div>
  )
}

export const Address: Story = { render: () => <AddressDemo /> }
