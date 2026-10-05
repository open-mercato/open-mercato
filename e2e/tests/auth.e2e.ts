import { test, expect, unique, credentials, secrets, noticeAckCookies } from './support/fixtures';

/**
 * Authentication & user management.
 * Ported from .ai/qa/scenarios/TC-AUTH-001, 002, 004, 008, 012, 014, 015.
 */
test.describe('auth', { tags: ['auth'] }, () => {
  test('TC-AUTH-001 a user signs in and lands on the dashboard', async ({ app, agent, web, screen }) => {
    const admin = credentials.user('admin');
    await app.open('/login');

    // The secret never reaches the model: it plans with the name, the runner fills the field.
    await agent.act('Sign in with the given email and password', {
      params: { email: admin.username, password: admin.password },
    });

    await expect(web).toHaveURL(/\/backend(?:[/?#].*)?$/, { timeout: 60_000 });
    await expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await agent.assert('the admin dashboard is showing and the signed-in account menu displays the email that was used');
  });

  test('TC-AUTH-002 wrong credentials are rejected with a generic error', async ({ app, agent, web, stamp }) => {
    await app.open('/login');

    // An unknown email keeps the per-email rate limit away from the demo admin account.
    await agent.act('Try to sign in with email {email} and password {password}', {
      params: { email: unique(`nobody-${stamp.replace(/\W/g, '').toLowerCase()}@acme.com`), password: 'definitely-wrong' },
    });

    await expect(web).toHaveURL(/\/login(?:[/?#].*)?$/);
    await agent.assert('the login form is still showing with an error that says the email or password is invalid, without revealing which one was wrong');
  });

  // Logging out revokes the server-side session behind the saved 'admin' session, which
  // would sign every later test out. So this test signs in on its own, as the employee.
  test('TC-AUTH-004 logging out clears the session', async ({ app, agent, web, screen }) => {
    const employee = credentials.user('employee');
    await web.setCookies(noticeAckCookies(app.baseUrl!));
    await app.open('/login');
    await screen.getByLabel('Email').fill(employee.username);
    await screen.getByLabel('Password', { exact: true }).fill(employee.password);
    await screen.getByRole('button', { name: 'Sign in' }).tap();
    await expect(web).toHaveURL(/\/backend(?:[/?#].*)?$/, { timeout: 60_000 });

    await agent.act('Open the account menu in the top-right corner and log out');

    await expect(web).toHaveURL(/\/login(?:[/?#].*)?$/, { timeout: 30_000 });
    const cookies = await web.cookies();
    expect(cookies.find((cookie) => cookie.name === 'auth_token')).toBeUndefined();
  });

  test('TC-AUTH-008 an admin creates a user who can then sign in', { session: 'admin' }, async ({ app, agent, api, stamp }) => {
    const email = `${stamp.replace(/\W/g, '-').toLowerCase()}@acme.com`;
    const password = secrets.get('new-user-password');
    await app.open('/backend/users');

    await agent.act(
      'Create a new user with email {email} and the given password, in the only available organization, with the role {role}. Submit the form.',
      { params: { email: unique(email), password, role: 'employee' } },
    );

    await agent.assert('the users list is showing and includes the newly created user');

    // Deterministic proof, then cleanup through the API.
    const users = await api.list<{ id: string; email: string }>(`/api/auth/users?search=${encodeURIComponent(email)}&pageSize=20`);
    const created = users.find((user) => user.email?.toLowerCase() === email);
    expect(created).toBeTruthy();
    api.track('/api/auth/users', created?.id);

    const login = await api.login(email, process.env.E2E_NEW_USER_PASSWORD ?? 'Valid1!Pass');
    expect(login.token).toBeTruthy();
  });

  test('TC-AUTH-012 an admin creates a role', { session: 'admin' }, async ({ app, agent, api, stamp }) => {
    const roleName = `${stamp.toLowerCase().replace(/\s+/g, '-')}-role`;
    await app.open('/backend/roles');

    await agent.act('Create a new role named {name}. Leave every other setting at its default and submit.', {
      params: { name: unique(roleName) },
    });
    await agent.assert(`the roles list shows a role named "${roleName}"`);

    const roles = await api.list<{ id: string; name: string }>('/api/auth/roles');
    const created = roles.find((role) => role.name === roleName);
    expect(created).toBeTruthy();
    api.track('/api/auth/roles', created?.id);
  });

  test('TC-AUTH-015 an employee is denied the users administration page', { session: 'employee' }, async ({ app, agent, apiAs }) => {
    await app.open('/backend/users');

    await agent.assert('the page refuses access to user administration (an access-denied or permission message, or a redirect to the login form), and no list of user accounts is visible');

    const employee = apiAs('employee');
    const response = await employee.request('GET', '/api/auth/users?pageSize=1');
    expect([401, 403]).toContain(response.status);
  });

  test('TC-AUTH-014 switching organization changes the data scope', { session: 'admin' }, async ({ app, agent, api, web }) => {
    // The demo tenant ships one organization; the scenario only means something with two.
    const switcher = await api.request<{ items: OrgNode[]; selectedId: string | null }>('GET', '/api/organization-switcher');
    const selectable = flattenOrganizations(switcher.body?.items ?? []).filter((node) => node.selectable);
    test.skip(selectable.length < 2, `the signed-in admin can select ${selectable.length} organization(s); seed a second one to run this scenario`);
    const current = selectable.find((node) => node.id === switcher.body?.selectedId) ?? selectable[0]!;
    const other = selectable.find((node) => node.id !== current.id)!;
    await app.open('/backend');

    await agent.act('Open the organization switcher in the header and select the organization {name}', { params: { name: other.name } });
    await agent.assert(`the header shows "${other.name}" as the current organization`);

    await expect
      .poll(async () => (await web.cookies()).find((cookie) => cookie.name === 'om_selected_org')?.value ?? null, { timeout: 15_000 })
      .toBe(other.id);
    await app.open('/backend/customers/companies');
    await agent.assert(`the organization switcher still shows "${other.name}" after navigating to another page`);
  });
});
interface OrgNode {
  id: string;
  name: string;
  selectable: boolean;
  children: OrgNode[];
}

function flattenOrganizations(nodes: OrgNode[]): OrgNode[] {
  return nodes.flatMap((node) => [node, ...flattenOrganizations(node.children ?? [])]);
}

