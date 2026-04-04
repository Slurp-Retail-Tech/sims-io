---
name: write-release-notes
description: Turn merged work into concise release notes grouped by user impact. Use when preparing a changelog, stakeholder update, or release summary.
---

# Write Release Notes

## Workflow

1. Collect the commit range, merged PRs, or shipped items.
2. Group changes by user impact, not commit order.
3. Separate new features, improvements, fixes, and breaking changes.
4. Note any migrations, rollout steps, or operational changes.
5. Remove internal-only noise unless it affects users.
6. Create a release note markdown [version no.md] at /src/app/(app)/release-notes/content

## Output Format

- Summary
- New
- Improved
- Fixed
- Breaking changes
- Upgrade notes
