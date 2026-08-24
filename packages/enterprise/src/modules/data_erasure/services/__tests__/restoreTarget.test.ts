import { assertActiveDatabaseIsRestoreTarget } from '../restoreTarget'

describe('assertActiveDatabaseIsRestoreTarget', () => {
  it('accepts the same host, port, and database with different credentials', () => {
    expect(() => assertActiveDatabaseIsRestoreTarget({
      DATABASE_URL: 'postgres://app:secret@db.internal:5432/restored',
      OM_BACKUP_RESTORE_DATABASE_URL: 'postgresql://restore:other@db.internal/restored',
    })).not.toThrow()
  })

  it('rejects a different active database without exposing either URL', () => {
    expect(() => assertActiveDatabaseIsRestoreTarget({
      DATABASE_URL: 'postgres://app:secret@db.internal/live',
      OM_BACKUP_RESTORE_DATABASE_URL: 'postgres://restore:other@db.internal/restored',
    })).toThrow('active database is not the configured restore target')
  })
})
