---
name: git-commit
description: Prepare intentional commits with clear scope and good commit messages. Use when changes are ready to stage or when the user asks for a commit message.
---

# Git Commit

## Workflow

1. Review the diff for accidental files and unrelated changes.
2. Group the final scope into a coherent commit.
3. Write a commit message that explains intent.
4. Mention migrations, generated files, or config changes explicitly.
5. Verify the staged set matches the message.

## Commit Rules

- use imperative mood
- keep the subject concise
- add a body only when it adds real context
- mention breaking changes or migration steps when relevant
