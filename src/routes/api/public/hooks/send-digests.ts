import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/send-digests")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { runDueDigests } = await import("@/lib/email-digest.server");
          const result = await runDueDigests();
          return Response.json({ ok: true, ...result });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Unknown error";
          console.error("send-digests failed", e);
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});
