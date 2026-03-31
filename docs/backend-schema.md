# Cottix — Backend Schema

Last updated: 2026-04-01 | Used by: perappos + cottix-hub

---

## Local SQLite tables (expo-sqlite — NOT synced)

### apps

Primary store for installed mini-apps.

| Column | Type | Default | Notes |
|---|---|---|---|
| app_id | TEXT PK | — | UUID |
| name | TEXT | — | Display name |
| icon_emoji | TEXT | 📱 | Shown in grid icon |
| icon_bg_color | TEXT | #E5E7EB | Hex color for icon background |
| bundle_path | TEXT | — | Local path or URL (for URL-type apps mirrors source_url) |
| source_type | TEXT | 'url' | 'url' \| 'zip' \| 'html' |
| source_url | TEXT | NULL | Original URL |
| bundle_hash | TEXT | NULL | SHA256 of bundle for update detection |
| auto_update | INTEGER | 1 | Boolean |
| permissions | TEXT | '[]' | JSON array of permission strings |
| bundle_size | INTEGER | 0 | Bytes |
| installed_at | TEXT | datetime('now') | ISO8601 |
| updated_at | TEXT | datetime('now') | ISO8601 |
| last_opened | TEXT | NULL | ISO8601 |
| open_count | INTEGER | 0 | Lifetime open count |
| instance_id | TEXT | NULL | Shared namespace ID when app is collaborative |

### app_data — per-app KV store

Per-app persistent key-value store for local-only data.

| Column | Type | Notes |
|---|---|---|
| app_id | TEXT | FK → apps.app_id |
| key | TEXT | — |
| value | TEXT | JSON string |
| updated_at | TEXT | ISO8601 |
| synced | INTEGER | 0 = local only |

PK: `(app_id, key)`

### shared_data — cross-app shared data

Cross-app shared data (e.g., contacts, preferences).

| Column | Type | Notes |
|---|---|---|
| category | TEXT | Namespace (e.g., 'contacts', 'vault_secrets') |
| key | TEXT | — |
| value | TEXT | JSON string |
| source_app | TEXT | app_id that last wrote this |
| updated_at | TEXT | ISO8601 |

PK: `(category, key)`

> API key names are stored here under `category = 'vault_secrets'`. The actual secret values live in `expo-secure-store`.

---

## PowerSync synced tables

Managed by PowerSync (`powersync.db`) — separate from expo-sqlite. All writes tracked and uploaded to Supabase via `SupabaseConnector`.

### app_data (id = `${appId}/${key}`)

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | `${appId}/${key}` — NOT UUID |
| user_id | TEXT | auth.uid() |
| app_id | TEXT | — |
| key | TEXT | — |
| value | TEXT | — |
| updated_at | TEXT | ISO8601 |

> Supabase `app_data.id` column must be `TEXT` (not UUID). Run `ALTER TABLE app_data ALTER COLUMN id TYPE TEXT;` if needed.

### installed_apps (id = `${userId}/${appId}` TEXT — not UUID)

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | `${userId}/${appId}` — scoped per user to avoid RLS conflicts |
| app_id | TEXT | — |
| name | TEXT | — |
| icon_emoji | TEXT | — |
| icon_bg_color | TEXT | — |
| source_type | TEXT | 'url' \| 'zip' \| 'html' \| 'demo' |
| source_url | TEXT | — |
| bundle_hash | TEXT | — |
| user_id | TEXT | auth.uid() |

> id is `${userId}/${appId}` so each user gets a unique Supabase row. RLS scoped to `auth.uid() = user_id`.

### shared_instances (includes freeze columns)

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | `${instanceId}` |
| instance_id | TEXT | UUID — collaborative namespace |
| app_id | TEXT | — |
| owner_id | TEXT | auth.uid() of creator |
| invite_code | TEXT | Uppercase code shown to users |
| is_frozen | INTEGER | 0/1 — frozen when owner downgrades plan |
| frozen_at | TEXT | ISO8601 timestamp of freeze |
| frozen_reason | TEXT | e.g., 'plan_downgrade' |

> **⚠️ REQUIRED**: PowerSync sync rules must include `is_frozen`, `frozen_at`, `frozen_reason` in the `shared_instances` SELECT projection.

### instance_members (RLS DISABLED — critical)

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | — |
| instance_id | TEXT | FK → shared_instances.instance_id |
| user_id | TEXT | auth.uid() |
| role | TEXT | 'owner' \| 'member' |
| joined_at | TEXT | ISO8601 |
| status | TEXT | 'pending' \| 'active' \| 'rejected' — DEFAULT 'active' for back-compat |
| email | TEXT | Joiner's email stored at join time; shown to owner in approval UI |

> **RLS must remain DISABLED** — PowerSync sync rules handle access control. Enabling RLS here breaks sync.
>
> **Join approval flow**: new members insert with `status='pending'`. Owner updates to `'active'` (approve) or deletes (reject). `shared_app_data` RLS policies enforce `status='active'` so pending members cannot read/write shared data. PowerSync sync rules must include `status` column for the joiner's device to reflect approval locally.
>
> **⚠️ REQUIRED**: Run `supabase/migrations/20260401_join_approval.sql` and `supabase/migrations/20260401_member_email.sql`. Set `REPLICA IDENTITY FULL` on `instance_members` for Supabase Realtime approval detection: `ALTER TABLE instance_members REPLICA IDENTITY FULL;`

### shared_app_data (id = `${instanceId}/${appId}/${key}`, merge columns required)

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | `${instanceId}/${appId}/${key}` — never UUID |
| instance_id | TEXT | FK → shared_instances.instance_id |
| app_id | TEXT | — |
| key | TEXT | — |
| value | TEXT | JSON string |
| updated_by | TEXT | auth.uid() of last writer |
| updated_at | TEXT | ISO8601 |
| version | INTEGER | Monotonically increasing per natural key |
| last_write_id | TEXT | Last accepted client write ID (idempotency) |
| last_merge_strategy | TEXT | Strategy used: noop / fast_path / object_merge / array_merge / lww / frozen |
| last_conflict_count | INTEGER | Conflicts observed during last write |
| last_editor_user_id | TEXT | auth.uid() of the user who last wrote (display-friendly attribution) |
| last_editor_display_name | TEXT | Display name of last writer (best-effort; may be email prefix) |

Natural key: `(instance_id, app_id, key)` — UNIQUE constraint required for upsert.

Merge strategies: `noop` → `idempotent_skip` → `init_blocked` → `fast_path` → `array_merge` → `object_merge` → `lww`

### shared_app_data_history (append-only audit log)

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | — |
| instance_id | TEXT | FK → shared_instances.instance_id |
| app_id | TEXT | — |
| key | TEXT | — |
| value | TEXT | JSON string at time of write |
| editor_user_id | TEXT | auth.uid() of writer |
| editor_display_name | TEXT | Display name at time of write |
| written_at | TIMESTAMPTZ | Timestamp of write |
| merge_strategy | TEXT | Strategy used for this write |
| version | INTEGER | Version number of this write |

RLS: SELECT for instance members (`auth.uid()` in `instance_members` for the instance_id). INSERT from service role via trigger on `shared_app_data` — do NOT expose to direct client writes.

> **⚠️ PowerSync**: Add `shared_app_data_history` as a synced table and add `last_editor_user_id`, `last_editor_display_name` to the `shared_app_data` SELECT projection in the PowerSync dashboard.

---

## Supabase-only tables

### user_profiles

Auto-created on `auth.users` INSERT via trigger.

| Column | Type | Notes |
|---|---|---|
| user_id | uuid PK | FK → auth.users |
| display_name | TEXT | — |
| avatar_emoji | TEXT | — |
| plan | TEXT | 'free' \| 'beta' \| 'pro' \| 'team' |
| plan_expires_at | TIMESTAMPTZ | NULL = no expiry |
| app_install_count | INTEGER | Tracked via RPC; drifts — prefer local SQLite count |
| shared_instance_count | INTEGER | Tracked via RPC |
| promo_code_used | TEXT | Last redeemed code |

Plan limits: free (5 apps, no sharing) · beta/pro (unlimited apps, 5 shared) · team (unlimited everything)

### promo_codes

| Column | Type | Notes |
|---|---|---|
| code | TEXT PK | — |
| plan | TEXT | Plan granted on redemption |
| duration_days | INTEGER | NULL = lifetime |
| max_redemptions | INTEGER | — |
| redemption_count | INTEGER | — |

Active codes: `BETA2026` (90d, 100 max) · `PERAPPOS` (lifetime, 50 max) · `VIBECODER` (30d, 200 max)

### promo_redemptions

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | — |
| user_id | uuid | FK → auth.users |
| code | TEXT | FK → promo_codes |
| redeemed_at | TIMESTAMPTZ | — |

### generated_apps

| Column | Type | Notes |
|---|---|---|
| user_id | uuid | FK → auth.users |
| app_id | TEXT | Matches Cloudflare KV key |
| prompt | TEXT | Original generation prompt |
| title | TEXT | — |
| description | TEXT | — |
| icon_emoji | TEXT | — |
| icon_bg_color | TEXT | — |
| html_size | INTEGER | Bytes |
| hosted_url | TEXT | `https://apps.cottix.co/{appId}` |
| conversation_history | jsonb | For iterative refinement |

Rate limit: 20 generations/user/day (enforced in edge function).

### beta_signups

Create via migration (Phase 3 Step 3.4).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | — |
| email | TEXT UNIQUE | — |
| platform | TEXT | 'ios' \| 'android' \| 'both' |
| name | TEXT | — |
| signed_up_at | TIMESTAMPTZ | — |
| status | TEXT | e.g., 'waitlist', 'invited' |
| play_store_added | BOOLEAN | — |

---

## RPCs (must be deployed)

| RPC | Signature | Notes |
|---|---|---|
| `lookup_shared_instance` | `(p_invite_code text)` | Returns instance row for join flow |
| `add_instance_member` | `(p_instance_id text, p_user_id uuid, p_role text)` | Adds owner or member row |
| `get_own_shared_instance` | `(p_app_id text, p_user_id uuid)` | Returns existing instance for app |
| `get_user_profile` | `()` | Returns plan + limits; auto-downgrades expired plans |
| `redeem_promo_code` | `(code_input text)` | Atomic redemption; calls freeze/unfreeze as needed |
| `increment_app_count` | `(delta int)` | ±1 on install/delete |
| `increment_shared_instance_count` | `(delta int)` | ±1 on create/stop |
| `freeze_owner_instances` | `(p_owner_id uuid)` | Called by get_user_profile on expiry detection |
| `unfreeze_owner_instances` | `(p_owner_id uuid)` | Called by redeem_promo_code on plan upgrade |
| `upsert_shared_app_data_versioned` | `(..., p_last_editor_user_id TEXT DEFAULT NULL, p_last_editor_display_name TEXT DEFAULT NULL)` | Versioned upsert; new attribution params have DEFAULT NULL for deploy-before-migration safety |

---

## Supabase Storage

- Bucket: `user-media`
- Path format: `{appId}/{userId}/{timestamp}.{ext}`
- RLS: authenticated INSERT + SELECT on `user-media`

```sql
CREATE POLICY "auth users upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'user-media');

CREATE POLICY "auth users read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'user-media');
```

---

## Critical constraints

- `shared_app_data` UNIQUE `(instance_id, app_id, key)` — exactly ONE constraint, no duplicates (duplicate constraints cause "more than one unique constraint" error on every upsert after first insert)
- `instance_members` RLS: **DISABLED** — PowerSync sync rules handle access
- `shared_app_data` RLS: active members only — policies check `status = 'active'` in `instance_members`; use `auth.uid()` — never `(auth.uid())::text`
- `app_data.id` in Supabase: must be `TEXT` not `UUID`
- `installed_apps.id` in Supabase: must be `TEXT` (holds `${userId}/${appId}`)

---

## Pending changes

- **RUN MIGRATION**: `supabase/migrations/20260330_attribution.sql` — adds `last_editor_user_id`, `last_editor_display_name` to `shared_app_data`; creates `shared_app_data_history` table; recreates `upsert_shared_app_data_versioned` RPC with attribution params
- **RUN MIGRATION**: `supabase/migrations/20260401_join_approval.sql` — adds `status TEXT DEFAULT 'active'` to `instance_members`; recreates `shared_app_data` RLS policies to require `status = 'active'`
- **RUN MIGRATION**: `supabase/migrations/20260401_member_email.sql` — adds `email TEXT` to `instance_members`
- **RUN SQL**: `ALTER TABLE instance_members REPLICA IDENTITY FULL;` — required for Supabase Realtime to broadcast UPDATE events (instant approval detection on joiner's device)
- **UPDATE POWERSYNC SYNC RULES** (dashboard):
  - Add `status`, `email` to `instance_members` SELECT projection
  - Add `last_editor_user_id`, `last_editor_display_name` to `shared_app_data` SELECT projection
  - Add `is_frozen`, `frozen_at`, `frozen_reason` to `shared_instances` SELECT projection
  - Add `shared_app_data_history` as a new synced table (SELECT projection: all columns)
- Deploy `deploy-html` edge function: `supabase functions deploy deploy-html`
- Create `beta_signups` table via migration (Phase 3 Step 3.4)
