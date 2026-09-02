import { Migration20260829090000_wms } from '../Migration20260829090000_wms'

describe('WMS sales-order warehouse foreign-key migration', () => {
  it('adds the constraint without validating existing rows under the table lock', () => {
    const addSql = jest.fn()

    Migration20260829090000_wms.prototype.up.call({ addSql } as never)

    expect(addSql).toHaveBeenCalledTimes(3)
    const [, addConstraintStatement, validateConstraintStatement] = addSql.mock.calls.map(
      ([statement]) => statement as string,
    )
    expect(addConstraintStatement).toContain('foreign key ("warehouse_id")')
    expect(addConstraintStatement).toContain('not valid')
    expect(validateConstraintStatement).toContain(
      'validate constraint "wms_sales_order_warehouse_assignments_warehouse_id_foreign"',
    )
  })
})
