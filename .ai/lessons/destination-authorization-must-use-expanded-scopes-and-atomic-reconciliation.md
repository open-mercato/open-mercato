---
title: "Destination auth requires expanded scopes and atomic reconciliation"
modules: ["auth","directory"]
areas: ["module-data","testing"]
topics: ["access-control","command-pattern","data-integrity","data-scoping"]
---

# Destination auth requires expanded scopes and atomic reconciliation

**Context**: A staff-user move checked raw ACL organization IDs and updated the user before synchronizing destination roles.

**Problem**: Raw grants omit allowed descendants, while separate commits can leave a moved identity linked to roles from the wrong tenant after a sync failure.

**Rule**: Authorize both the current record and its destination against the same canonical descendant-expanded `OrganizationScope`, validate retained and explicit grants, and commit the scope move plus relation reconciliation in one transaction with rollback coverage. Test the post-move guarded access path as well as the move itself.

**Applies to**: Commands and routes that relocate identities or other permission-bearing records between organizations or tenants.
