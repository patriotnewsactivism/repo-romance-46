// Standalone Vite config — no Lovable dependency.
// Replaces @lovable.dev/vite-tanstack-config with direct plugin imports.

import { defineConfig, loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import react from "@vitejs/plugin-react";

export default defineConfig(async ({ command, mode }) => {
  const plugins = [];

  // ── Core plugins ──────────────────────────────────────────────
  plugins.push(tailwindcss());
  plugins.push(tsconfigPaths({ projects: ["./tsconfig.json"] }));

  // ── TanStack Start ────────────────────────────────────────────
  const { tanstackStart } = await import("@tanstack/react-start/plugin/vite");
  plugins.push(
    tanstackStart({
      server: { entry: "server" },
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
    }),
  );

  // ── Nitro (deploy target) — build only ────────────────────────
  if (command === "build") {
    const { nitro } = await import("nitro/vite");
    plugins.push(nitro({ defaultPreset: "vercel" }));
  }

  // ── React ─────────────────────────────────────────────────────
  plugins.push(react());

  // ── VITE_* env define (ensures SSR has access to env vars) ────
  const loadedEnv = loadEnv(mode, process.cwd(), "VITE_");
  const envDefine: Record<string, string> = {};
  for (const [key, value] of Object.entries(loadedEnv)) {
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  return {
    define: envDefine,
    css: { transformer: "lightningcss" as const },
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    server: { host: "::", port: 8080 },
    plugins,
  };
});
