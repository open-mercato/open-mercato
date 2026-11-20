import { resolveBuiltInDemoUserEmails, resolveDemoUserEmails } from '../setup-app'

describe('demo user emails', () => {
  const originalAdmin = process.env.OM_INIT_ADMIN_EMAIL
  const originalEmployee = process.env.OM_INIT_EMPLOYEE_EMAIL

  afterEach(() => {
    if (originalAdmin === undefined) delete process.env.OM_INIT_ADMIN_EMAIL
    else process.env.OM_INIT_ADMIN_EMAIL = originalAdmin
    if (originalEmployee === undefined) delete process.env.OM_INIT_EMPLOYEE_EMAIL
    else process.env.OM_INIT_EMPLOYEE_EMAIL = originalEmployee
  })

  it('matches the seeded addresses when nothing is overridden', () => {
    delete process.env.OM_INIT_ADMIN_EMAIL
    delete process.env.OM_INIT_EMPLOYEE_EMAIL

    expect(resolveBuiltInDemoUserEmails()).toEqual(resolveDemoUserEmails())
  })

  it('never returns an operator-configured address from the built-in list', () => {
    process.env.OM_INIT_ADMIN_EMAIL = 'owner@example.test'
    process.env.OM_INIT_EMPLOYEE_EMAIL = 'staff@example.test'

    const builtIn = resolveBuiltInDemoUserEmails().map((entry) => entry.email)

    expect(resolveDemoUserEmails().map((entry) => entry.email)).toEqual(
      expect.arrayContaining(['owner@example.test', 'staff@example.test']),
    )
    expect(builtIn).toEqual(['superadmin@acme.com', 'admin@acme.com', 'employee@acme.com'])
  })
})
