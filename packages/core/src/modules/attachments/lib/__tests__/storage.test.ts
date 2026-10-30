/** @jest-environment node */
import path from 'path'
import { resolvePartitionRoot, resolveStorageRoot, STORAGE_ROOT_ENV_KEY } from '../storage'

const PARTITION_ENV_KEY = 'ATTACHMENTS_PARTITION_PRODUCTS_MEDIA_ROOT'

describe('attachments storage root resolution', () => {
  let cwdSpy: jest.SpyInstance<string, []> | null = null

  afterEach(() => {
    delete process.env[STORAGE_ROOT_ENV_KEY]
    delete process.env[PARTITION_ENV_KEY]
    cwdSpy?.mockRestore()
    cwdSpy = null
  })

  function mockCwd(value: string): void {
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(value)
  }

  it('keeps the historical cwd-relative default when no env var is set', () => {
    mockCwd(path.join(path.sep, 'srv', 'app'))

    expect(resolveStorageRoot()).toBe(path.join(path.sep, 'srv', 'app', 'storage', 'attachments'))
    expect(resolvePartitionRoot('productsMedia')).toBe(
      path.join(path.sep, 'srv', 'app', 'storage', 'attachments', 'productsMedia'),
    )
  })

  it('resolves the same partition path from any working directory once the base root is configured', () => {
    process.env[STORAGE_ROOT_ENV_KEY] = path.join(path.sep, 'var', 'lib', 'mercato', 'attachments')

    mockCwd(path.join(path.sep, 'srv', 'app'))
    const fromAppRoot = resolvePartitionRoot('productsMedia')
    cwdSpy?.mockRestore()

    mockCwd(path.join(path.sep, 'home', 'dev', 'worktree'))
    const fromWorktree = resolvePartitionRoot('productsMedia')

    expect(fromAppRoot).toBe(path.join(path.sep, 'var', 'lib', 'mercato', 'attachments', 'productsMedia'))
    expect(fromWorktree).toBe(fromAppRoot)
  })

  it('lets the per-partition env var win over the base root', () => {
    process.env[STORAGE_ROOT_ENV_KEY] = path.join(path.sep, 'var', 'lib', 'mercato', 'attachments')
    process.env[PARTITION_ENV_KEY] = path.join(path.sep, 'mnt', 'media')

    expect(resolvePartitionRoot('productsMedia')).toBe(path.join(path.sep, 'mnt', 'media'))
  })

  it('ignores a blank base root and falls back to the default', () => {
    process.env[STORAGE_ROOT_ENV_KEY] = '   '
    mockCwd(path.join(path.sep, 'srv', 'app'))

    expect(resolveStorageRoot()).toBe(path.join(path.sep, 'srv', 'app', 'storage', 'attachments'))
  })

  it('rejects a relative base root instead of creating a second store next to the process', () => {
    process.env[STORAGE_ROOT_ENV_KEY] = 'storage/attachments'

    expect(() => resolveStorageRoot()).toThrow(STORAGE_ROOT_ENV_KEY)
    expect(() => resolvePartitionRoot('productsMedia')).toThrow(STORAGE_ROOT_ENV_KEY)
  })
})
