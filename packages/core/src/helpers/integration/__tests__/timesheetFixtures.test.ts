import { createTimeProjectFixture } from '../timesheetFixtures';

type FetchCall = { path: string; options: { method: string; data?: unknown } };

function fakeRequest(calls: FetchCall[], body: unknown = { id: 'project-1' }) {
  return {
    fetch: async (path: string, options: { method: string; data?: unknown }) => {
      calls.push({ path, options });
      return {
        ok: () => true,
        status: () => 200,
        json: async () => body,
      };
    },
  } as never;
}

describe('createTimeProjectFixture', () => {
  it('names the missing customer instead of letting the API answer 422', async () => {
    const calls: FetchCall[] = [];
    await expect(createTimeProjectFixture(fakeRequest(calls), 'token')).rejects.toThrow(
      /requires input\.customerId/,
    );
    expect(calls).toHaveLength(0);
  });

  it('rejects the pre-0.7.1 input shape the same way', async () => {
    // The parameter stayed optional so third-party specs written against the
    // published helper still compile; the call is refused at runtime instead.
    const calls: FetchCall[] = [];
    await expect(
      createTimeProjectFixture(fakeRequest(calls), 'token', { name: 'Legacy project' }),
    ).rejects.toThrow(/requires input\.customerId/);
    expect(calls).toHaveLength(0);
  });

  it('rejects a blank customer id', async () => {
    const calls: FetchCall[] = [];
    await expect(
      createTimeProjectFixture(fakeRequest(calls), 'token', { customerId: '' }),
    ).rejects.toThrow(/requires input\.customerId/);
    expect(calls).toHaveLength(0);
  });

  it('posts the customer id when one is supplied', async () => {
    const calls: FetchCall[] = [];
    const id = await createTimeProjectFixture(fakeRequest(calls), 'token', {
      customerId: 'customer-1',
      name: 'Consulting',
      code: 'CONS',
    });
    expect(id).toBe('project-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/api/staff/timesheets/time-projects');
    expect(calls[0].options.data).toMatchObject({
      customerId: 'customer-1',
      name: 'Consulting',
      code: 'CONS',
    });
  });
});
