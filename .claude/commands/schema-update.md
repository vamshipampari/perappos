---
description: Update backend-schema.md after a database migration. Run after supabase db push.
---

The DB schema just changed. Update the documentation.

1. Find the most recent migration file in `supabase/migrations/`
2. Read it to understand what changed (new table, column, RPC, policy, index, constraint)
3. Update `docs/backend-schema.md`:
   - Add/modify the relevant table section
   - Add/modify RPCs if any were created
   - Note any new constraints under "Critical constraints"
   - Update "Last updated" date
4. If RLS policies changed, verify they match the patterns in `.claude/rules.md` (no ::text cast, etc.)
5. Commit the docs update:

```bash
   git add docs/backend-schema.md
   git commit -m "docs: update backend-schema.md after migration $(date +%Y%m%d)"
```

6. Remind: cottix-hub should sync this file before next session.
