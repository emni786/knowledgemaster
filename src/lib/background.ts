import { AsyncLocalStorage } from "node:async_hooks";

type Ctx = { waitUntil?: (p: Promise<unknown>) => void } | null | undefined;

const storage = new AsyncLocalStorage<Ctx>();

export function runWithRequestContext<T>(ctx: unknown, fn: () => Promise<T> | T): Promise<T> | T {
  return storage.run(ctx as Ctx, fn);
}

/**
 * Run a promise in the background after the response is returned.
 * Uses Cloudflare's ExecutionContext.waitUntil when available so the Worker
 * does not cancel the work. Falls back to a fire-and-forget promise.
 */
export function runInBackground(promise: Promise<unknown>): void {
  const ctx = storage.getStore();
  const wrapped = promise.catch((err) => {
    console.error("[background] task failed:", err);
  });
  if (ctx && typeof ctx.waitUntil === "function") {
    try {
      ctx.waitUntil(wrapped);
      return;
    } catch {
      // ignore and fall back
    }
  }
  void wrapped;
}
