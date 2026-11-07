describe('getOrm with OM_DB_DEFAULT_TIMEZONE', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    jest.restoreAllMocks()
    jest.resetModules()
  })

  async function loadWithInitSpy() {
    const { MikroORM } = await import('@mikro-orm/core')
    const init = jest.spyOn(MikroORM, 'init').mockRejectedValue(new Error('stop after config'))
    const mikro = await import('../mikro')
    mikro.registerOrmEntities([])
    return { init, getOrm: mikro.getOrm }
  }

  it('fails before connecting, naming the variable, when the zone is invalid', async () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db'
    process.env.OM_DB_DEFAULT_TIMEZONE = 'Mars/Olympus'
    const { init, getOrm } = await loadWithInitSpy()

    await expect(getOrm()).rejects.toThrow(/OM_DB_DEFAULT_TIMEZONE="Mars\/Olympus"/)
    expect(init).not.toHaveBeenCalled()
  })

  it('passes the session time zone to the pool connection options', async () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db'
    process.env.OM_DB_DEFAULT_TIMEZONE = 'europe/warsaw'
    const { init, getOrm } = await loadWithInitSpy()

    await expect(getOrm()).rejects.toThrow('stop after config')
    const config = init.mock.calls[0][0] as { driverOptions?: unknown }
    expect(JSON.stringify(config.driverOptions)).toContain('-c TimeZone=Europe/Warsaw')
  })
})
