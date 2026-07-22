# The engagement workflow — from a client-docs folder to a client-ready deck

The end-to-end pattern around `om-gap-analysis`, distilled from real engagements: the workspace that hosts many analyses, how the three phases run across contexts, and how the three output MDs become the deck a client actually sees. Open it when setting up a first engagement, or when asked to turn a finished analysis into a client-facing report.

## A standalone workspace, not the platform repo

The skill does not run inside the platform repository. The proven setup is a dedicated engagement workspace — its own small git repo — hosting one folder per client. The platform is named once in the config; `bin/gap-orientation-preflight` provisions and validates its own checkout under gitignored `.ai/tmp/`, so the workspace never holds platform code:

```
engagements/                           the workspace (its own git repo)
├── .ai/
│   ├── agentic.config.json            the platform section lives here, written once
│   └── gap-analysis/                  where the skill writes its artifacts
├── acme-portal/                       one folder per engagement
│   ├── source-docs/                   client materials exactly as received
│   ├── acme-portal.md                 ← the three MDs move here at handover
│   ├── acme-portal-summary.md
│   ├── acme-portal-backlog.md
│   └── acme-portal-deck.html          the deck the client receives
└── another-client/…
```

A workspace config that every engagement reuses:

```json
{
  "version": 1,
  "baseBranch": "auto",
  "tracker": "github",
  "platform": {
    "repo": "acme/platform",
    "branch": "integration",
    "companionRepo": "acme/platform-modules",
    "tierMap": [
      { "pathPrefix": "packages/commercial/", "tier": "licensed" }
    ],
    "significantPrAdditions": 10000
  }
}
```

Drop the client materials into `<slug>/source-docs/` exactly as received — transcripts, spec documents, requirement dumps, versioned user-story files. Engagements to date have run on anything from a dozen meeting transcripts to ~40 versioned user-story documents per client.

## The run: three phases, two contexts

```
/om-gap-analysis acme-portal/source-docs --project acme-portal    ← Phase 1
/clear
/om-gap-analysis .ai/gap-analysis/acme-portal.md                  ← Phases 2 + 3
```

Phase 1 ends when `bin/gap-checklist-gate` returns 0 — then `/clear`, so verification starts with only the structured tree, not the raw-document noise. Phase 2 fills every story through the gates, and Phase 3 synthesizes the summary and backlog in the same context. An interrupted Phase 2 resumes by re-invoking with the same MD; per-story `status:` fields make finished stories skip.

Expect real scale: engagements have produced trees of 7–11 epics and 50–95 stories, and Phase 2 is the long pole — one subagent per story, gated one block at a time.

## Optional — cross-check against a reference

After the analysis is complete, a second input can serve as a second opinion: another project already built on the platform, a roadmap item, a reference implementation. It does not have to be the same product — the point is to test the verdicts against something real. A working reference that already does X on the platform validates a `🟡` verdict (the wiring is proven, not theoretical); its deliberate shortcuts can equally confirm a gap. The cross-check usually shifts confidence, not the effort totals, because the atomic-commit currency already assumed that reuse. Add short reference notes to the stories it touches; skip the step entirely when no relevant reference exists.

## From the three MDs to the deck

Everything in the deck is read off the three MDs — no number is invented, and the license-tier split survives into the client-facing view (a `✅ (core)` and a `✅ (licensed)` are different promises). Any HTML or slide template the team maintains works; keep repeatable per-epic / per-risk blocks. Where each deck element comes from:

| Deck element | Read it from |
|---|---|
| project name, subtitle, intro | the client docs + the summary's executive paragraphs |
| epic / story counts | tree frontmatter `total_epics` / `total_stories` |
| coverage split (✅ / 🟡 / ❌, by tier) | summary → Coverage at a glance |
| gap-to-close total (atomic commits) | backlog → effort roll-up |
| epic cards | summary → Coverage by epic |
| risk cards | summary → Top risks |
| strength cards | summary → What's already strong |
| open-decision cards | summary → Open questions |
| sequencing bars | backlog → phases A / B / C |
| effort histogram / cost curve | per-story `Effort:` scores in the tree |

Two charts have earned their place in every deck so far:

- **Coverage donut** — a `conic-gradient` built from the verdict shares in Coverage at a glance.
- **Cost curve** — for each occupied effort score `s` with count `c`: plot at `x = s`, `y = Fibonacci(s)`, bubble radius `r = sqrt(share / max_share) × R`. The non-linear `y` makes high-effort stories read as the risk they are; bubble area tracks the share of stories.

## The open-decisions section is written for a non-technical decision-maker

The Open questions section is the one a client executive actually reads. Write it for them, not for engineers:

- Plain-language questions: "How do customers sign in?", not "Auth: magic-link vs SSO?".
- No code identifiers in the visible deck — module names, story IDs, and file paths stay in the tree MD for the build team.
- Each answer names the decision, the options, and what the choice moves: cost, timeline, user experience, or compliance.

The test: if a non-technical stakeholder cannot tell what is at stake and why the decision is theirs, the section is not done. Finish with a prose pass — the deck should read as one person's writing, numbers stated as N/M exactly as the MDs carry them.
