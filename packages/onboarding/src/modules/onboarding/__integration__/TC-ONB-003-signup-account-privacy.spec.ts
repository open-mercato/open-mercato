import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes';

export const integrationMeta = {
  description: 'Public signup answers identically whether or not the address already has an account',
  dependsOnModules: ['onboarding', 'auth'],
  requiredEnvVars: ['SELF_SERVICE_ONBOARDING_ENABLED'],
};

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000';
const EMAIL_CAPTURE_PATH = process.env.OM_TEST_EMAIL_CAPTURE_PATH?.trim() || join(process.cwd(), '.ai', 'qa', 'email-capture.jsonl');
const EXISTING_ACCOUNT_PASSWORD = 'Valid1!Pass';
const SUBMITTED_PASSWORD = 'Str0ng!Passw0rd';
const SUBMITTER_FIRST_NAME = 'Mallory';
const SUBMITTER_ORGANIZATION = 'Probe Industries';

type CapturedEmail = {
  to?: string;
  subject?: string;
  links?: string[];
  text?: string;
};

type Probe = {
  status: number;
  rawBody: string;
};

function submission(email: string) {
  return {
    email,
    firstName: SUBMITTER_FIRST_NAME,
    lastName: 'Prober',
    organizationName: SUBMITTER_ORGANIZATION,
    password: SUBMITTED_PASSWORD,
    confirmPassword: SUBMITTED_PASSWORD,
    termsAccepted: true,
    marketingConsent: false,
  };
}

async function probeSignup(request: APIRequestContext, baseUrl: string, email: string): Promise<Probe> {
  const response = await request.post(`${baseUrl}/api/onboarding/onboarding`, {
    headers: { 'content-type': 'application/json' },
    data: submission(email),
  });
  return { status: response.status(), rawBody: await response.text() };
}

/**
 * The submitted address is the one field the two branches may legitimately differ on, because the
 * caller supplied it. Masking it turns "same shape" into a byte comparison of everything else.
 */
function maskSubmittedAddress(rawBody: string, email: string): string {
  return rawBody.split(email).join('<submitted-address>');
}

async function readCapturedEmails(): Promise<CapturedEmail[]> {
  try {
    const raw = await readFile(EMAIL_CAPTURE_PATH, 'utf8');
    return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line) as CapturedEmail);
  } catch {
    return [];
  }
}

async function waitForCapturedEmails(to: string): Promise<CapturedEmail[]> {
  const deadline = Date.now() + 10_000;
  let captured: CapturedEmail[] = [];
  while (Date.now() < deadline) {
    captured = (await readCapturedEmails()).filter((entry) => entry.to?.toLowerCase() === to.toLowerCase());
    if (captured.length > 0) return captured;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return captured;
}

async function deleteOnboardingRequest(email: string): Promise<void> {
  await withClient(async (client) => {
    await client.query('delete from onboarding_requests where email_hash = any($1::text[])', [lookupHashCandidates(email)]);
  }).catch(() => undefined);
}

/**
 * TC-ONB-003: public signup does not disclose whether an address already has an account
 * Source: GitHub issue #5505, PR #5677
 * Surface: POST /api/onboarding/onboarding (requireAuth: false)
 *
 * The unit suite pins the property at the handler level with every collaborator mocked. This one
 * proves it against a real instance: a real user row created in setup, the real encryption/lookup
 * path that finds it, the real OnboardingService pending-request window, and the real outbound
 * mail (captured on disk) that carries the out-of-band notice.
 */
test.describe('TC-ONB-003: signup does not reveal whether an email already has an account', () => {
  test('answers identically for a registered and an unregistered address, and notifies the owner out of band', async ({ request, baseURL }) => {
    const resolvedBaseUrl = baseURL ?? BASE_URL;
    const unique = randomUUID().slice(0, 8);
    const registeredEmail = `qa-onb-003-registered-${unique}@example.test`;
    const unregisteredEmail = `qa-onb-003-fresh-${unique}@example.test`;

    const adminToken = await getAuthToken(request, 'admin');
    const { organizationId } = getTokenContext(adminToken);
    let registeredUserId: string | null = null;

    try {
      registeredUserId = await createUserFixture(request, adminToken, {
        email: registeredEmail,
        password: EXISTING_ACCOUNT_PASSWORD,
        organizationId,
        roles: [],
      });

      // (a) First probe of each address: same status, and the same body once the caller's own
      // address is masked out.
      const registeredFirst = await probeSignup(request, resolvedBaseUrl, registeredEmail);
      const unregisteredFirst = await probeSignup(request, resolvedBaseUrl, unregisteredEmail);

      expect(registeredFirst.status, 'a submission for a registered address should be accepted').toBe(200);
      expect(unregisteredFirst.status, 'both branches should answer with the same status').toBe(registeredFirst.status);
      expect(maskSubmittedAddress(unregisteredFirst.rawBody, unregisteredEmail))
        .toBe(maskSubmittedAddress(registeredFirst.rawBody, registeredEmail));

      // (c) The registered address is told out of band: a notice, never a verification link.
      const registeredMail = await waitForCapturedEmails(registeredEmail);
      expect(registeredMail.length, 'the account owner should be notified out of band').toBeGreaterThan(0);
      const noticeLinks = registeredMail.flatMap((entry) => entry.links ?? []);
      expect(noticeLinks.some((link) => link.includes('/login')), 'the notice should link to sign-in').toBeTruthy();
      expect(noticeLinks.some((link) => link.includes('/api/onboarding/onboarding/verify?token=')), 'the account owner must never receive a verification link').toBeFalsy();
      const noticeText = registeredMail.map((entry) => entry.text ?? '').join(' ');
      expect(noticeText, 'the notice must not carry the submitter-supplied name').not.toContain(SUBMITTER_FIRST_NAME);
      expect(noticeText, 'the notice must not carry the submitter-supplied organization').not.toContain(SUBMITTER_ORGANIZATION);

      // (c) The unregistered address gets the verification mail and no notice.
      const unregisteredMail = await waitForCapturedEmails(unregisteredEmail);
      expect(unregisteredMail.length, 'a new address should receive the verification email').toBeGreaterThan(0);
      const verificationLinks = unregisteredMail.flatMap((entry) => entry.links ?? []);
      expect(verificationLinks.some((link) => link.includes('/api/onboarding/onboarding/verify?token=')), 'a new address should receive a verification link').toBeTruthy();
      const unregisteredSubjects = unregisteredMail.map((entry) => entry.subject ?? '').join(' ');
      expect(unregisteredSubjects, 'a new address must not receive the existing-account notice').not.toContain('About your Open Mercato account');

      // (b) Second probe of each, inside the ten-minute windows: the registered address is inside
      // the notice throttle and the new one is inside the pending-verification window, and those
      // two throttles must not become a way to tell the branches apart across probes.
      const registeredSecond = await probeSignup(request, resolvedBaseUrl, registeredEmail);
      const unregisteredSecond = await probeSignup(request, resolvedBaseUrl, unregisteredEmail);

      expect(registeredSecond.status, 'a repeated probe should stay accepted').toBe(200);
      expect(unregisteredSecond.status, 'both throttled branches should answer with the same status').toBe(registeredSecond.status);
      expect(maskSubmittedAddress(unregisteredSecond.rawBody, unregisteredEmail))
        .toBe(maskSubmittedAddress(registeredSecond.rawBody, registeredEmail));
      expect(maskSubmittedAddress(registeredSecond.rawBody, registeredEmail), 'a repeated probe should look like a first one')
        .toBe(maskSubmittedAddress(registeredFirst.rawBody, registeredEmail));

      // No onboarding request may be created for an address that already has an account: the
      // submitter's strings must never reach a row that belongs to the account owner's address.
      const rowsForRegistered = await withClient(async (client) => {
        const result = await client.query<{ id: string }>(
          'select id from onboarding_requests where email_hash = any($1::text[])',
          [lookupHashCandidates(registeredEmail)],
        );
        return result.rowCount ?? 0;
      });
      expect(rowsForRegistered, 'no onboarding request should exist for a registered address').toBe(0);
    } finally {
      await deleteOnboardingRequest(unregisteredEmail);
      await deleteUserIfExists(request, adminToken, registeredUserId);
    }
  });
});
