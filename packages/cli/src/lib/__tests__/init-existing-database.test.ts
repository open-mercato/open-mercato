import { decideExistingDatabase, describeDatabaseTarget, formatSkipIfInitializedMessage } from '../init-existing-database'

describe('init on an existing database', () => {
  it('proceeds on an empty database regardless of the flag', () => {
    expect(decideExistingDatabase(0, false)).toBe('proceed')
    expect(decideExistingDatabase(0, true)).toBe('proceed')
    expect(decideExistingDatabase(Number.NaN, true)).toBe('proceed')
  })

  it('aborts on existing users unless --skip-if-initialized is passed', () => {
    expect(decideExistingDatabase(2, false)).toBe('abort')
    expect(decideExistingDatabase(2, true)).toBe('skip')
  })

  it('describes the target database without credentials', () => {
    expect(describeDatabaseTarget('postgres://postgres:secret@localhost:5432/open-mercato')).toBe('localhost:5432/open-mercato')
    expect(describeDatabaseTarget('postgres://me:pw@db.example.com/shop%20a?sslmode=require')).toBe('db.example.com/shop a')
    expect(describeDatabaseTarget('not a url')).toBe('the database from DATABASE_URL')
  })

  it('tells the user which database was kept and how to check it', () => {
    const lines = formatSkipIfInitializedMessage(4, 'postgres://postgres:secret@127.0.0.1:5432/app').join('\n')
    expect(lines).toContain('4 user(s) in 127.0.0.1:5432/app')
    expect(lines).toContain('DATABASE_URL')
    expect(lines).not.toContain('secret')
  })
})
