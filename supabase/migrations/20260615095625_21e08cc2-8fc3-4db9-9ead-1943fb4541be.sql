
CREATE TABLE IF NOT EXISTS public.email_subscriptions (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('off','weekly','monthly')),
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_subscriptions TO authenticated;
GRANT ALL ON public.email_subscriptions TO service_role;

ALTER TABLE public.email_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own subscription" ON public.email_subscriptions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_email_subscriptions_updated
  BEFORE UPDATE ON public.email_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
