import type { ReportExportInput, ReportExportLabels } from '../../reportExport'
import type { ReportRow } from '../../reportRows'
import type {
  ExactReportTotals,
  ExactResolvedEntryValues,
  ReportGroup,
  ReportLine,
  ReportTotals,
  ResolvedEntryValues,
} from '../../reportTotals'

export const legacyChildLine: ReportLine = {
  key: 'child',
  label: 'Child task',
  minutes: 30,
  rate: 120.5,
  amount: 60.25,
  entryCount: 1,
  hasOverride: false,
  children: [],
}

export const legacyLine: ReportLine = {
  key: 'parent',
  label: 'Parent task',
  minutes: 90,
  rate: 120.5,
  amount: 180.75,
  entryCount: 2,
  hasOverride: true,
  children: [legacyChildLine],
}

export const legacyGroup: ReportGroup = {
  key: 'p1',
  kind: 'project',
  label: 'Legacy project',
  rate: 120.5,
  minutes: 90,
  amount: 180.75,
  entryCount: 2,
  lines: [legacyLine],
}

export const legacyTotals: ReportTotals = {
  groups: [legacyGroup],
  billableMinutes: 90,
  nonbillableMinutes: 0,
  entryCount: 2,
  totalAmount: 180.75,
  alreadyReportedCount: 0,
  alreadyReportedMinutes: 0,
  alreadyReportedIn: [],
}

export const legacyResolved: ResolvedEntryValues[] = [
  {
    entryId: 'e1',
    minutes: 60,
    rawMinutes: 60,
    rate: 120.5,
    amount: 120.5,
    isBillable: true,
    hasOverride: false,
    isFrozen: false,
  },
  {
    entryId: 'e2',
    minutes: 30,
    rawMinutes: 30,
    rate: 120.5,
    amount: 60.25,
    isBillable: true,
    hasOverride: true,
    isFrozen: true,
  },
]

export const legacyRow: ReportRow = {
  entryId: 'e1',
  date: '2026-06-01',
  projectId: 'p1',
  projectName: 'Legacy project',
  taskLabel: 'Parent task',
  personLabel: 'Person',
  description: 'Work',
  rawMinutes: 60,
  minutes: 60,
  hours: '1:00',
  isBillable: true,
  rate: 120.5,
  amount: 120.5,
  hasOverride: false,
  isFrozen: false,
}

export const labels: ReportExportLabels = {
  documentTitle: 'Report',
  issuedBy: 'Issued by',
  reference: 'Reference',
  period: 'Period',
  line: 'Line',
  time: 'Time',
  rate: 'Rate',
  amount: 'Amount',
  total: 'Total',
  totalHint: '{billable} {nonbillable} {rounding}',
  nonbillable: 'Non-billable',
  overrideBadge: 'override',
  date: 'Date',
  project: 'Project',
  task: 'Task',
  person: 'Person',
  description: 'Description',
  billable: 'Billable',
  yes: 'Yes',
  no: 'No',
  rawMinutes: 'Raw minutes',
  roundedMinutes: 'Rounded minutes',
}

export function legacyExportInput(): ReportExportInput {
  return {
    reference: 'R-1',
    title: 'Legacy',
    customerName: 'Customer',
    periodLabel: '2026-06',
    issuedByLabel: null,
    issuedAtLabel: null,
    currencyCode: 'EUR',
    showRates: true,
    groups: legacyTotals.groups,
    rows: [legacyRow],
    totals: {
      billableMinutes: legacyTotals.billableMinutes,
      nonbillableMinutes: legacyTotals.nonbillableMinutes,
      totalAmount: legacyTotals.totalAmount,
    },
    roundingLabel: 'none',
    labels,
  }
}

export function toPublicTotals(totals: ExactReportTotals): ReportTotals {
  return totals
}

export function toPublicResolved(values: ExactResolvedEntryValues): ResolvedEntryValues {
  return values
}
