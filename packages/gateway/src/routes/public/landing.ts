import { Hono } from "hono";
import { verifySettingsSession } from "./settings-auth";

export function createLandingRoutes() {
  const app = new Hono();

  app.get("/", (c) => {
    const session = verifySettingsSession(c);
    if (session?.isAdmin) return c.redirect("/agents");
    if (session) return c.redirect("/settings");
    return c.redirect("/agents/login");
  });

  return app;
}
