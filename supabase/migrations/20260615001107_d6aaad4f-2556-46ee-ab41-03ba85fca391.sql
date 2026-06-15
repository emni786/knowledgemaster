
-- Hide secret columns from authenticated/anon; service_role retains full access
REVOKE SELECT (token_hash) ON public.api_tokens FROM authenticated;
REVOKE SELECT (token_hash) ON public.api_tokens FROM anon;

REVOKE SELECT (bot_token, webhook_secret) ON public.telegram_bots FROM authenticated;
REVOKE SELECT (bot_token, webhook_secret) ON public.telegram_bots FROM anon;

-- Restrict public-read of collection_links to authenticated users only
DROP POLICY IF EXISTS "collection_links public read" ON public.collection_links;
CREATE POLICY "collection_links read public to authenticated"
  ON public.collection_links FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.collections c
    WHERE c.id = collection_links.collection_id AND c.is_public = true
  ));
