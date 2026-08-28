import { createRoot } from "react-dom/client";

import App from "./App";
import { ClientErrorBoundary } from "@/components/client-error-boundary";
import { installGlobalErrorHandlers } from "@/lib/telemetry";
import { browserSentryEnabled, SentryErrorBoundary } from "./lib/observability";

import "./index.css";
import "./opaque-header.css";
import "./dark-theme-root.css";

// RepoFinisher is dark-first. Apply the root state before React mounts so the
// first painted frame and all inherited colors use the correct palette.
document.documentElement.classList.add("dark");
document.documentElement.style.colorScheme = "dark";

if (!browserSentryEnabled) installGlobalErrorHandlers();

const application = browserSentryEnabled ? (
  <SentryErrorBoundary>
    <App />
  </SentryErrorBoundary>
) : (
  <ClientErrorBoundary>
    <App />
  </ClientErrorBoundary>
);

createRoot(document.getElementById("root")!).render(application);
