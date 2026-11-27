---
title: "Invalidate async dialog defaults between openings"
modules: ["sales"]
areas: ["backend-ui","testing"]
topics: ["async-defaults","dialog-lifecycle","race-conditions","regression-testing"]
---

# Invalidate async dialog defaults between openings

**Evidence:** [PR #10984 review](https://github.com/open-mercato/open-mercato/pull/10984#pullrequestreview-6093193664) found that the new-line tax submit guard waited for a lookup only when tax metadata was absent. Reopening the dialog copied the previous opening's default into the form, so the guard skipped the current lookup and could save an outdated rate.

**Rule:** Bind both pending requests and their derived defaults to one dialog opening. Clear the options, default refs and request identity when that opening ends; do not repopulate a fresh form from the previous opening's cache. Keep explicitly stored record values separate from asynchronously supplied defaults.

**Regression:** First load a valid default, close the dialog, reopen with a delayed lookup, and submit before it resolves. Assert that no mutation occurs early and that a failed current lookup prevents saving. A test that only closes before the first response arrives does not exercise a previously populated cache.
