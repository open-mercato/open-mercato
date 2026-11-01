'use client'

import * as React from 'react'
import Image from 'next/image'
import {
  ArrowUpRight,
  ChartNoAxesCombined,
  ChevronRight,
  FilePlus,
  Landmark,
  ReceiptText,
  WalletCards,
} from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { BarChart } from '@open-mercato/ui/backend/charts'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import dashboard from '../data/dashboard.json'
import balanceGrid from '../assets/dashboard/balance-grid.svg'
import balanceFill from '../assets/dashboard/balance-fill.svg'
import balanceLine from '../assets/dashboard/balance-line.svg'

const icons = {
  entry: FilePlus,
  invoice: ReceiptText,
  payment: WalletCards,
  bank: Landmark,
  report: ChartNoAxesCombined,
}

const money = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
})
const shortDate = new Intl.DateTimeFormat('pl-PL', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
const longDate = new Intl.DateTimeFormat('pl-PL', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const chartColors = ['violet', 'indigo']

export function FinanceDashboard({
  goTo,
}: {
  goTo: (screenId: string) => void
}) {
  const t = useT()
  const copy = (key: keyof typeof dashboard.copy) =>
    t(`finance_previews.dashboard.${key}`, dashboard.copy[key])
  const [range, setRange] = React.useState('year')
  const [operation, setOperation] = React.useState<
    (typeof dashboard.operations)[number] | null
  >(null)
  const rangeMonths =
    dashboard.ranges.find((item) => item.id === range)?.months ?? 9
  const chartData = dashboard.months.slice(-rangeMonths)
  const month = dashboard.months[dashboard.months.length - 1]
  const signedAmount = (amount: number) =>
    `${amount > 0 ? '+' : ''}${money.format(amount)}`

  return (
    <div className="min-w-0 space-y-6" data-testid="finance-dashboard">
      <div className="relative isolate overflow-hidden pb-6">
        <div
          className="pointer-events-none absolute inset-0 -z-10 hidden overflow-hidden md:block"
          aria-hidden="true"
        >
          <Image
            src={balanceGrid}
            alt=""
            className="absolute left-4 top-4 max-w-none"
            unoptimized
          />
          <Image
            src={balanceFill}
            alt=""
            className="absolute -left-4 top-52 max-w-none"
            unoptimized
          />
          <Image
            src={balanceLine}
            alt=""
            className="absolute -left-4 top-52 max-w-none"
            unoptimized
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3 lg:gap-12">
          <section
            className="min-w-0 space-y-2 pt-3 lg:col-span-2 lg:min-h-64"
            aria-label={copy('balance')}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
              <p className="text-sm font-medium">{copy('balance')}</p>
              <p className="text-xs">{copy('asOf')}</p>
            </div>
            <p className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl sm:leading-tight">
              {money.format(dashboard.balance)}
            </p>
            <p className="flex flex-wrap gap-2 text-sm">
              <span className="font-semibold text-accent-indigo">
                {signedAmount(dashboard.change)}
              </span>
              <span className="text-muted-foreground">{copy('month')}</span>
            </p>
            <dl className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-3 sm:gap-8">
              {[
                { label: copy('overdue'), value: dashboard.overdue },
                { label: copy('dueSoon'), value: dashboard.dueSoon },
                { label: copy('incomeMonth'), value: month.income * 1000 },
              ].map((metric) => (
                <div key={metric.label}>
                  <dt className="text-xs text-muted-foreground">
                    {metric.label}
                  </dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">
                    {money.format(metric.value)}
                  </dd>
                </div>
              ))}
            </dl>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="px-0 text-accent-indigo underline"
              onClick={() => goTo('s15')}
            >
              {copy('accounts')}
              <ArrowUpRight aria-hidden="true" />
            </Button>
          </section>

          <section
            className="space-y-2 lg:p-4"
            aria-labelledby="finance-dashboard-tasks"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2
                id="finance-dashboard-tasks"
                className="text-lg font-semibold"
              >
                {copy('tasks')}
              </h2>
              <Badge tone="info" appearance="lighter" size={20} numeric>
                {dashboard.tasks.reduce((sum, task) => sum + task.count, 0)}
              </Badge>
            </div>
            {dashboard.tasks.map((task) => (
              <Button
                key={task.target}
                type="button"
                variant="outline"
                className="h-12 w-full justify-start px-3"
                onClick={() => goTo(task.target)}
              >
                <Badge tone="info" appearance="filled" size={20} numeric>
                  {task.count}
                </Badge>
                <span className="min-w-0 flex-1 whitespace-normal text-left font-semibold">
                  {task.label}
                </span>
                <ChevronRight
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
              </Button>
            ))}
          </section>
        </div>
        <p className="mt-4 hidden text-right text-xs text-muted-foreground lg:block">
          {copy('balanceTrend')}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {dashboard.shortcuts.map((shortcut, index) => {
            const Icon = icons[shortcut.icon as keyof typeof icons]
            return (
              <Button
                key={shortcut.target}
                type="button"
                variant={index === 0 ? 'primary-filled' : 'outline'}
                size="lg"
                onClick={() => goTo(shortcut.target)}
              >
                <Icon className="size-5" aria-hidden="true" />
                {shortcut.label}
              </Button>
            )
          })}
        </div>
      </div>

      <div className="grid gap-8 xl:grid-cols-3">
        <section
          className="min-w-0 space-y-4 xl:col-span-2"
          aria-labelledby="finance-dashboard-cashflow"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2
              id="finance-dashboard-cashflow"
              className="text-lg font-semibold"
            >
              {copy('cashflow')}
            </h2>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger
                size={32}
                className="w-48"
                aria-label={copy('chartRange')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dashboard.ranges.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <dl className="grid gap-3 sm:grid-cols-3">
            {[
              { label: copy('incomeMonth'), value: month.income * 1000 },
              { label: copy('expenseMonth'), value: month.expense * 1000 },
              {
                label: copy('netMonth'),
                value: (month.income - month.expense) * 1000,
              },
            ].map((metric, index) => (
              <div key={metric.label}>
                <dt className="text-xs text-muted-foreground">
                  {metric.label}
                </dt>
                <dd
                  className={`mt-1 text-lg font-semibold tabular-nums ${index === 2 ? 'text-accent-indigo' : ''}`}
                >
                  {index === 2
                    ? signedAmount(metric.value)
                    : money.format(metric.value)}
                </dd>
              </div>
            ))}
          </dl>
          <div
            className="pt-4"
            role="img"
            aria-label={copy('chartDescription')}
            data-testid="finance-dashboard-cashflow"
            data-months={chartData.length}
          >
            <BarChart
              data={chartData}
              index="month"
              categories={['income', 'expense']}
              categoryLabels={{
                income: copy('income'),
                expense: copy('expense'),
              }}
              colors={chartColors}
              valueFormatter={(value) => value.toLocaleString('pl-PL')}
              showLegend={false}
              loading={false}
              error={null}
              emptyMessage={copy('emptyChart')}
            />
          </div>
          <div className="flex flex-wrap items-center gap-6 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-chart-violet" />
              {copy('income')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-chart-indigo" />
              {copy('expense')}
            </span>
            <span>{copy('unit')}</span>
          </div>
        </section>

        <section
          className="min-w-0"
          aria-labelledby="finance-dashboard-operations"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2
              id="finance-dashboard-operations"
              className="text-lg font-semibold"
            >
              {copy('recent')}
            </h2>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="px-0 text-xs text-accent-indigo underline"
              onClick={() => goTo('s17')}
            >
              {copy('viewBank')}
              <ArrowUpRight aria-hidden="true" />
            </Button>
          </div>
          <ul className="divide-y divide-border">
            {dashboard.operations.map((item) => (
              <li key={item.id}>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-between gap-3 rounded-none px-0 py-4 text-left"
                  aria-label={`${copy('details')}: ${item.reference}`}
                  onClick={() => setOperation(item)}
                >
                  <span className="min-w-0 space-y-1">
                    <span className="block whitespace-normal text-sm font-medium">
                      {item.title}
                    </span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {item.reference}
                    </span>
                  </span>
                  <span className="shrink-0 space-y-1 text-right">
                    <span className="block text-sm font-semibold tabular-nums">
                      {signedAmount(item.amount)}
                    </span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {shortDate.format(new Date(item.date))}
                    </span>
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Dialog
        open={operation !== null}
        onOpenChange={(open) => !open && setOperation(null)}
      >
        <DialogContent
          size="default"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              setOperation(null)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{operation?.title}</DialogTitle>
            <DialogDescription>{copy('operationTitle')}</DialogDescription>
          </DialogHeader>
          {operation ? (
            <dl className="grid gap-5 sm:grid-cols-2">
              {[
                { label: copy('document'), value: operation.reference },
                {
                  label: copy('amount'),
                  value: signedAmount(operation.amount),
                },
                {
                  label: copy('date'),
                  value: longDate.format(new Date(operation.date)),
                },
                { label: copy('account'), value: copy('accountName') },
              ].map((field) => (
                <div key={field.label}>
                  <dt className="text-sm text-muted-foreground">
                    {field.label}
                  </dt>
                  <dd className="mt-1 font-medium">{field.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOperation(null)}
            >
              {copy('close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
