---
name: deploy-staging
description: Prepare and execute safe staging deployments with verification notes. Use when a branch is ready for QA, preview validation, or pre-production testing.
---

# Deploy Staging

## Workflow

1. Confirm the target environment and branch.
2. Review whether uncommitted or unrelated changes exist.
3. Run the minimum required validation before deploy.
4. Check for migrations, seeds, assets, config, and feature flags.
5. Execute the documented staging deploy path.
6. Capture URLs, release identifiers, and smoke-test outcomes.

## Guardrails

- Do not use this skill for production deploys.
- Call out irreversible changes before deployment.
- Prefer repository deploy scripts over ad hoc commands.

## Output

- deployed revision
- environment target
- validation performed
- smoke-test result
- rollback considerations
