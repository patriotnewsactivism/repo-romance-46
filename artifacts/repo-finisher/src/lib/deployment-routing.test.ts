import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * GitHub sign-in starts on the canonical frontend origin
 * (`/api/auth/github/start`). If Vercel's catch-all sends that path to
 * `index.html`, the SPA renders its own 404 page and nobody can sign in.
 */
const rootConfigPath = path.resolve(import.meta.dirname, "../../../../vercel.json");
const appConfigPath = path.resolve(import.meta.dirname, "../../vercel.json");
const API_ORIGIN = "https://api.portfolio.donmatthews.live";

interface Route {
  src?: string;
  dest?: string;
  handle?: string;
}

interface Rewrite {
  source?: string;
  destination?: string;
}

describe("Vercel routing for the canonical frontend", () => {
  it("proxies /api to the API before the SPA catch-all", () => {
    const { routes } = JSON.parse(readFileSync(rootConfigPath, "utf8")) as { routes: Route[] };

    expect(routes[0]).toEqual({ src: "/api/(.*)", dest: `${API_ORIGIN}/api/$1` });
    expect(routes[routes.length - 1]).toEqual({ src: "/.*", dest: "/index.html" });
  });

  it("keeps the same /api proxy in the app-level config", () => {
    const { rewrites } = JSON.parse(readFileSync(appConfigPath, "utf8")) as { rewrites: Rewrite[] };

    expect(rewrites[0]).toEqual({ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` });
    expect(rewrites[rewrites.length - 1]).toEqual({ source: "/(.*)", destination: "/index.html" });
  });
});
