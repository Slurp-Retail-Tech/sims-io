---
name: fix-issues
description: Diagnose and fix reproducible bugs, regressions, and failing tests. Use when an issue already exists, a stack trace is available, or a failure can be reproduced.
---

# Fix Issues

## When To Use

Use this skill when:

- a bug report already exists
- a failing test or crash is known
- logs point to a concrete failure path
- a recent change introduced a regression

## Workflow

1. Restate expected behavior and actual behavior.
2. Reproduce the issue with the narrowest reliable command.
3. Isolate the root cause, not just the symptom.
4. Apply the smallest coherent fix.
5. Add or update tests when the repo supports them.
6. Verify the fix and report any residual risk.

## Output

Always provide:

- root cause
- files changed
- tests or checks run
- unresolved risks or follow-up work
