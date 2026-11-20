export const HUMAN_QA_LABEL = 'needs-human-qa';
export const AUTO_QA_LABEL = 'needs-qa';
export const OPT_OUT_LABEL = 'skip-qa';
export const READY_LABEL = 'ready-for-qa';
export const HOLD_LABELS = ['blocked', 'do-not-merge', 'qa-failed', 'skip-qa'];
export const SIGNOFF_ROLES = ['admin', 'maintain', 'write', 'triage'];
export const HUMAN_ONLY_POLICY = {
  humanOnlyLabels: ['security', 'feature', 'risk-high'],
  humanOnlyAuthors: ['zielivia'],
};

export function needsHumanQa(pr, labels, policy = HUMAN_ONLY_POLICY) {
  if (pr.state !== 'OPEN') return false;
  if (labels.includes(HUMAN_QA_LABEL) || labels.includes(OPT_OUT_LABEL) || !labels.includes(AUTO_QA_LABEL)) return false;
  const author = (pr.author?.login ?? '').toLowerCase();
  return policy.humanOnlyLabels.some((label) => labels.includes(label)) || policy.humanOnlyAuthors.includes(author);
}

export function reviewBlocker(pr) {
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes requested';
  const reviews = pr.latestReviews?.nodes ?? [];
  if (reviews.some((review) => review.state === 'CHANGES_REQUESTED')) return 'changes requested';
  if (pr.reviewDecision !== 'APPROVED') return 'no approving review';
  const head = pr.headRefOid.toLowerCase();
  const approvedOnHead = reviews.some((review) => review.state === 'APPROVED' && review.commit?.oid?.toLowerCase() === head);
  if (!approvedOnHead) return 'no approval on the current head';
  return null;
}

export async function signedOffOnHead(pr, comments, canSignOff) {
  const prAuthor = (pr.author?.login ?? '').toLowerCase();
  const head = pr.headRefOid.toLowerCase();
  for (const comment of [...comments].reverse()) {
    const login = comment.user?.login ?? '';
    if (!login || comment.user?.type === 'Bot' || login.toLowerCase() === prAuthor) continue;
    const body = comment.body ?? '';
    const verdict = /QA verdict:[^\n]*/i.exec(body)?.[0];
    if (!verdict) continue;
    if (!(await canSignOff(login))) continue;
    const pinned = /QA head:\s*`?([0-9a-f]{40})\b/i.exec(body)?.[1]?.toLowerCase();
    return /READY TO MERGE/i.test(verdict) && pinned === head;
  }
  return false;
}

export async function readiness(pr, labels, loadSignoff) {
  if (pr.state !== 'OPEN' || pr.isDraft) return 'not open or draft';
  if (!labels.includes(HUMAN_QA_LABEL)) return `no ${HUMAN_QA_LABEL}`;
  const hold = HOLD_LABELS.find((label) => labels.includes(label));
  if (hold) return `held by ${hold}`;
  const review = reviewBlocker(pr);
  if (review) return review;
  const ci = pr.commits.nodes[0]?.commit.statusCheckRollup?.state;
  if (ci !== 'SUCCESS') return `CI is ${ci ?? 'missing'}`;
  if (pr.mergeable === 'CONFLICTING') return 'conflicts';
  if (pr.mergeable !== 'MERGEABLE') return 'mergeability unknown';
  if (labels.includes('qa-approved') && (await loadSignoff())) return 'QA already signed off this head';
  return null;
}

export function scanQueries(policy = HUMAN_ONLY_POLICY) {
  return [
    `label:"${HUMAN_QA_LABEL}"`,
    `label:"${READY_LABEL}"`,
    ...policy.humanOnlyLabels.map((label) => `label:"${AUTO_QA_LABEL}" label:"${label}" -label:"${HUMAN_QA_LABEL}"`),
    ...policy.humanOnlyAuthors.map((login) => `label:"${AUTO_QA_LABEL}" author:${login} -label:"${HUMAN_QA_LABEL}"`),
  ];
}

const prQuery = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      number state isDraft mergeable reviewDecision headRefOid
      author { login }
      labels(first: 100) { nodes { name } }
      latestReviews(first: 100) { nodes { state commit { oid } } }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    }
  }
}`;

export async function run({ github, context, core, policy = HUMAN_ONLY_POLICY }) {
  const { owner, repo } = context.repo;
  const ready = READY_LABEL;

  const roleCache = new Map();
  const canSignOff = async (login) => {
    if (!roleCache.has(login)) {
      let role = 'none';
      try {
        const { data } = await github.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username: login });
        role = data.role_name ?? data.permission ?? 'none';
      } catch (error) {
        core.info(`permission lookup for ${login} failed: ${error.message}`);
      }
      roleCache.set(login, SIGNOFF_ROLES.includes(role));
    }
    return roleCache.get(login);
  };

  const sync = async (number, { removeOnly = false } = {}) => {
    const result = await github.graphql(prQuery, { owner, repo, number });
    const pr = result.repository.pullRequest;
    const labels = pr.labels.nodes.map((label) => label.name);
    if (needsHumanQa(pr, labels, policy)) {
      await github.rest.issues.addLabels({ owner, repo, issue_number: number, labels: [HUMAN_QA_LABEL] });
      labels.push(HUMAN_QA_LABEL);
      core.info(`#${number}: added ${HUMAN_QA_LABEL} (human-only policy)`);
    }
    const loadSignoff = async () => {
      const comments = await github.paginate(github.rest.issues.listComments, {
        owner, repo, issue_number: number, per_page: 100,
      });
      return signedOffOnHead(pr, comments, canSignOff);
    };
    const has = labels.includes(ready);
    const reason = removeOnly ? 'new commits' : await readiness(pr, labels, loadSignoff);
    if (reason && has) {
      await github.rest.issues.removeLabel({ owner, repo, issue_number: number, name: ready });
      core.info(`#${number}: removed ${ready} (${reason})`);
    } else if (!reason && !has) {
      await github.rest.issues.addLabels({ owner, repo, issue_number: number, labels: [ready] });
      core.info(`#${number}: added ${ready}`);
    } else {
      core.info(`#${number}: unchanged (${reason ?? 'ready'})`);
    }
  };

  if (context.eventName === 'pull_request_target') {
    const removeOnly = ['synchronize', 'reopened', 'converted_to_draft'].includes(context.payload.action);
    await sync(context.payload.pull_request.number, { removeOnly });
    return;
  }

  const numbers = new Set();
  for (const query of scanQueries(policy)) {
    const items = await github.paginate(github.rest.search.issuesAndPullRequests, {
      q: `repo:${owner}/${repo} is:pr is:open ${query}`,
      per_page: 100,
    });
    for (const item of items) numbers.add(item.number);
  }
  core.info(`Checking ${numbers.size} pull requests`);
  for (const number of numbers) {
    try {
      await sync(number);
    } catch (error) {
      core.warning(`#${number}: ${error.message}`);
    }
  }
}
