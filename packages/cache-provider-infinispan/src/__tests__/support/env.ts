export const CONTAINER_TESTS_ENABLED = process.env.OM_CACHE_PROVIDER_CONTAINER_TESTS === '1'

export function skipUnlessContainers(name: string): boolean {
  if (CONTAINER_TESTS_ENABLED) return false
  describe.skip(`${name} (set OM_CACHE_PROVIDER_CONTAINER_TESTS=1 to run against Docker)`, () => {
    it('is skipped without Docker', () => undefined)
  })
  return true
}
