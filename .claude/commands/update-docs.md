---
description: Update project docs after a significant change or session. Updates status, schema, and learning if needed.
---

Update Cottix documentation after what just happened.

1. Read recent conversation context to understand what changed.

2. Update `docs/status.md`:
   - Move completed items to Done with today's date
   - Update In Progress and Next sections

3. If any DB/schema changed:
   - Update `docs/backend-schema.md` — table descriptions, new RPCs, RLS changes
   - Add a note if a new Supabase SQL constraint is required

4. If a new pattern or gotcha was discovered:
   - Propose ONE line for `.claude/learning.md` critical patterns section
   - Show me the line before writing it
   - Only add if it would prevent a future mistake — not just "this is how it works"
   - learning.md critical patterns section stays under 15 lines total

5. If a product/business decision was made:
   - Add to `docs/product.md` under relevant section with date

6. Confirm what was updated.
