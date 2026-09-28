import { generatorPlugins } from '../generators'

describe('customers generator plugins', () => {
  it('emits ordered calendar event type entries with bootstrap registration', () => {
    const plugin = generatorPlugins.find((candidate) => candidate.id === 'customers.calendar-event-types')
    expect(plugin).toBeDefined()

    const customers = plugin!.configExpr('CUSTOMERS', 'customers')
    const example = plugin!.configExpr('EXAMPLE', 'example')
    const output = plugin!.buildOutput({
      importSection: [
        `import * as CUSTOMERS from '@open-mercato/core/modules/customers/calendar-event-types'`,
        `import * as EXAMPLE from '@/modules/example/calendar-event-types'`,
      ].join('\n'),
      entriesLiteral: `${customers},\n  ${example}`,
    })

    expect(customers).toContain('definitions: []')
    expect(example).toContain("sourcePath: 'example/calendar-event-types.ts'")
    expect(example).toContain('EXAMPLE.calendarEventTypes')
    expect(output).toContain('calendarEventTypeEntriesRaw.map((entry, moduleOrder)')
    expect(output).toContain('moduleOrder,')
    expect(plugin!.bootstrapRegistration).toMatchObject({
      entriesExportName: 'calendarEventTypeEntries',
    })
    expect(plugin!.bootstrapRegistration?.buildCall('calendarEventTypeEntries')).toBe(
      'registerCalendarEventTypeEntries(calendarEventTypeEntries)',
    )
  })
})
