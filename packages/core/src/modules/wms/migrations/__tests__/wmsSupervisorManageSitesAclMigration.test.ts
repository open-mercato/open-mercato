import { Migration20260828234646_wms } from '../Migration20260828234646_wms'

describe('WMS supervisor Sites ACL migration', () => {
  it('creates a missing supervisor ACL and additively grants manage_sites', () => {
    const addSql = jest.fn()

    Migration20260828234646_wms.prototype.up.call({ addSql } as never)

    expect(addSql).toHaveBeenCalledTimes(4)
    const [createStatement, backupStatement, insertStatement, updateStatement] = addSql.mock.calls.map(([statement]) => statement as string)

    expect(createStatement).toContain('create table "wms_acl_migration_20260828234646"')
    expect(backupStatement).toContain('insert into "wms_acl_migration_20260828234646"')
    expect(insertStatement).toContain('insert into "role_acls"')
    expect(insertStatement).toContain('r."name" = \'supervisor\'')
    expect(insertStatement).toContain("not exists")
    expect(insertStatement).toContain("'[\"wms.manage_sites\"]'::jsonb")
    expect(updateStatement).toContain('update "role_acls" as ra')
    expect(updateStatement).toContain("not (ra.\"features_json\" ? 'wms.manage_sites')")
    expect(updateStatement).toContain('ra."tenant_id" = r."tenant_id"')
    expect(updateStatement).toContain('backup."applied_updated_at"')
  })

  it('removes only the migration grant on rollback', () => {
    const addSql = jest.fn()

    Migration20260828234646_wms.prototype.down.call({ addSql } as never)

    expect(addSql).toHaveBeenCalledTimes(4)
    const downStatements = addSql.mock.calls.map(([statement]) => statement as string)
    expect(downStatements[0]).toContain('is distinct from backup."applied_features_json"')
    expect(downStatements[0]).toContain('is distinct from backup."applied_updated_at"')
    expect(downStatements[0]).toContain('Cannot roll back WMS ACL migration after role ACL changes')
    expect(downStatements[1]).toContain('"previous_features_json"')
    expect(downStatements[2]).toContain('delete from "role_acls" as ra')
    expect(downStatements[3]).toContain('drop table "wms_acl_migration_20260828234646"')
  })
})
