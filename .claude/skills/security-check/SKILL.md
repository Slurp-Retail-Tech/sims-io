---
name: security-check
description: Run an application-security pass on code or configuration changes. Use when work touches auth, secrets, untrusted input, file handling, networking, or infrastructure.
---

# Security Check

## Review Areas

- authentication and authorization
- input validation
- output encoding
- secret handling
- network exposure
- dependency risk
- insecure logging
- unsafe defaults

## Workflow

1. Identify trust boundaries.
2. Find attacker-controlled inputs.
3. Check authn and authz paths separately.
4. Review secrets, logs, and external calls.
5. Report issues by severity with exploit path and remediation.

## Output

- issue
- severity
- exploit path
- affected files or surfaces
- remediation
- remaining blind spots
