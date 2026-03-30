---
description: Run code review on recent changes. Uses the code-reviewer agent in isolated context.
---

Review the recent changes.

Use the code-reviewer subagent to review:

1. Files changed since last commit: `git diff HEAD --name-only`
2. Or files I specify in this prompt

The reviewer focuses on:

- WebView bridge security (vaultBridge.ts, vaultShimSync.ts, bridge-merge-handler.ts)
- PowerSync patterns — row IDs, sync rules, RLS
- Supabase RLS correctness (no ::text cast, correct policies)
- Correctness of merge strategies
- Known gotchas from .claude/learning.md

Return: specific issues found, severity (high/medium/low), and suggested fixes.
