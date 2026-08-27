import { Router, type IRouter } from "express";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";
import { captureException, flushSentry } from "../instrument";

const router: IRouter = Router();

const clientErrorSchema = z
  .object({
    kind: z.enum(["react", "window-error", "unhandled-rejection"]).default("window-error"),
    message: z.string().min(1).max(1000),
    name: z.string().max(120).optional(),
    stack: z.string().max(6000).optional(),
    component_stack: z.string().max(6000).optional(),
    route: z.string().max(500).optional(),
    release: z.string().max(200).optional(),
  })
  .strict();

function safeRoute(route?: string): string | undefined {
  if (!route) return undefined;
  return route.split("?")[0]?.split("#")[0]?.slice(0, 500) || undefined;
}

router.post(
  "/observability/client-error",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = clientErrorSchema.parse(req.body);
    const error = new Error(payload.message);
    error.name = payload.name || "ClientError";
    if (payload.stack) error.stack = payload.stack;

    captureException(error, {
      tags: {
        subsystem: "browser",
        kind: payload.kind,
        route: safeRoute(payload.route),
        release: payload.release,
      },
      extra: payload.component_stack
        ? { component_stack: payload.component_stack.slice(0, 6000) }
        : undefined,
    });

    if (process.env["VERCEL"]) waitUntil(flushSentry());
    res.status(202).json({ accepted: true });
  }),
);

export default router;
