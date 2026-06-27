import "./lib/fetch-config.js"; // must be first: configures global fetch dispatcher before anything else calls fetch
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./lib/env.js";
import { authRoutes } from "./routes/auth.js";
import { installRoutes } from "./routes/install.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { rulesRoutes } from "./routes/rules.js";

const app = new Hono();

// Structured-ish request logging with no secret values — useful for
// the "meaningful observability" stretch goal and for debugging a
// live deploy without ssh access.
app.use(async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(
    JSON.stringify({
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms,
    })
  );
});

app.use(
  "*",
  cors({
    origin: env.webOrigin,
    credentials: true,
  })
);

app.get("/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));

app.route("/", authRoutes);
app.route("/", installRoutes);
app.route("/", webhookRoutes);
app.route("/", dashboardRoutes);
app.route("/", rulesRoutes);

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  console.error("[unhandled]", err);
  return c.json({ error: "internal server error" }, 500);
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`Server listening on port ${info.port}`);
});
