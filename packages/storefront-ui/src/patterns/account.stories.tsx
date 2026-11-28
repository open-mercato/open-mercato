import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Badge, type BadgeVariant } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Checkbox } from '../primitives/checkbox'
import { Input } from '../primitives/input'
import { Select } from '../primitives/select'
import { ChevronRightIcon } from '../lib/icons'
import { photos } from '../../.storybook/commerce'

/**
 * Patterns are app-level compositions (apps/storefront), drawn on the DS library page
 * "Account and B2B [E-commerce]" after the storefront customer account spec (epics A to F).
 * Nothing in this file is exported. The portal backend does not exist yet.
 */
const meta = {
  title: 'Patterns/Account and B2B portal',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj

const nav: Array<[string, string[]]> = [['Portal', ['Overview', 'Orders', 'Shopping lists', 'Saved carts', 'Approvals', 'Credit', 'Price list']], ['Account', ['Company', 'Buyers', 'Addresses', 'Profile']]]

function Shell({ active, title, actions, children }: { active: string; title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="grid gap-5 px-sf-gutter-sm pb-12 pt-3 sm:px-sf-gutter-md lg:grid-cols-[15rem_1fr] lg:gap-14 lg:pb-24 lg:pt-10">
      <nav aria-label="Account" className="-mx-sf-gutter-sm flex gap-2 overflow-x-auto px-sf-gutter-sm lg:mx-0 lg:flex-col lg:gap-5 lg:overflow-visible lg:px-0">
        <p className="hidden flex-col px-3 text-sf-body lg:flex">Ania Nowak<span className="text-sf-body-xs text-muted-foreground">Kawiarnia Bez</span></p>
        {nav.map(([group, items]) => (
          <div key={group} className="flex gap-2 lg:flex-col lg:gap-0.5">
            <p className="hidden px-3 pb-1 text-sf-body-xs text-muted-foreground lg:block">{group}</p>
            {items.map((item) => {
              const current = item === active
              return (
                <a key={item} href="#" aria-current={current ? 'page' : undefined} className={`flex h-9 shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-sf-button px-3 text-sf-body-sm outline-none focus-visible:shadow-focus lg:text-sf-body ${current ? 'bg-primary text-primary-foreground lg:bg-sf-surface lg:text-foreground' : 'border border-border text-foreground lg:border-0 lg:text-muted-foreground lg:hover:bg-sf-surface'}`}>
                  {item}{item === 'Approvals' ? <span className="flex size-5 items-center justify-center rounded-full bg-primary text-sf-body-xs text-primary-foreground max-lg:hidden">2<span className="sr-only"> waiting</span></span> : null}
                </a>
              )
            })}
          </div>
        ))}
      </nav>
      <div className="flex min-w-0 flex-col gap-5 lg:gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-sf-display-s">{title}</h1>{actions ? <div className="flex gap-2">{actions}</div> : null}</div>
        {children}
      </div>
    </main>
  )
}

type Column = { label: string; align?: 'right'; sort?: 'ascending' | 'descending' }

function SortIcon({ sort }: { sort?: Column['sort'] }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-3.5">
      {sort === 'ascending' ? <><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></> : sort === 'descending' ? <><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></> : <><path d="m21 16-4 4-4-4" /><path d="M17 20V4" /><path d="m3 8 4-4 4 4" /><path d="M7 4v16" /></>}
    </svg>
  )
}

/** Every column sorts; the table scrolls sideways below `lg` unless the screen swaps it for cards. */
function DataTable({ label, columns, rows, className }: { label: string; columns: Column[]; rows: React.ReactNode[][]; className?: string }) {
  return (
    <div className={`overflow-x-auto ${className ?? ''}`}>
      <table aria-label={label} className="w-full min-w-160 border-collapse text-sf-body">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.label} scope="col" aria-sort={column.sort ?? 'none'} className={`h-10 pr-4 text-sf-body-xs font-normal last:pr-0 ${column.align === 'right' ? 'text-right' : 'text-left'}`}>
                <button type="button" className={`inline-flex h-10 cursor-pointer items-center gap-1 rounded-sf-badge outline-none focus-visible:shadow-focus ${column.sort ? 'text-foreground' : 'text-muted-foreground'}`}>{column.label}<SortIcon sort={column.sort} /></button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-border">
              {row.map((cell, cellIndex) => <td key={cellIndex} className={`py-3 pr-4 last:pr-0 ${columns[cellIndex]?.align === 'right' ? 'text-right tabular-nums' : ''}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const muted = (value: string) => <span className="text-muted-foreground">{value}</span>
const status = (variant: BadgeVariant, label: string) => <Badge variant={variant}>{label}</Badge>

function Product({ photo, name, detail, dim }: { photo: string; name: string; detail: string; dim?: boolean }) {
  return (
    <span className="flex items-center gap-3">
      <img src={photo} alt="" className={`h-14 w-12 rounded-sf-field object-cover ${dim ? 'opacity-50' : ''}`} />
      <span className={`flex flex-col ${dim ? 'text-muted-foreground' : ''}`}>{name}<span className="text-sf-body-sm text-muted-foreground">{detail}</span></span>
    </span>
  )
}

function Panel({ children, className }: React.PropsWithChildren<{ className?: string }>) {
  return <section className={`flex flex-col gap-3 rounded-sf-card bg-sf-surface p-5 ${className ?? ''}`}>{children}</section>
}

function Field({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-col gap-0.5"><dt className="text-sf-body-xs text-muted-foreground">{label}</dt><dd className="text-sf-body">{value}</dd></div>
}

const orders: Array<[string, string, string, string, BadgeVariant, string, string]> = [
  ['ZR-10482', '1 Oct 2026', 'PO-2291', 'Ania Nowak', 'success', 'Delivered', '2 412,00 zł'],
  ['ZR-10467', '28 Sep 2026', 'PO-2288', 'Jan Kurek', 'info', 'Shipped', '1 184,00 zł'],
  ['ZR-10451', '24 Sep 2026', 'PO-2280', 'Ania Nowak', 'warning', 'Awaiting approval', '3 960,00 zł'],
  ['ZR-10420', '17 Sep 2026', 'PO-2264', 'Ania Nowak', 'success', 'Delivered', '888,00 zł'],
  ['ZR-10398', '10 Sep 2026', 'PO-2251', 'Jan Kurek', 'neutral', 'Cancelled', '504,00 zł'],
]

export const Orders: Story = {
  render: () => (
    <Shell active="Orders" title="Orders">
      <div className="flex flex-wrap gap-2">
        <div className="w-56"><Select defaultValue="company"><Select.Trigger aria-label="Scope"><Select.Value /></Select.Trigger><Select.Content><Select.Item value="mine">My orders</Select.Item><Select.Item value="company">Company orders</Select.Item></Select.Content></Select></div>
        <div className="min-w-64 flex-1 lg:max-w-80"><Input.Search value="" onChange={() => {}} clearLabel="Clear" placeholder="Search by order or PO number" aria-label="Search orders" /></div>
      </div>
      <DataTable label="Orders" className="max-lg:hidden" columns={[{ label: 'Order' }, { label: 'Date', sort: 'descending' }, { label: 'PO number' }, { label: 'Placed by' }, { label: 'Status' }, { label: 'Total', align: 'right' }]}
        rows={orders.map(([number, date, po, by, variant, label, total]) => [<a key="n" href="#order" className="inline-flex min-h-6 items-center rounded-sf-badge underline-offset-4 outline-none hover:underline focus-visible:shadow-focus">{number}</a>, date, po, by, status(variant, label), total])} />
      <ul aria-label="Orders" className="flex flex-col lg:hidden">
        {orders.slice(0, 3).map(([number, date, po, , variant, label, total]) => (
          <li key={number} className="border-t border-border py-3.5">
            <a href="#order" className="flex flex-col gap-1.5 rounded-sf-badge outline-none focus-visible:shadow-focus">
              <span className="flex justify-between text-sf-body-lg"><span>{number}</span><span>{total}</span></span>
              <span className="flex items-center justify-between text-sf-body-sm text-muted-foreground">{date}, {po}{status(variant, label)}</span>
            </a>
          </li>
        ))}
      </ul>
    </Shell>
  ),
}

export const OrderDetail: Story = {
  name: 'Order detail',
  render: () => (
    <Shell active="Orders" title="Order ZR-10482" actions={<><Button variant="outline">Download invoice</Button><Button>Reorder</Button></>}>
      <dl className="flex flex-wrap gap-x-10 gap-y-3"><Field label="Status" value="Delivered" /><Field label="Placed" value="1 Oct 2026" /><Field label="Placed by" value="Ania Nowak" /><Field label="PO number" value="PO-2291" /><Field label="Payment" value="Invoice, 14 days" /></dl>
      <div className="grid gap-6 lg:grid-cols-[1fr_22.5rem] lg:items-start">
        <DataTable label="Order lines" columns={[{ label: 'Product' }, { label: 'Quantity', align: 'right' }, { label: 'Unit price', align: 'right' }, { label: 'Total', align: 'right' }]}
          rows={[[<Product key="p" photo={photos.beansInBag} name="Espresso Classico" detail="6 x 1 kg" />, '12', '74,00 zł', '888,00 zł'], [<Product key="p" photo={photos.greyBag} name="Guji Hambela" detail="6 x 250 g" />, '6', '168,00 zł', '1 008,00 zł'], [<Product key="p" photo={photos.dripBag} name="Paper filters V60" detail="100 pcs" />, '10', '19,00 zł', '190,00 zł']]} />
        <div className="flex flex-col gap-3">
          <Panel><h2 className="text-sf-title-sm">Delivery</h2><p className="text-sf-body">Kawiarnia Bez, ul. Józefa 11, 31-056 Kraków</p><a href="#track" className="inline-flex min-h-6 items-center self-start rounded-sf-badge text-sf-body underline underline-offset-4 outline-none focus-visible:shadow-focus">DPD 0123 4567 8901</a></Panel>
          <Panel>
            <h2 className="text-sf-title-sm">Totals</h2>
            <dl className="flex flex-col gap-2 text-sf-body"><div className="flex justify-between"><dt className="text-muted-foreground">Net</dt><dd>2 086,00 zł</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">VAT</dt><dd>326,00 zł</dd></div><div className="flex items-baseline justify-between"><dt className="text-sf-body-lg">Total</dt><dd className="text-sf-title">2 412,00 zł</dd></div></dl>
          </Panel>
        </div>
      </div>
    </Shell>
  ),
}

const reorderLines: Array<[string, string, string, string, string, boolean, [BadgeVariant, string]?]> = [
  [photos.beansInBag, 'Espresso Classico', '6 x 1 kg', '12', '888,00 zł', true],
  [photos.greyBag, 'Guji Hambela', '6 x 250 g', '6', '948,00 zł', true, ['info', 'Price is now 158,00 zł, was 168,00 zł']],
  [photos.dripBag, 'Paper filters V60', '100 pcs', '4', '76,00 zł', true, ['warning', 'Only 4 in stock, quantity changed from 10']],
  [photos.paperBagAndCup, 'Sugarcane Decaf', '6 x 250 g', '', '', false, ['neutral', 'No longer sold']],
  [photos.beansTopDown, 'Nyeri AA', '6 x 250 g', '', '', false, ['neutral', 'Not in your assortment']],
]

export const ReorderPreview: Story = {
  name: 'Reorder preview',
  render: () => (
    <Shell active="Orders" title="Reorder ZR-10482">
      <div className="grid gap-6 lg:grid-cols-[1fr_22.5rem] lg:items-start">
        <ul aria-label="Lines to reorder" className="flex flex-col">
          {reorderLines.map(([photo, name, detail, quantity, total, available, note]) => (
            <li key={name} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 border-t border-border py-3.5 lg:grid-cols-[auto_1fr_auto_2.5rem_6rem] lg:gap-x-4">
              <Checkbox aria-label={`Include ${name}`} defaultChecked={available} disabled={!available} />
              <Product photo={photo} name={name} detail={detail} dim={!available} />
              <span className="col-start-3 row-start-1 flex flex-col items-end text-sf-body tabular-nums lg:contents">
                <span className="lg:col-start-5 lg:row-start-1 lg:text-right">{total}</span>
                <span className="text-sf-body-sm text-muted-foreground lg:col-start-4 lg:row-start-1 lg:text-right lg:text-sf-body lg:text-foreground">{quantity ? <span className="lg:hidden">Qty </span> : null}{quantity}</span>
              </span>
              {note ? <span className="col-span-2 col-start-2 row-start-2 lg:col-span-1 lg:col-start-3 lg:row-start-1"><Badge variant={note[0]}>{note[1]}</Badge></span> : null}
            </li>
          ))}
        </ul>
        <Panel>
          <h2 className="text-sf-title-sm">3 of 5 lines</h2>
          <dl className="flex flex-col gap-2 text-sf-body"><div className="flex justify-between"><dt className="text-muted-foreground">Previous total</dt><dd>2 412,00 zł</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">Difference</dt><dd>−500,00 zł</dd></div><div className="flex items-baseline justify-between"><dt className="text-sf-body-lg">New total</dt><dd className="text-sf-title">1 912,00 zł</dd></div></dl>
          <Button size="lg" fullWidth>Add 3 lines to cart</Button>
          <Button size="lg" variant="outline" fullWidth>Cancel</Button>
        </Panel>
      </div>
    </Shell>
  ),
}

function ListQuantity({ name, initial }: { name: string; initial: number }) {
  const [value, setValue] = React.useState(initial)
  return <Input.Stepper value={value} onValueChange={setValue} min={1} labels={{ decrease: `Decrease quantity of ${name}`, increase: `Increase quantity of ${name}`, value: `Quantity of ${name}` }} />
}

export const ShoppingList: Story = {
  name: 'Shopping list',
  render: () => (
    <Shell active="Shopping lists" title="Shopping lists" actions={<Button variant="outline">New list</Button>}>
      <div role="group" aria-label="Lists" className="flex flex-wrap gap-2">{['Monthly restock', 'Seasonal', 'Office'].map((list, index) => <Checkbox key={list} variant="chip" label={list} defaultChecked={index === 0} />)}</div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="w-60"><Select defaultValue="company"><Select.Trigger aria-label="Visibility"><Select.Value /></Select.Trigger><Select.Content><Select.Item value="private">Only me</Select.Item><Select.Item value="company">Visible to my company</Select.Item><Select.Item value="link">Anyone with the link</Select.Item></Select.Content></Select></div>
        <Button>Add all to cart</Button>
      </div>
      <DataTable label="Monthly restock" columns={[{ label: 'Product' }, { label: 'Unit price', align: 'right' }, { label: 'Quantity' }, { label: 'Total', align: 'right' }]}
        rows={[
          [<Product key="p" photo={photos.beansInBag} name="Espresso Classico" detail="6 x 1 kg" />, '74,00 zł', <ListQuantity key="q" name="Espresso Classico" initial={12} />, '888,00 zł'],
          [<Product key="p" photo={photos.greyBag} name="Guji Hambela" detail="6 x 250 g" />, '158,00 zł', <ListQuantity key="q" name="Guji Hambela" initial={6} />, '948,00 zł'],
          [<Product key="p" photo={photos.dripBag} name="Paper filters V60" detail="100 pcs" />, muted('No saved price'), <ListQuantity key="q" name="Paper filters V60" initial={4} />, muted('Not comparable')],
        ]} />
    </Shell>
  ),
}

export const SavedCarts: Story = {
  name: 'Saved carts',
  render: () => (
    <Shell active="Saved carts" title="Saved carts">
      {[['Friday order', 'Saved 14 Nov 2026, 7 lines', '1 684,00 zł'], ['Christmas stock', 'Saved 2 Nov 2026, 12 lines', '4 120,00 zł']].map(([name, detail, total]) => (
        <Panel key={name} className="lg:flex-row lg:items-center lg:justify-between">
          <p className="flex flex-col text-sf-body-lg">{name}<span className="text-sf-body-sm text-muted-foreground">{detail}</span></p>
          <div className="flex flex-wrap items-center gap-3"><span className="text-sf-body-lg">{total}</span><Button variant="outline">Save as list</Button><Button>Resume</Button></div>
        </Panel>
      ))}
    </Shell>
  ),
}

export const Approvals: Story = {
  render: () => (
    <Shell active="Approvals" title="Approvals">
      <Panel className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex flex-col text-sf-body-lg">Jan Kurek, 24 Sep 2026<span className="text-sf-body-sm text-muted-foreground">Order ZR-10451, 9 lines</span></p>
          <div className="flex flex-wrap items-center gap-3"><Badge variant="warning">Over the 2 000,00 zł limit</Badge><span className="text-sf-title">3 960,00 zł</span></div>
        </div>
        <Input.Field label="Note"><textarea placeholder="Add a note for Jan" className="min-h-24 w-full rounded-sf-field border border-input bg-background px-4 py-2.5 text-sf-body-lg text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-muted-foreground focus-visible:border-foreground focus-visible:shadow-focus lg:text-sf-body" /></Input.Field>
        <div className="flex gap-2 max-lg:[&>*]:flex-1"><Button>Approve</Button><Button variant="outline">Reject</Button></div>
      </Panel>
      <a href="#approval" className="flex items-center justify-between gap-3 rounded-sf-card bg-sf-surface p-5 outline-none focus-visible:shadow-focus">
        <span className="flex flex-col text-sf-body-lg">Ola Wrona, 22 Sep 2026<span className="text-sf-body-sm text-muted-foreground">Order ZR-10440, 4 lines</span></span>
        <span className="flex items-center gap-3 text-sf-body-lg [&_svg]:size-4 [&_svg]:text-muted-foreground">2 380,00 zł<ChevronRightIcon /></span>
      </a>
    </Shell>
  ),
}

export const Credit: Story = {
  render: () => (
    <Shell active="Credit" title="Credit" actions={<Button variant="outline">Export CSV</Button>}>
      <dl className="grid gap-3 sm:grid-cols-3">{[['Limit', '20 000,00 zł'], ['Used', '7 450,00 zł'], ['Available', '12 550,00 zł']].map(([label, value]) => <div key={label} className="flex flex-col gap-1 rounded-sf-card bg-sf-surface p-5"><dt className="text-sf-body-sm text-muted-foreground">{label}</dt><dd className="text-sf-title">{value}</dd></div>)}</dl>
      <div role="img" aria-label="37% of the credit limit used" className="h-1 overflow-hidden rounded-full bg-border"><div className="h-full bg-foreground" style={{ width: '37%' }} /></div>
      <DataTable label="Credit ledger" columns={[{ label: 'Date', sort: 'descending' }, { label: 'Document' }, { label: 'Type' }, { label: 'Amount', align: 'right' }, { label: 'Balance', align: 'right' }]}
        rows={[['1 Oct 2026', 'Invoice FV/2026/10/014', 'Order ZR-10482', '2 412,00 zł', '7 450,00 zł'], ['28 Sep 2026', 'Invoice FV/2026/09/131', 'Order ZR-10467', '1 184,00 zł', '5 038,00 zł'], ['25 Sep 2026', 'Payment 2026/09/88', 'Bank transfer', '−3 200,00 zł', '3 854,00 zł'], ['17 Sep 2026', 'Invoice FV/2026/09/077', 'Order ZR-10420', '888,00 zł', '7 054,00 zł']]} />
    </Shell>
  ),
}

export const Company: Story = {
  render: () => (
    <Shell active="Company" title="Company">
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        <Panel className="gap-4"><h2 className="text-sf-title-sm">Details</h2><dl className="flex flex-wrap gap-x-8 gap-y-3"><Field label="Name" value="Kawiarnia Bez sp. z o.o." /><Field label="Tax ID" value="PL 676 000 11 22" /><Field label="Billing address" value="ul. Józefa 11, 31-056 Kraków" /></dl><Button variant="outline" className="self-start">Edit details</Button></Panel>
        <Panel className="gap-4"><div className="flex items-center justify-between gap-3"><h2 className="text-sf-title-sm">Payment terms</h2><Badge variant="outline">Set by Ziarno</Badge></div><dl className="flex flex-wrap gap-x-8 gap-y-3"><Field label="Method" value="Invoice" /><Field label="Due" value="14 days" /><Field label="Price group" value="Cafés, tier 2" /></dl></Panel>
      </div>
    </Shell>
  ),
}

export const Buyers: Story = {
  render: () => (
    <Shell active="Buyers" title="Buyers" actions={<Button>Invite buyer</Button>}>
      <DataTable label="Buyers" columns={[{ label: 'Name', sort: 'ascending' }, { label: 'Email' }, { label: 'Role' }, { label: 'Status' }, { label: 'Last active' }]}
        rows={[['Ania Nowak', muted('ania@kawiarniabez.pl'), 'Company admin', status('success', 'Active'), '19 Nov 2026'], ['Jan Kurek', muted('jan@kawiarniabez.pl'), 'Buyer', status('success', 'Active'), '18 Nov 2026'], ['Ola Wrona', muted('ola@kawiarniabez.pl'), 'Purchase approver', status('info', 'Invited'), ''], ['Piotr Lis', muted('piotr@kawiarniabez.pl'), 'Buyer', status('neutral', 'Deactivated'), '2 Aug 2026']]} />
    </Shell>
  ),
}

export const Addresses: Story = {
  render: () => (
    <Shell active="Addresses" title="Addresses" actions={<Button>Add address</Button>}>
      <ul className="grid gap-3 lg:grid-cols-3 lg:items-start">
        {([['Kawiarnia Bez', ['ul. Józefa 11', '31-056 Kraków'], ['Default shipping', 'Default billing']], ['Kawiarnia Bez, Nowa Huta', ['os. Centrum B 4', '31-927 Kraków'], []], ['Warehouse', ['ul. Zabłocie 20', '30-701 Kraków'], []]] as Array<[string, string[], string[]]>).map(([name, lines, defaults]) => (
          <li key={name}><Panel>
            <h2 className="text-sf-body-lg">{name}</h2>
            <p className="text-sf-body text-muted-foreground">{lines.map((line) => <span key={line} className="block">{line}</span>)}</p>
            {defaults.length ? <p className="flex flex-wrap gap-1.5">{defaults.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</p> : null}
            <p className="flex gap-4"><Button variant="link" size="sm">Edit<span className="sr-only"> {name}</span></Button><Button variant="link" size="sm">Delete<span className="sr-only"> {name}</span></Button></p>
          </Panel></li>
        ))}
      </ul>
    </Shell>
  ),
}

export const PriceList: Story = {
  name: 'Price list',
  render: () => (
    <Shell active="Price list" title="Price list" actions={<Button variant="outline">Export CSV</Button>}>
      <div className="flex flex-wrap items-center gap-3"><div className="min-w-64 flex-1 lg:max-w-80"><Input.Search value="" onChange={() => {}} clearLabel="Clear" placeholder="Search by product or SKU" aria-label="Search the price list" /></div><p className="text-sf-body-sm text-muted-foreground">Net prices per carton</p></div>
      <DataTable label="Price list" columns={[{ label: 'Product', sort: 'ascending' }, { label: 'SKU' }, { label: 'Carton' }, { label: '1 to 5', align: 'right' }, { label: '6 to 11', align: 'right' }, { label: '12 or more', align: 'right' }]}
        rows={[['Espresso Classico', muted('ZR-ESP-1000'), '6 x 1 kg', '84,00 zł', '79,00 zł', '74,00 zł'], ['Guji Hambela', muted('ZR-GUJ-250'), '6 x 250 g', '178,00 zł', '168,00 zł', '158,00 zł'], ['Huila Pink Bourbon', muted('ZR-HUI-250'), '6 x 250 g', '172,00 zł', '164,00 zł', '152,00 zł'], ['Paper filters V60', muted('ZR-FIL-100'), '10 x 100 pcs', '19,00 zł', '18,00 zł', '17,00 zł'], ['Sugarcane Decaf', muted('ZR-DEC-250'), '6 x 250 g', '166,00 zł', '158,00 zł', '149,00 zł']]} />
    </Shell>
  ),
}
