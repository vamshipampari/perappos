---
description: Post-feature checklist — typecheck, tests, docs, commit. Run after completing a feature.
---

Ship this feature cleanly.

1. Run typecheck:

```bash
   npx tsc --noEmit
```

If errors → fix them before proceeding. Do not continue with errors.

2. Identify and run affected tests:

```bash
   npx jest [relevant-path]
```

Report which tests ran and whether they passed.

3. Check: did any DB schema change? If yes, run /schema-update first.

4. Check: did miniapp_api.md change? If yes, remind me to run /sync-docs.

5. Create a commit:

```bash
   git add -A
   git commit -m "[type]: [description]"
```

Use conventional commits: feat, fix, docs, refactor, test, chore

6. Ask: "Anything significant discovered this session that should go into learning.md? If yes, run /capture-learning."

7. Summary: what shipped, tests passed, what still needs doing.
