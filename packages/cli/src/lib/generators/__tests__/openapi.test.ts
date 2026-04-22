describe('resolveOpenApiGeneratorProjectRoot', () => {
  it('resolves the monorepo root from a POSIX module URL', async () => {
    const { resolveOpenApiGeneratorProjectRoot } = await import('../openapi-paths')

    expect(
      resolveOpenApiGeneratorProjectRoot(
        'file:///Users/test/open-mercato/packages/cli/src/lib/generators/openapi.ts'
      )
    ).toBe('/Users/test/open-mercato')
  })

  it('resolves the monorepo root from a Windows module URL', async () => {
    const { resolveOpenApiGeneratorProjectRoot } = await import('../openapi-paths')

    expect(
      resolveOpenApiGeneratorProjectRoot(
        'file:///C:/open-mercato/packages/cli/src/lib/generators/openapi.ts',
        { windows: true }
      )
    ).toBe('C:\\open-mercato')
  })
})
