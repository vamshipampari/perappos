-- delete_own_account: lets a signed-in user permanently delete all their data
-- and their auth record. SECURITY DEFINER is required to delete from auth.users.
CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- 1. Shared instances owned by this user: delete history, data, members, then instances
  DELETE FROM shared_app_data_history
    WHERE instance_id IN (SELECT instance_id FROM shared_instances WHERE owner_id = uid);
  DELETE FROM shared_app_data
    WHERE instance_id IN (SELECT instance_id FROM shared_instances WHERE owner_id = uid);
  DELETE FROM instance_members
    WHERE instance_id IN (SELECT instance_id FROM shared_instances WHERE owner_id = uid);
  DELETE FROM shared_instances WHERE owner_id = uid;

  -- 2. Memberships in instances owned by others
  DELETE FROM instance_members WHERE user_id = uid;

  -- 3. Personal synced data (id columns are TEXT composites, not uuid)
  DELETE FROM app_data WHERE user_id = uid::text;
  DELETE FROM installed_apps WHERE user_id = uid::text;

  -- 4. Generated content
  DELETE FROM generated_apps WHERE user_id = uid;
  DELETE FROM generation_jobs WHERE user_id = uid::text;

  -- 5. Profile and promo history
  DELETE FROM promo_redemptions WHERE user_id = uid;
  DELETE FROM user_profiles WHERE user_id = uid;

  -- 6. Auth record — invalidates all sessions on all devices
  DELETE FROM auth.users WHERE id = uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;
