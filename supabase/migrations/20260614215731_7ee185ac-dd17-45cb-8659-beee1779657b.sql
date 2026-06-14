
-- Tighten owner policies to authenticated role only
DROP POLICY IF EXISTS "links owner all" ON public.links;
CREATE POLICY "links owner all" ON public.links
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "collections owner all" ON public.collections;
CREATE POLICY "collections owner all" ON public.collections
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "collection_links owner all" ON public.collection_links;
CREATE POLICY "collection_links owner all" ON public.collection_links
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.collections c WHERE c.id = collection_links.collection_id AND c.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.collections c WHERE c.id = collection_links.collection_id AND c.owner_id = auth.uid()));

DROP POLICY IF EXISTS "analytics owner all" ON public.analytics_events;
CREATE POLICY "analytics owner all" ON public.analytics_events
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "rss_feeds owner all" ON public.rss_feeds;
CREATE POLICY "rss_feeds owner all" ON public.rss_feeds
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- API token policies: also restrict to authenticated
DROP POLICY IF EXISTS "Users create own tokens" ON public.api_tokens;
CREATE POLICY "Users create own tokens" ON public.api_tokens
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS "Users delete own tokens" ON public.api_tokens;
CREATE POLICY "Users delete own tokens" ON public.api_tokens
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);
DROP POLICY IF EXISTS "Users view own tokens" ON public.api_tokens;
CREATE POLICY "Users view own tokens" ON public.api_tokens
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);

-- Fix profile email exposure: restrict SELECT to the owning user only
DROP POLICY IF EXISTS "profiles select self or public" ON public.profiles;
CREATE POLICY "profiles select self" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles insert self" ON public.profiles;
CREATE POLICY "profiles insert self" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles update self" ON public.profiles;
CREATE POLICY "profiles update self" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Realtime channel authorization: require authenticated session.
-- postgres_changes events still respect RLS on the published tables (links, collections),
-- so only owners receive their own row events.
DROP POLICY IF EXISTS "Authenticated users can receive realtime" ON realtime.messages;
CREATE POLICY "Authenticated users can receive realtime"
  ON realtime.messages FOR SELECT TO authenticated USING (true);
