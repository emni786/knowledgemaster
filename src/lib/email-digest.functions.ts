import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FrequencySchema = z.enum(["off", "weekly", "monthly"]);

export const getEmailSubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context;
    const { data, error } = await supabase
      .from("email_subscriptions")
      .select("email, frequency, last_sent_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      subscription: data,
      defaultEmail: (claims as { email?: string } | null)?.email ?? null,
    };
  });

export const saveEmailSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      email: z.string().trim().email().max(255),
      frequency: FrequencySchema,
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("email_subscriptions")
      .upsert({ user_id: userId, email: data.email, frequency: data.frequency }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const sendTestDigest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { sendDigestForUser } = await import("@/lib/email-digest.server");
    const res = await sendDigestForUser(userId, "weekly", { force: true });
    return res;
  });
