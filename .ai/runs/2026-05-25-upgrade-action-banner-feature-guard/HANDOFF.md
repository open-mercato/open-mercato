# Handoff: upgrade-action-banner-feature-guard

## Status: in-progress

## Run started: 2026-05-25

## What this run does

Gates `UpgradeActionBanner` on the `configs.manage` RBAC feature to prevent an infinite redirect loop for users who lack the feature when `NEXT_PUBLIC_UPGRADE_ACTIONS_ENABLED=true`.

## Current state

- Branch: fix/upgrade-action-banner-feature-guard
- Step 1.1 in progress
