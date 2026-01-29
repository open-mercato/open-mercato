# Release Notes - Open Mercato v0.4.2

**Date:** January 29, 2026

## Highlights

This release introduces the **Notifications module**, **Agent Skills infrastructure**, **Dashboard Analytics Widgets**, and a major architectural improvement decoupling module setup with a centralized config. It also includes important security fixes, Docker infrastructure improvements, and dependency updates.

---

## Features

### Notifications Module (#422, #457)
Full implementation of the in-app notifications system, including notification types, subscribers, custom renderers, and user preferences. *(@pkarw)*

### Agent Skills Infrastructure (#455)
Created the foundational structure for agent skills in Open Mercato, enabling extensible AI-powered capabilities. *(@pat-lewczuk)*

### Dashboard Analytics Widgets (#408)
New analytics widgets for the dashboard, providing richer data visualization and insights. *(@haxiorz)*

### Decoupled Module Setup - Centralized ModuleSetupConfig (#446)
Resolves #410 -- module setup is now decoupled using a centralized `ModuleSetupConfig`, improving modularity and reducing coupling between modules. *(@redjungle-as)*

### Specs Reorganization (#436, #416)
Reorganized architecture specs and added new specifications for SDD, messages, notifications, progress tracking, and record locking. *(@pkarw)*

### CodeQL Security Improvements (#418)
Addressed CodeQL-identified security issues across the codebase. *(@pkarw)*

---

## Bug Fixes

### Security: Prevent Open Redirect in Session Refresh (#429)
Fixed an open redirect vulnerability in the authentication session refresh flow. *(@bartek-filipiuk)*

### Fix Assistant Module (#442)
Resolved issues in the AI assistant module. *(@fto-aubergine)*

### Fix Global Search Dialog Title (#440)
Corrected the dialog title for global search and added specs for new widgets. *(@pkarw)*

### Fix Docker Compose Overlapping Services (#448, #449)
Resolved service conflicts in Docker Compose configuration where services were overlapping. *(@MStaniaszek1998)*

### Fix Docker Compose Configuration (#423, #424)
General Docker Compose configuration fixes. *(@pkarw)*

### Change Base Image to Debian for OpenCode (#443)
Switched the OpenCode container base image to Debian for better compatibility. *(@MStaniaszek1998)*

---

## Infrastructure & DevOps

### Change Service Port (#434)
Updated the default service port configuration. *(@MStaniaszek1998)*

### Create Dockerfile for Docs (#425)
Added a dedicated Dockerfile for building and serving the documentation site. *(@MStaniaszek1998)*

---

## Dependencies

- **#454** - Bump `tar` from 7.5.6 to 7.5.7 *(security patch)*
- **#447** - Bump `npm_and_yarn` group across 2 directories

---

## Contributors

- @pkarw
- @pat-lewczuk
- @MStaniaszek1998
- @bartek-filipiuk
- @fto-aubergine
- @redjungle-as
- @haxiorz
- @dependabot
