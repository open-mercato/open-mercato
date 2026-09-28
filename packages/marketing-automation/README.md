# @open-mercato/marketing-automation

Visual marketing automation for Open Mercato: author a campaign on a canvas as
**triggers → audience conditions → an ordered action chain**, and have platform events fire it.

The execution model is intentionally not a general workflow graph. A campaign is a spine:
any one of its triggers starts a run, one audience condition set decides whether the run
proceeds, and the action chain runs in order. A step carrying a delay parks the whole
remaining chain in `marketing_scheduled_actions` and a worker resumes it later.

## Status

Phase 1. See the module guide in `src/modules/marketing_automation/AGENTS.md`.
