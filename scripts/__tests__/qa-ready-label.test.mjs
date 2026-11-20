import assert from 'node:assert/strict';
import test from 'node:test';

import {
  needsHumanQa,
  readiness,
  reviewBlocker,
  run,
  scanQueries,
  signedOffOnHead,
} from '../../.github/scripts/qa-ready-label.mjs';

const head = 'a'.repeat(40);
const oldHead = 'b'.repeat(40);

const policy = { humanOnlyLabels: ['feature', 'security', 'risk-high'], humanOnlyAuthors: ['uxowner'] };

const makePr = (overrides = {}) => ({
  number: 1,
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  reviewDecision: 'APPROVED',
  headRefOid: head,
  author: { login: 'dev' },
  labels: { nodes: [] },
  latestReviews: { nodes: [{ state: 'APPROVED', commit: { oid: head } }] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
  ...overrides,
});

const noSignoff = async () => false;
const gated = ['needs-qa', 'needs-human-qa'];

test('the default policy keeps the protected labels and the UX owner', () => {
  assert.equal(needsHumanQa(makePr(), ['needs-qa', 'risk-high']), true);
  assert.equal(needsHumanQa(makePr({ author: { login: 'zielivia' } }), ['needs-qa']), true);
  assert.equal(needsHumanQa(makePr(), ['needs-qa', 'bug']), false);
});

test('needsHumanQa classifies protected PRs from the configured labels and authors', () => {
  assert.equal(needsHumanQa(makePr(), ['needs-qa', 'security'], policy), true);
  assert.equal(needsHumanQa(makePr(), ['needs-qa', 'risk-high'], policy), true);
  assert.equal(needsHumanQa(makePr({ author: { login: 'uxowner' } }), ['needs-qa'], policy), true);
  assert.equal(needsHumanQa(makePr(), ['needs-qa', 'bug'], policy), false);
  assert.equal(needsHumanQa(makePr(), ['needs-qa', 'security', 'skip-qa'], policy), false);
  assert.equal(needsHumanQa(makePr(), ['security'], policy), false);
  assert.equal(needsHumanQa(makePr(), ['needs-qa', 'security', 'needs-human-qa'], policy), false);
  assert.equal(needsHumanQa(makePr({ state: 'CLOSED' }), ['needs-qa', 'security'], policy), false);
});

test('readiness requires an approval on the current head', async () => {
  assert.equal(await readiness(makePr(), gated, noSignoff), null);
  const stale = makePr({ latestReviews: { nodes: [{ state: 'APPROVED', commit: { oid: oldHead } }] } });
  assert.equal(await readiness(stale, gated, noSignoff), 'no approval on the current head');
});

test('readiness honors an active changes request even with a stale routing label', async () => {
  const labels = [...gated, 'automerge-signal-1-cr'];
  const decision = makePr({ reviewDecision: 'CHANGES_REQUESTED' });
  assert.equal(await readiness(decision, labels, noSignoff), 'changes requested');
  const mixed = makePr({
    latestReviews: { nodes: [{ state: 'APPROVED', commit: { oid: head } }, { state: 'CHANGES_REQUESTED', commit: { oid: head } }] },
  });
  assert.equal(await readiness(mixed, labels, noSignoff), 'changes requested');
  const unreviewed = makePr({ reviewDecision: 'REVIEW_REQUIRED', latestReviews: { nodes: [] } });
  assert.equal(await readiness(unreviewed, labels, noSignoff), 'no approving review');
});

test('readiness holds on labels, CI, conflicts and an existing sign-off', async () => {
  assert.equal(await readiness(makePr(), ['needs-qa'], noSignoff), 'no needs-human-qa');
  assert.equal(await readiness(makePr(), [...gated, 'qa-failed'], noSignoff), 'held by qa-failed');
  assert.equal(await readiness(makePr({ isDraft: true }), gated, noSignoff), 'not open or draft');
  const red = makePr({ commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } });
  assert.equal(await readiness(red, gated, noSignoff), 'CI is FAILURE');
  assert.equal(await readiness(makePr({ mergeable: 'CONFLICTING' }), gated, noSignoff), 'conflicts');
  assert.equal(await readiness(makePr(), [...gated, 'qa-approved'], async () => true), 'QA already signed off this head');
  assert.equal(await readiness(makePr(), [...gated, 'qa-approved'], noSignoff), null);
});

test('reviewBlocker passes only a current-head approval without change requests', () => {
  assert.equal(reviewBlocker(makePr()), null);
  assert.equal(reviewBlocker(makePr({ reviewDecision: null })), 'no approving review');
});

test('signedOffOnHead trusts only the latest verdict from a permitted non-author pinned to the head', async () => {
  const allowed = async (login) => login !== 'outsider';
  const verdict = (login, sha, result = 'READY TO MERGE') => ({
    user: { login, type: 'User' },
    body: `QA verdict: ${result}\nQA head: \`${sha}\``,
  });
  assert.equal(await signedOffOnHead(makePr(), [verdict('qa', head)], allowed), true);
  assert.equal(await signedOffOnHead(makePr(), [verdict('qa', oldHead)], allowed), false);
  assert.equal(await signedOffOnHead(makePr(), [verdict('dev', head)], allowed), false);
  assert.equal(await signedOffOnHead(makePr(), [verdict('outsider', head)], allowed), false);
  assert.equal(await signedOffOnHead(makePr(), [verdict('qa', head), verdict('qa', head, 'NO-GO')], allowed), false);
  assert.equal(await signedOffOnHead(makePr(), [{ user: { login: 'bot', type: 'Bot' }, body: verdict('x', head).body }], allowed), false);
});

test('scanQueries covers every configured label and author', () => {
  const queries = scanQueries(policy);
  assert.ok(queries.includes('label:"needs-qa" label:"risk-high" -label:"needs-human-qa"'));
  assert.ok(queries.includes('label:"needs-qa" author:uxowner -label:"needs-human-qa"'));
});

const makeGithub = (pr) => {
  const calls = [];
  return {
    calls,
    graphql: async () => ({ repository: { pullRequest: pr } }),
    paginate: async () => [],
    rest: {
      issues: {
        addLabels: async ({ labels }) => calls.push(['add', ...labels]),
        removeLabel: async ({ name }) => calls.push(['remove', name]),
        listComments: async () => ({ data: [] }),
      },
      repos: { getCollaboratorPermissionLevel: async () => ({ data: { role_name: 'write' } }) },
      search: { issuesAndPullRequests: async () => ({ data: [] }) },
    },
  };
};
const core = { info: () => {}, warning: () => {} };
const prEvent = (action, labels, overrides = {}) => {
  const pr = makePr({ labels: { nodes: labels.map((name) => ({ name })) }, ...overrides });
  return { pr, context: { repo: { owner: 'o', repo: 'r' }, eventName: 'pull_request_target', payload: { action, pull_request: { number: 1 } } } };
};

test('a push removes ready-for-qa without re-adding it', async () => {
  const { pr, context } = prEvent('synchronize', [...gated, 'ready-for-qa']);
  const github = makeGithub(pr);
  await run({ github, context, core, policy });
  assert.deepEqual(github.calls, [['remove', 'ready-for-qa']]);
});

test('a stale routing label cannot re-add ready-for-qa while changes are requested', async () => {
  const { pr, context } = prEvent('labeled', [...gated, 'automerge-signal-1-cr'], { reviewDecision: 'CHANGES_REQUESTED' });
  const github = makeGithub(pr);
  await run({ github, context, core, policy });
  assert.deepEqual(github.calls, []);
});

test('a protected PR gets needs-human-qa and, when ready, ready-for-qa', async () => {
  const { pr, context } = prEvent('labeled', ['needs-qa', 'security']);
  const github = makeGithub(pr);
  await run({ github, context, core, policy });
  assert.deepEqual(github.calls, [['add', 'needs-human-qa'], ['add', 'ready-for-qa']]);
});
