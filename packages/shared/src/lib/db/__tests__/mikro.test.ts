describe('ORM entity registry', () => {
  const GLOBAL_ENTITIES_KEY = '__openMercatoOrmEntities__'
  const originalEntities = (globalThis as Record<string, unknown>)[GLOBAL_ENTITIES_KEY]

  afterEach(() => {
    jest.resetModules()
    if (typeof originalEntities === 'undefined') {
      delete (globalThis as Record<string, unknown>)[GLOBAL_ENTITIES_KEY]
      return
    }
    ;(globalThis as Record<string, unknown>)[GLOBAL_ENTITIES_KEY] = originalEntities
  })

  it('survives module reloads via global state', async () => {
    const entities = [{ name: 'TestEntity' }]

    const firstLoad = await import('../mikro')
    firstLoad.registerOrmEntities(entities)

    jest.resetModules()

    const secondLoad = await import('../mikro')
    expect(secondLoad.getOrmEntities()).toBe(entities)
  })
})
