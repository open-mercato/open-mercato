---
title: "Retest stateful flows and legacy records"
modules: ["catalog", "customers", "workflows", "agent_orchestrator"]
areas: ["backend-ui", "testing"]
topics: ["optimistic-locking", "routing", "i18n", "testing"]
---

# Retest stateful flows and legacy records

**Evidence:** The September 2026 retest found an untranslated Evaluation sub-tab, a product edit that still conflicted on its second save, and customer-linked workflow tasks whose new titles worked while both new links and older records remained broken.

**Rule:** Verify the user's complete sequence through the consuming form or link resolver. For an editor that stays open, save twice and verify the second request uses the version returned after the first save; preserve rejection of a real competing edit. Exercise legacy stored discriminators as well as newly created records. Translation key coverage alone cannot prove localized copy; include the exact reported key in locale-value checks.

**Verification:** Product repeated-save tests, customer workflow-task source/link tests, and agent evaluation locale-value checks cover the separate failure paths. Browser validation must verify the running application actually serves the changed source before attributing results to the patch.
