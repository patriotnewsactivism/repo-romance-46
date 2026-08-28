import path from "node:path";
import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";

/** Source-map upload is an explicit production-build capability, never runtime configuration. */
export function sentryBuildPlugins(artifactDir) {
  const releaseName = process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "";
  const enabled = Boolean(
    process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT && releaseName,
  );
  if (!enabled) return [];

  return [
    sentryEsbuildPlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      release: { name: releaseName },
      sourcemaps: {
        assets: path.resolve(artifactDir, "dist/**/*.mjs.map"),
        filesToDeleteAfterUpload: path.resolve(artifactDir, "dist/**/*.mjs.map"),
      },
      telemetry: false,
    }),
  ];
}
