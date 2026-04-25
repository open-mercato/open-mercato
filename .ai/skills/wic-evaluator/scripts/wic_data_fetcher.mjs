#!/usr/bin/env node

import { execFileSync } from "child_process";

function ghJson(args) {
  try {
    const out = execFileSync("gh", args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(out);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error running gh ${args.join(" ")}: ${message}`);
    return null;
  }
}

function parseRequiredFlag(argv, name) {
  const idx = argv.indexOf(name);
  if (idx === -1 || !argv[idx + 1]) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return argv[idx + 1];
}

function parseDateRange(argv) {
  return {
    from: parseRequiredFlag(argv, "--from"),
    to: parseRequiredFlag(argv, "--to"),
  };
}

function parseProfiles(argv) {
  return parseRequiredFlag(argv, "--profiles")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sortReviewComments(comments) {
  return [...comments].sort((left, right) => {
    const a = `${left.createdAt ?? ""}|${left.user ?? ""}|${left.authorAssociation ?? ""}|${left.state ?? ""}|${left.body ?? ""}`;
    const b = `${right.createdAt ?? ""}|${right.user ?? ""}|${right.authorAssociation ?? ""}|${right.state ?? ""}|${right.body ?? ""}`;
    return a.localeCompare(b);
  });
}

function sortPayload(payload) {
  payload.bounties.sort((left, right) => left.number - right.number);
  payload.contributions.sort((left, right) => {
    const byProfile = left.profile.localeCompare(right.profile);
    if (byProfile !== 0) {
      return byProfile;
    }
    const byType = left.type.localeCompare(right.type);
    if (byType !== 0) {
      return byType;
    }
    return left.number - right.number;
  });
}

function main() {
  const argv = process.argv.slice(2);
  const { from, to } = parseDateRange(argv);
  const profiles = parseProfiles(argv);
  const repoIdx = argv.indexOf("--repo");
  const repo = repoIdx !== -1 ? argv[repoIdx + 1] : "open-mercato/open-mercato";
  const formatIdx = argv.indexOf("--format");
  const format = formatIdx !== -1 ? argv[formatIdx + 1] : "json";

  const payload = {
    metadata: {
      repo,
      from,
      to,
      profiles,
      generatedAt: new Date().toISOString(),
    },
    bounties: [],
    contributions: [],
  };

  console.error(`[fetcher] Fetching bounties from ${repo}...`);
  const openBounties = ghJson([
    "issue",
    "list",
    "-R",
    repo,
    "--label",
    "bounty",
    "--state",
    "open",
    "--limit",
    "500",
    "--json",
    "number,title,body,createdAt,closedAt,labels",
  ]);
  const closedBounties = ghJson([
    "issue",
    "list",
    "-R",
    repo,
    "--label",
    "bounty",
    "--search",
    `closed:>=${from}`,
    "--state",
    "closed",
    "--limit",
    "500",
    "--json",
    "number,title,body,createdAt,closedAt,labels",
  ]);

  if (openBounties) {
    payload.bounties.push(...openBounties);
  }
  if (closedBounties) {
    payload.bounties.push(...closedBounties);
  }

  for (const profile of profiles) {
    console.error(`[fetcher] Fetching PRs for ${profile}...`);

    const mergedQuery = encodeURIComponent(
      `repo:${repo} is:pr is:merged author:${profile} merged:${from}..${to}`,
    );
    const mergedPrs = ghJson([
      "api",
      "--paginate",
      "-X",
      "GET",
      `search/issues?q=${mergedQuery}&per_page=100`,
    ]);

    const updatedQuery = encodeURIComponent(
      `repo:${repo} is:pr -is:merged author:${profile} updated:${from}..${to}`,
    );
    const unmergedPrs = ghJson([
      "api",
      "--paginate",
      "-X",
      "GET",
      `search/issues?q=${updatedQuery}&per_page=100`,
    ]);

    console.error(`[fetcher] Fetching Issues for ${profile}...`);
    const issueQuery = encodeURIComponent(
      `repo:${repo} is:issue author:${profile} created:${from}..${to}`,
    );
    const issues = ghJson([
      "api",
      "--paginate",
      "-X",
      "GET",
      `search/issues?q=${issueQuery}&per_page=100`,
    ]);

    const items = [
      ...(mergedPrs?.items || []).map((item) => ({
        ...item,
        wicSourceType: "pull_request",
      })),
      ...(unmergedPrs?.items || []).map((item) => ({
        ...item,
        wicSourceType: "pull_request",
      })),
      ...(issues?.items || []).map((item) => ({
        ...item,
        wicSourceType: "issue",
      })),
    ];

    for (const item of items) {
      let files = [];
      let additions = 0;
      let deletions = 0;
      let changedFiles = 0;

      if (item.wicSourceType === "pull_request") {
        const prStats = ghJson(["api", `repos/${repo}/pulls/${item.number}`]);
        if (prStats) {
          additions = prStats.additions ?? 0;
          deletions = prStats.deletions ?? 0;
          changedFiles = prStats.changed_files ?? 0;

          const prFiles = ghJson([
            "api",
            "--paginate",
            `repos/${repo}/pulls/${item.number}/files?per_page=100`,
          ]);
          if (Array.isArray(prFiles)) {
            files = prFiles.map((file) => file.filename).sort((left, right) => left.localeCompare(right));
          }
        }
      }

      const comments =
        ghJson([
          "api",
          "--paginate",
          `repos/${repo}/issues/${item.number}/comments?per_page=100`,
        ]) || [];
      const reviews =
        item.wicSourceType === "pull_request"
          ? ghJson([
              "api",
              "--paginate",
              `repos/${repo}/pulls/${item.number}/reviews?per_page=100`,
            ]) || []
          : [];

      const normalizedComments = [
        ...comments.map((entry) => ({
          user: entry.user?.login,
          authorAssociation: entry.author_association,
          body: entry.body,
          state: null,
          createdAt: entry.created_at,
        })),
        ...reviews.map((entry) => ({
          user: entry.user?.login,
          authorAssociation: entry.author_association,
          body: entry.body,
          state: entry.state,
          createdAt: entry.submitted_at ?? entry.created_at ?? null,
        })),
      ];

      payload.contributions.push({
        profile,
        number: item.number,
        type: item.wicSourceType,
        title: item.title,
        body: item.body,
        url: item.html_url,
        state: item.state,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        mergedAt: item.pull_request?.merged_at || item.merged_at || null,
        closedAt: item.closed_at,
        stats: {
          additions,
          deletions,
          changedFiles,
        },
        filesSummary: files,
        reviewComments: sortReviewComments(normalizedComments),
      });
    }
  }

  payload.contributions = Array.from(
    new Map(payload.contributions.map((item) => [`${item.number}:${item.type}`, item])).values(),
  );
  payload.bounties = Array.from(new Map(payload.bounties.map((item) => [item.number, item])).values());
  sortPayload(payload);

  if (format === "json") {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`# WIC Data Payload (${from} to ${to})`);
  console.log(`\n## Active Bounties`);
  for (const bounty of payload.bounties) {
    console.log(`- **[#${bounty.number}] ${bounty.title}** (State: ${bounty.closedAt ? "closed" : "open"})`);
    if (bounty.body) {
      console.log("");
      console.log("  ```");
      console.log(bounty.body);
      console.log("  ```");
    }
  }

  console.log(`\n## Contributions`);
  for (const contribution of payload.contributions) {
    console.log(
      `### [${contribution.profile}] ${contribution.type.toUpperCase()} #${contribution.number}: ${contribution.title}`,
    );
    console.log(`- URL: ${contribution.url}`);
    console.log(`- State: merged=${Boolean(contribution.mergedAt)}, closed=${Boolean(contribution.closedAt)}`);
    console.log(
      `- Stats: +${contribution.stats.additions} -${contribution.stats.deletions} (${contribution.stats.changedFiles} files)`,
    );
    if (contribution.filesSummary.length > 0) {
      console.log(`- Files touched (${contribution.filesSummary.length}):`);
      for (const filename of contribution.filesSummary) {
        console.log(`  - ${filename}`);
      }
    }
    if (contribution.body) {
      console.log("\n**Body / Spec Link:**\n");
      console.log("```");
      console.log(contribution.body);
      console.log("```\n");
    }
    if (contribution.reviewComments.length > 0) {
      console.log(`**Review / Comments (${contribution.reviewComments.length}):**\n`);
      for (const entry of contribution.reviewComments) {
        const stateSuffix = entry.state ? ` [${entry.state}]` : "";
        const assoc = entry.authorAssociation ? ` (${entry.authorAssociation})` : "";
        console.log(`- **${entry.user ?? "unknown"}**${assoc}${stateSuffix} — ${entry.createdAt ?? ""}`);
        if (entry.body) {
          console.log("");
          console.log("  ```");
          console.log(entry.body);
          console.log("  ```");
        }
      }
      console.log("");
    }
  }
}

main();
