---
title: "Authoritative command guards must validate final interceptor input"
modules: ["example","customers","shared"]
areas: ["module-data","architecture","testing"]
topics: ["command-pattern","data-integrity","concurrency","api-interceptors","testing"]
---

# Authoritative command guards must validate final interceptor input

**Context**: A Visit availability interceptor validated working hours early in the command pipeline, while a later supported interceptor could still change the scheduled interval or assigned subject. The transaction callback correctly received the final input but initially rechecked booking overlap only.

**Problem**: Splitting one invariant across pipeline stages leaves a bypass whenever later modifiers can change fields that the early stage validated. Locking and conflict checks do not protect omitted parts of the invariant; a no-conflict Visit moved outside working hours could still commit.

**Rule**: The last transaction-bound guard before persistence must revalidate the complete write invariant from the final post-interceptor input. Use the same transaction-aware query surface for mutable data, and add a real interceptor-pipeline regression where a late modifier changes the guarded fields without relying on a separate conflict to reject the write.

**Applies to**: Command interceptors with `modifiedInput`, transaction callbacks, availability/reservation checks, and any staged validation whose authoritative fields can change after preflight.
