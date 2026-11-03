# Handoff

- PR: https://github.com/open-mercato/open-mercato/pull/6966 (head `fshagent:fix/workflows-90-day-steps`, base `develop`)
- State: complete. All Tasks rows done. The opening account is read-only on upstream, so labels (`bug`, `priority-high`,
  `risk-medium`, `review`, `skip-qa`) are requested in a PR comment for a maintainer to apply.
- Runner: local; Node 24 required (`yarn generate` refuses Node 22). Jest needs `--maxWorkers` bounded on this host.
