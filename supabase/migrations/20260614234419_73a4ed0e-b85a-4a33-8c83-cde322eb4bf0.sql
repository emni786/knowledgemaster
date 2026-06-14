-- Remove the permissive realtime.messages policy that allowed any
-- authenticated user to subscribe to any broadcast/presence topic.
-- The app uses postgres_changes only, which is governed by table RLS,
-- so removing this policy does not affect existing live updates.
DROP POLICY IF EXISTS "Authenticated users can receive realtime" ON realtime.messages;