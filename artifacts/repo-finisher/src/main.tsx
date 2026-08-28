import { createRoot } from "react-dom/client";

import App from "./App";
import { ClientErrorBoundary } from "@/components/client-error-boundary";
import { installGlobalErrorHandlers } from "@/lib/telemetry";
import { browserSentryEnabled, SentryErrorBoundary } from "./lib/observability";

import "./index.css";
import "./opaque-header.css";
import "./dark-theme-root.css";

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
