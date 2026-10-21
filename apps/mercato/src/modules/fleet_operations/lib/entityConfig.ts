import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

export type OperationsEntityKey =
  | 'maintenance-schedules'
  | 'work-orders'
  | 'fuel-logs'
  | 'insurance-policies'
  | 'traffic-violations'

export type OperationsEntityConfig = {
  key: OperationsEntityKey
  apiPath: string
  titleKey: string
  title: string
  fields: CrudField[]
  columns: Array<{ id: string; label: string; field: string }>
}

type Translate = (key: string, fallback?: string) => string

const VEHICLE_FIELD = (t: Translate): CrudField => ({
  id: 'vehicleId',
  label: t('fleet_operations.fields.vehicle', 'Vehicle'),
  type: 'relation',
  required: true,
  loadOptions: async () => {
    const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
      '/api/fleet_management/vehicles?pageSize=100',
    )
    if (!response.ok) return []
    return (response.result?.items ?? []).map((item) => ({
      value: String(item.id ?? ''),
      label: [item.plate_number, item.make, item.model].filter(Boolean).join(' · '),
    })).filter((option) => option.value)
  },
})

export function buildOperationsEntityConfigs(t: Translate): Record<OperationsEntityKey, OperationsEntityConfig> {
  const statusOptions = (values: string[]) => values.map((value) => ({
    value,
    label: t(`fleet_operations.status.${value}`, value.replaceAll('_', ' ')),
  }))
  return {
    'maintenance-schedules': {
      key: 'maintenance-schedules',
      apiPath: '/api/fleet_operations/maintenance-schedules',
      titleKey: 'fleet_operations.nav.schedules',
      title: t('fleet_operations.nav.schedules', 'Maintenance schedules'),
      columns: [
        { id: 'name', label: t('fleet_operations.fields.name', 'Name'), field: 'name' },
        { id: 'vehicle', label: t('fleet_operations.fields.vehicle', 'Vehicle'), field: 'vehicle_id' },
        { id: 'interval', label: t('fleet_operations.fields.interval', 'Interval'), field: 'interval_type' },
        { id: 'nextDueAt', label: t('fleet_operations.fields.nextDueAt', 'Next due'), field: 'next_due_at' },
        { id: 'isActive', label: t('fleet_operations.fields.active', 'Active'), field: 'is_active' },
      ],
      fields: [
        VEHICLE_FIELD(t),
        { id: 'name', label: t('fleet_operations.fields.name', 'Name'), type: 'text', required: true },
        { id: 'description', label: t('fleet_operations.fields.description', 'Description'), type: 'textarea' },
        {
          id: 'intervalType',
          label: t('fleet_operations.fields.intervalType', 'Interval type'),
          type: 'select',
          options: statusOptions(['odometer', 'date', 'both']),
          defaultValue: 'odometer',
        },
        { id: 'intervalOdometer', label: t('fleet_operations.fields.intervalOdometer', 'Every (km)'), type: 'number' },
        { id: 'intervalDays', label: t('fleet_operations.fields.intervalDays', 'Every (days)'), type: 'number' },
        { id: 'lastServiceOdometer', label: t('fleet_operations.fields.lastServiceOdometer', 'Last service odometer'), type: 'number' },
        { id: 'lastServiceAt', label: t('fleet_operations.fields.lastServiceAt', 'Last service date'), type: 'datetime' },
        { id: 'nextDueOdometer', label: t('fleet_operations.fields.nextDueOdometer', 'Next due odometer'), type: 'number' },
        { id: 'nextDueAt', label: t('fleet_operations.fields.nextDueAt', 'Next due date'), type: 'datetime' },
        { id: 'isActive', label: t('fleet_operations.fields.active', 'Active'), type: 'checkbox', defaultValue: true },
      ],
    },
    'work-orders': {
      key: 'work-orders',
      apiPath: '/api/fleet_operations/work-orders',
      titleKey: 'fleet_operations.nav.workOrders',
      title: t('fleet_operations.nav.workOrders', 'Work orders'),
      columns: [
        { id: 'number', label: t('fleet_operations.fields.workOrderNumber', 'Number'), field: 'work_order_number' },
        { id: 'title', label: t('fleet_operations.fields.title', 'Title'), field: 'title' },
        { id: 'vehicle', label: t('fleet_operations.fields.vehicle', 'Vehicle'), field: 'vehicle_id' },
        { id: 'status', label: t('fleet_operations.fields.status', 'Status'), field: 'status' },
        { id: 'priority', label: t('fleet_operations.fields.priority', 'Priority'), field: 'priority' },
        { id: 'totalCost', label: t('fleet_operations.fields.totalCost', 'Total cost'), field: 'total_cost' },
      ],
      fields: [
        VEHICLE_FIELD(t),
        { id: 'scheduleId', label: t('fleet_operations.fields.schedule', 'Maintenance schedule'), type: 'combobox' },
        { id: 'title', label: t('fleet_operations.fields.title', 'Title'), type: 'text', required: true },
        { id: 'description', label: t('fleet_operations.fields.description', 'Description'), type: 'textarea' },
        {
          id: 'priority',
          label: t('fleet_operations.fields.priority', 'Priority'),
          type: 'select',
          options: statusOptions(['low', 'normal', 'high', 'urgent']),
          defaultValue: 'normal',
        },
        {
          id: 'type',
          label: t('fleet_operations.fields.type', 'Type'),
          type: 'select',
          options: statusOptions(['preventive', 'corrective', 'inspection', 'other']),
          defaultValue: 'corrective',
        },
        { id: 'odometer', label: t('fleet_operations.fields.odometer', 'Odometer'), type: 'number' },
        { id: 'vendorName', label: t('fleet_operations.fields.vendor', 'Vendor'), type: 'text' },
        { id: 'openedAt', label: t('fleet_operations.fields.openedAt', 'Opened at'), type: 'datetime' },
        { id: 'downtimeMinutes', label: t('fleet_operations.fields.downtime', 'Downtime (minutes)'), type: 'number' },
        { id: 'currencyCode', label: t('fleet_operations.fields.currency', 'Currency'), type: 'text', defaultValue: 'SAR' },
        { id: 'notes', label: t('fleet_operations.fields.notes', 'Notes'), type: 'textarea' },
      ],
    },
    'fuel-logs': {
      key: 'fuel-logs',
      apiPath: '/api/fleet_operations/fuel-logs',
      titleKey: 'fleet_operations.nav.fuel',
      title: t('fleet_operations.nav.fuel', 'Fuel logs'),
      columns: [
        { id: 'loggedAt', label: t('fleet_operations.fields.loggedAt', 'Logged at'), field: 'logged_at' },
        { id: 'vehicle', label: t('fleet_operations.fields.vehicle', 'Vehicle'), field: 'vehicle_id' },
        { id: 'liters', label: t('fleet_operations.fields.liters', 'Liters'), field: 'liters' },
        { id: 'totalCost', label: t('fleet_operations.fields.totalCost', 'Total cost'), field: 'total_cost' },
        { id: 'odometer', label: t('fleet_operations.fields.odometer', 'Odometer'), field: 'odometer' },
      ],
      fields: [
        VEHICLE_FIELD(t),
        { id: 'loggedAt', label: t('fleet_operations.fields.loggedAt', 'Logged at'), type: 'datetime', required: true },
        { id: 'odometer', label: t('fleet_operations.fields.odometer', 'Odometer'), type: 'number' },
        { id: 'liters', label: t('fleet_operations.fields.liters', 'Liters'), type: 'number', required: true },
        { id: 'unitPrice', label: t('fleet_operations.fields.unitPrice', 'Unit price'), type: 'number', required: true },
        {
          id: 'fuelType',
          label: t('fleet_operations.fields.fuelType', 'Fuel type'),
          type: 'select',
          options: statusOptions(['diesel', 'petrol_91', 'petrol_95', 'other']),
          defaultValue: 'diesel',
        },
        { id: 'stationName', label: t('fleet_operations.fields.station', 'Station'), type: 'text' },
        { id: 'fullTank', label: t('fleet_operations.fields.fullTank', 'Full tank'), type: 'checkbox', defaultValue: true },
        { id: 'notes', label: t('fleet_operations.fields.notes', 'Notes'), type: 'textarea' },
      ],
    },
    'insurance-policies': {
      key: 'insurance-policies',
      apiPath: '/api/fleet_operations/insurance-policies',
      titleKey: 'fleet_operations.nav.insurance',
      title: t('fleet_operations.nav.insurance', 'Insurance'),
      columns: [
        { id: 'policyNumber', label: t('fleet_operations.fields.policyNumber', 'Policy number'), field: 'policy_number' },
        { id: 'insurerName', label: t('fleet_operations.fields.insurer', 'Insurer'), field: 'insurer_name' },
        { id: 'vehicle', label: t('fleet_operations.fields.vehicle', 'Vehicle'), field: 'vehicle_id' },
        { id: 'endDate', label: t('fleet_operations.fields.endDate', 'Expires'), field: 'end_date' },
        { id: 'status', label: t('fleet_operations.fields.status', 'Status'), field: 'status' },
      ],
      fields: [
        VEHICLE_FIELD(t),
        { id: 'policyNumber', label: t('fleet_operations.fields.policyNumber', 'Policy number'), type: 'text', required: true },
        { id: 'insurerName', label: t('fleet_operations.fields.insurer', 'Insurer'), type: 'text', required: true },
        {
          id: 'coverageType',
          label: t('fleet_operations.fields.coverageType', 'Coverage'),
          type: 'select',
          options: statusOptions(['comprehensive', 'third_party', 'other']),
          defaultValue: 'comprehensive',
        },
        { id: 'startDate', label: t('fleet_operations.fields.startDate', 'Start date'), type: 'date', required: true },
        { id: 'endDate', label: t('fleet_operations.fields.endDate', 'End date'), type: 'date', required: true },
        { id: 'premiumAmount', label: t('fleet_operations.fields.premium', 'Premium'), type: 'number' },
        { id: 'currencyCode', label: t('fleet_operations.fields.currency', 'Currency'), type: 'text', defaultValue: 'SAR' },
        {
          id: 'status',
          label: t('fleet_operations.fields.status', 'Status'),
          type: 'select',
          options: statusOptions(['active', 'expired', 'cancelled']),
          defaultValue: 'active',
        },
        { id: 'notes', label: t('fleet_operations.fields.notes', 'Notes'), type: 'textarea' },
      ],
    },
    'traffic-violations': {
      key: 'traffic-violations',
      apiPath: '/api/fleet_operations/traffic-violations',
      titleKey: 'fleet_operations.nav.violations',
      title: t('fleet_operations.nav.violations', 'Violations'),
      columns: [
        { id: 'number', label: t('fleet_operations.fields.violationNumber', 'Number'), field: 'violation_number' },
        { id: 'vehicle', label: t('fleet_operations.fields.vehicle', 'Vehicle'), field: 'vehicle_id' },
        { id: 'occurredAt', label: t('fleet_operations.fields.occurredAt', 'Occurred at'), field: 'occurred_at' },
        { id: 'fineAmount', label: t('fleet_operations.fields.fine', 'Fine'), field: 'fine_amount' },
        { id: 'status', label: t('fleet_operations.fields.status', 'Status'), field: 'status' },
      ],
      fields: [
        VEHICLE_FIELD(t),
        { id: 'driverEmployeeId', label: t('fleet_operations.fields.driver', 'Driver employee id'), type: 'text' },
        { id: 'violationNumber', label: t('fleet_operations.fields.violationNumber', 'Violation number'), type: 'text', required: true },
        { id: 'occurredAt', label: t('fleet_operations.fields.occurredAt', 'Occurred at'), type: 'datetime', required: true },
        { id: 'location', label: t('fleet_operations.fields.location', 'Location'), type: 'text' },
        { id: 'description', label: t('fleet_operations.fields.description', 'Description'), type: 'textarea' },
        { id: 'fineAmount', label: t('fleet_operations.fields.fine', 'Fine'), type: 'number' },
        { id: 'currencyCode', label: t('fleet_operations.fields.currency', 'Currency'), type: 'text', defaultValue: 'SAR' },
        {
          id: 'status',
          label: t('fleet_operations.fields.status', 'Status'),
          type: 'select',
          options: statusOptions(['open', 'paid', 'appealed', 'cancelled']),
          defaultValue: 'open',
        },
        { id: 'paidAt', label: t('fleet_operations.fields.paidAt', 'Paid at'), type: 'datetime' },
        { id: 'payrollDeductionRequested', label: t('fleet_operations.fields.payrollDeduction', 'Request payroll deduction'), type: 'checkbox' },
        { id: 'notes', label: t('fleet_operations.fields.notes', 'Notes'), type: 'textarea' },
      ],
    },
  }
}

export function isOperationsEntityKey(value: string): value is OperationsEntityKey {
  return [
    'maintenance-schedules',
    'work-orders',
    'fuel-logs',
    'insurance-policies',
    'traffic-violations',
  ].includes(value)
}

export function toPayload(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => {
    if (key === 'id' || key === 'updatedAt') return false
    if (value === undefined) return false
    if (typeof value === 'string') return value.trim().length > 0
    return true
  }))
}

export function toFormValues(record: Record<string, unknown>): Record<string, unknown> {
  return {
    ...record,
    vehicleId: record.vehicle_id ?? record.vehicleId ?? undefined,
    scheduleId: record.schedule_id ?? record.scheduleId ?? undefined,
    workOrderNumber: record.work_order_number ?? undefined,
    intervalType: record.interval_type ?? record.intervalType ?? undefined,
    intervalOdometer: record.interval_odometer ?? record.intervalOdometer ?? undefined,
    intervalDays: record.interval_days ?? record.intervalDays ?? undefined,
    lastServiceOdometer: record.last_service_odometer ?? undefined,
    lastServiceAt: record.last_service_at ?? undefined,
    nextDueOdometer: record.next_due_odometer ?? undefined,
    nextDueAt: record.next_due_at ?? undefined,
    isActive: record.is_active ?? undefined,
    priority: record.priority ?? undefined,
    type: record.type ?? undefined,
    odometer: record.odometer ?? undefined,
    vendorName: record.vendor_name ?? undefined,
    openedAt: record.opened_at ?? undefined,
    downtimeMinutes: record.downtime_minutes ?? undefined,
    currencyCode: record.currency_code ?? undefined,
    loggedAt: record.logged_at ?? undefined,
    liters: record.liters ?? undefined,
    unitPrice: record.unit_price ?? undefined,
    fuelType: record.fuel_type ?? undefined,
    stationName: record.station_name ?? undefined,
    fullTank: record.full_tank ?? undefined,
    policyNumber: record.policy_number ?? undefined,
    insurerName: record.insurer_name ?? undefined,
    coverageType: record.coverage_type ?? undefined,
    startDate: record.start_date ?? undefined,
    endDate: record.end_date ?? undefined,
    premiumAmount: record.premium_amount ?? undefined,
    driverEmployeeId: record.driver_employee_id ?? undefined,
    violationNumber: record.violation_number ?? undefined,
    occurredAt: record.occurred_at ?? undefined,
    location: record.location ?? undefined,
    fineAmount: record.fine_amount ?? undefined,
    paidAt: record.paid_at ?? undefined,
    payrollDeductionRequested: record.payroll_deduction_requested ?? undefined,
    updatedAt: record.updatedAt ?? record.updated_at ?? undefined,
  }
}
