import { parseModuleInstallArgs } from '../module-install-args'

describe('parseModuleInstallArgs', () => {
  it('defaults to package-backed install without ejecting source', () => {
    expect(parseModuleInstallArgs(['@open-mercato/test-package'])).toMatchObject({
      packageSpec: '@open-mercato/test-package',
      eject: false,
    })
  })

  it('accepts --eject as a boolean flag', () => {
    expect(parseModuleInstallArgs(['@open-mercato/test-package', '--eject'])).toMatchObject({
      eject: true,
    })
    expect(parseModuleInstallArgs(['--eject', '@open-mercato/test-package'])).toMatchObject({
      packageSpec: '@open-mercato/test-package',
      eject: true,
    })
  })

  it('rejects --eject values', () => {
    expect(() => parseModuleInstallArgs(['@open-mercato/test-package', '--eject=true'])).toThrow(
      '--eject does not accept a value',
    )
  })

  it('rejects unsupported options', () => {
    expect(() => parseModuleInstallArgs(['@open-mercato/test-package', '--unknown'])).toThrow(
      'Unsupported option: --unknown',
    )
    expect(() => parseModuleInstallArgs(['@open-mercato/test-package', '--installed'])).toThrow(
      'Unsupported option: --installed',
    )
  })
})
