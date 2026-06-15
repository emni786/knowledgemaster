
DROP POLICY IF EXISTS "collections public read" ON public.collections;
CREATE POLICY "collections public read" ON public.collections
  FOR SELECT TO authenticated
  USING (is_public = true);

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own topic realtime read" ON realtime.messages;
CREATE POLICY "own topic realtime read" ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.topic() = 'links:' || auth.uid()::text
    OR realtime.topic() = 'collections:' || auth.uid()::text
  );
