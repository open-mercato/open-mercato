/**
 * A small REST client for fixtures and cleanup. The agent never sees it: tests
 * use it to seed a record the flow needs, to prove an outcome the screen only
 * implies, and to delete what a test created, pass or fail.
 *
 * Mirrors the conventions of the repository's own integration helpers
 * (`packages/core/src/helpers/integration/api.ts`): a form login at
 * `/api/auth/login` that answers `{ token }`, `Authorization: Bearer`, and a
 * delete as `DELETE <path>?id=<id>`.
 */

export type Persona = 'admin' | 'employee' | 'superadmin';

export interface ApiResponse<T> {
  readonly status: number;
  readonly body: T | undefined;
}

const DEMO_PASSWORD = process.env.OM_DEMO_PASSWORD ?? 'secret';

const PERSONAS: Record<Persona, { email: string; password: string }> = {
  admin: { email: 'admin@acme.com', password: DEMO_PASSWORD },
  employee: { email: 'employee@acme.com', password: DEMO_PASSWORD },
  superadmin: {
    email: process.env.OM_INIT_SUPERADMIN_EMAIL ?? 'superadmin@acme.com',
    password: process.env.OM_INIT_SUPERADMIN_PASSWORD ?? DEMO_PASSWORD,
  },
};

/** Tokens live two hours server-side; 45 minutes keeps a long run under that. */
const TOKEN_TTL_MS = 45 * 60 * 1000;
const tokenCache = new Map<string, { token: string; mintedAt: number }>();

/** The uuid a detail page's URL ends in. */
export function idFromUrl(url: string): string {
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i.exec(url);
  if (!match) throw new Error(`no record id in ${url}`);
  return match[1]!;
}

export class OmApi {
  private readonly tracked: { path: string; id: string }[] = [];

  private constructor(
    private readonly baseUrl: string,
    private readonly email: string,
    private readonly password: string,
  ) {}

  /** A client signed in as one of the demo personas. */
  static persona(baseUrl: string, persona: Persona): OmApi {
    const account = PERSONAS[persona];
    return new OmApi(baseUrl, account.email, account.password);
  }

  /** Signs in with a form post and returns the bearer token; retries the rate limit. */
  async login(email: string, password: string): Promise<{ token: string }> {
    const form = new URLSearchParams({ email, password });
    let status = 0;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${this.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      status = response.status;
      const body = (await response.json().catch(() => null)) as { token?: unknown } | null;
      if (response.ok && typeof body?.token === 'string' && body.token) return { token: body.token };
      if (status !== 429) break;
      await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
    }
    throw new Error(`login as ${email} failed with status ${status}`);
  }

  private async token(): Promise<string> {
    const key = `${this.baseUrl}|${this.email}`;
    const cached = tokenCache.get(key);
    if (cached && Date.now() - cached.mintedAt < TOKEN_TTL_MS) return cached.token;
    const { token } = await this.login(this.email, this.password);
    tokenCache.set(key, { token, mintedAt: Date.now() });
    return token;
  }

  /** One authenticated JSON request; the body is parsed when the server sent JSON. */
  async request<T = unknown>(method: string, path: string, data?: unknown): Promise<ApiResponse<T>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        'Content-Type': 'application/json',
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const text = await response.text();
    let body: T | undefined;
    try {
      body = text ? (JSON.parse(text) as T) : undefined;
    } catch {
      body = undefined;
    }
    return { status: response.status, body };
  }

  /** Lists `path` and returns the items array, tolerating both `{ items }` and bare arrays. */
  async list<T = Record<string, unknown>>(path: string): Promise<T[]> {
    const response = await this.request<{ items?: T[] } | T[]>('GET', path);
    if (response.status >= 400) throw new Error(`GET ${path} failed with status ${response.status}`);
    if (Array.isArray(response.body)) return response.body;
    return Array.isArray(response.body?.items) ? response.body.items : [];
  }

  /** Creates a record, tracks it for cleanup, and returns its id. */
  async create(path: string, data: Record<string, unknown>): Promise<string> {
    const response = await this.request<{ id?: unknown; data?: { id?: unknown }; item?: { id?: unknown } }>('POST', path, data);
    const id = response.body?.id ?? response.body?.data?.id ?? response.body?.item?.id;
    if (response.status >= 400 || typeof id !== 'string') {
      throw new Error(`POST ${path} failed with status ${response.status}: ${JSON.stringify(response.body)}`);
    }
    this.track(path, id);
    return id;
  }

  /** Remembers a record the test created through the UI, so cleanup deletes it. */
  track(path: string, id: string | undefined): void {
    if (id) this.tracked.push({ path, id });
  }

  /** Deletes every tracked record, newest first, ignoring what is already gone. */
  async cleanup(): Promise<void> {
    for (const { path, id } of this.tracked.splice(0).reverse()) {
      await this.request('DELETE', `${path}?id=${encodeURIComponent(id)}`).catch(() => undefined);
    }
  }
}
