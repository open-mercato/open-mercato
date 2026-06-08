import { parseRailwayDeployOptions, redactRailwayCliArgs } from '../options'

describe('parseRailwayDeployOptions', () => {
  it('parses the complete command surface', () => {
    expect(parseRailwayDeployOptions([
      '--project=my-shop',
      '--env', 'staging',
      '--service', 'web',
      '--no-worker',
      '--source', 'local',
      '--region', 'europe-west4',
      '--env-file', '.env.railway',
      '--domain', 'shop.example.com',
      '--no-wait-domain',
      '--volume', '/app/storage',
      '--token', 'token',
      '--non-interactive',
      '--dry-run',
      '--yes',
      '--write-env',
      '--no-track',
      '--force-rename',
      '--timeout', '120',
      '--allow-secret-passthrough', 'OPENAI_API_KEY',
      '--allow-secret-passthrough=RESEND_API_KEY',
      '--verbose',
    ], {})).toMatchObject({
      project: 'my-shop',
      environment: 'staging',
      service: 'web',
      worker: false,
      source: 'local',
      region: 'europe-west4',
      envFile: '.env.railway',
      domain: 'shop.example.com',
      waitDomain: false,
      volume: '/app/storage',
      token: 'token',
      nonInteractive: true,
      dryRun: true,
      yes: true,
      writeEnv: true,
      track: false,
      forceRename: true,
      timeoutSeconds: 120,
      allowedSecretKeys: ['OPENAI_API_KEY', 'RESEND_API_KEY'],
      verbose: true,
    })
  })

  it('enables non-interactive mode in CI', () => {
    expect(parseRailwayDeployOptions([], { CI: 'true' }).nonInteractive).toBe(true)
  })

  it('allows cleanup dry-runs in non-interactive environments without --yes', () => {
    expect(parseRailwayDeployOptions(['--cleanup', '--dry-run'], { CI: 'true' }))
      .toMatchObject({
        cleanup: true,
        dryRun: true,
        nonInteractive: true,
        yes: false,
      })
  })

  it.each([
    [['--source', 'invalid'], 'Invalid --source'],
    [['--timeout', '0'], '--timeout must be'],
    [['--unknown'], 'Unknown Railway deploy option'],
    [['--cleanup', '--non-interactive'], 'requires --yes'],
  ])('rejects invalid arguments', (args, expectedMessage) => {
    expect(() => parseRailwayDeployOptions(args, {})).toThrow(expectedMessage)
  })

  it('redacts both token flag syntaxes in dispatcher output', () => {
    expect(redactRailwayCliArgs(['--token', 'secret', '--token=other', '--dry-run']))
      .toEqual(['--token', '****', '--token=****', '--dry-run'])
  })
})
