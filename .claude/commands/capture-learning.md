---
description: Capture a learning or gotcha from this session into the right file. Run when something non-obvious was fixed.
argument-hint: [describe the learning, or 'refactor' to clean up learning.md]
---

Capture a learning correctly.

## If called with 'refactor':

1. Read `.claude/learning.md` in full
2. The critical patterns section should have max 15 lines. Prune any that are redundant or too generic.
3. The session log should have max 30 days. Remove anything older.
4. Show me the full diff before writing anything. Wait for approval.

## Otherwise:

Step 1 — Classify (ask me):
"Is this a hard rule that prevents a future mistake, or background context that explains how something works?"

Step 2 — Write:

**Hard rule** → goes in `.claude/learning.md` critical patterns section

- Format: `- [Component]: [what NOT to do] → [what TO do instead]`
- Keep to one line. No paragraphs.
- If adding would exceed 15 lines, ask which existing line to replace.

**Background context** → goes in `docs/technical.md` under the correct subsystem heading

- Add under: PowerSync, WebView, Auth, Supabase, or Deployment
- 3–5 lines. Include: symptom, root cause, fix, prevention.

Step 3 — Confirm:
Show the exact line(s) before writing. Ask for approval. Then write.
