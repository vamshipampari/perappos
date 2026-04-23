---
description: Sync miniapp_api.md from perappos to cottix-landing docs page. Run after editing miniapp_api.md.
---

Sync the API documentation across repos.

1. Read `./perappos/docs/miniapp_api.md`
2. Read `./cottix-landing/src/pages/docs.md` (or wherever the docs page lives — search for it if unsure)
3. The landing docs page wraps the API doc in a layout. Update only the content section, preserve the frontmatter/layout wrapper.
4. In cottix-landing:

```bash
   cd ./cottix-landing
   git checkout -b docs/sync-api-$(date +%Y%m%d)
   git add src/pages/docs.md
   git commit -m "docs: sync miniapp_api.md from perappos"
   git push origin docs/sync-api-$(date +%Y%m%d)
```

5. Create PR via GitHub MCP with title "docs: sync API reference from perappos"
6. Report: "Docs synced. PR: [url]"

Do NOT make this live directly. PR only, I merge.
