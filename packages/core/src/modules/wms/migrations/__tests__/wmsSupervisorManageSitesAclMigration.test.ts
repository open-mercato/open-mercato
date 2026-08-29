import { Migration20260828234646_wms } from '../Migration20260828234646_wms'

describe('WMS supervisor Sites ACL migration', () => {
  it('creates a missing supervisor ACL and additively grants manage_sites', () => {
    const addSql = jest.fn()

    Migration20260828234646_wms.prototype.up.call({ addSql } as never)

    expect(addSql).toHaveBeenCalledTimes(2)
    const [insertStatement, updateStatement] = addSql.mock.calls.map(([statement]) => statement as string)

    expect(insertStatement).toContain('insert into "role_acls"')
    expect(insertStatement).toContain('r."name" = \'supervisor\'')
    expect(insertStatement).toContain("not exists")
    expect(insertStatement).toContain("'[\"wms.manage_sites\"]'::jsonb")
    expect(updateStatement).toContain('update "role_acls" as ra')
    expect(updateStatement).toContain("not (ra.\"features_json\" ? 'wms.manage_sites')")
    expect(updateStatement).toContain('ra."tenant_id" = r."tenant_id"')
  })
})
