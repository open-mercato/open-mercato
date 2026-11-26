# Execution plan for PR #9314

Adopted from [PR #9314](https://github.com/open-mercato/open-mercato/pull/9314), authored by @adeptofvoltron, and [issue #5173](https://github.com/open-mercato/open-mercato/issues/5173).

## Goal

Publish the production MCP HTTP authentication and operator migration guidance in the official MCP guide.

## Scope and assumptions

The PR's implementation, regression tests, and upgrade notes establish the behavior to document. The documentation follow-up does not change the authentication contract. The named Emergency Security Exception decision and protected authorization QA remain maintainer actions.

## Progress

### Phase 1: Existing session authorization change

- [x] 1.1 Require session authorization on MCP HTTP tool calls — c9df4f5289

### Phase 2: Official documentation

- [x] 2.1 Document production HTTP authentication, chat recovery, and operator migration — 03ff3ab131
