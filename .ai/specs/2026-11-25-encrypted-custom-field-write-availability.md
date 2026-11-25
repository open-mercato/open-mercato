# Encrypted custom field write availability

## Overview

Require a usable tenant data encryption key before committing a value configured as encrypted. Return a retryable error when the key service cannot resolve the key. This implements the custom-field portion of the key-availability work proposed in [PR #10648](https://github.com/open-mercato/open-mercato/pull/10648).

## Behavior

The EAV custom-field writer resolves or provisions a tenant key before sealing a non-null encrypted value. A missing key or a failed key lookup returns HTTP 503 with code `ENCRYPTION_UNAVAILABLE` through the shared CRUD error handler. A custom-field replacement transaction rolls back when sealing cannot proceed. Clearing a value, reading existing values, tenantless values, and deployments with encryption explicitly disabled retain their respective behavior.

## Migration & Backward Compatibility

Clients retry an encrypted-field write after tenant key access recovers. Operators restore key-service access and review or re-seal previously affected records as described in the upgrade notes. Preserving a legacy success path would persist values without their configured encryption. Maintainer acknowledgment of the security exception is pending.

## Verification

Cover unavailable keys, key-service failures, custom-field rollback, explicit disablement, and a successful write after key recovery.
