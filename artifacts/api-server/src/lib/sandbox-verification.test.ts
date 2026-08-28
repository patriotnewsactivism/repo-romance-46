import { describe, expect, it } from "vitest";
import { isSafePreviewHost, reduceDeploymentState, safePreviewUrl } from "./sandbox-verification";

describe("sandbox preview URL safety", () => {
  it("allows known ephemeral deployment hosts", () => {
    expect(isSafePreviewHost("example-abc.vercel.app")).toBe(true);
    expect(isSafePreviewHost("project-preview.onrender.com")).toBe(true);
    expect(isSafePreviewHost("feature-123.pages.dev")).toBe(true);
    expect(isSafePreviewHost("service-abc-uc.a.run.app")).toBe(true);
  });

  it("blocks localhost, arbitrary hosts, credentials, ports, and non-https URLs", () => {
    expect(isSafePreviewHost("localhost")).toBe(false);
    expect(isSafePreviewHost("example.com")).toBe(false);
    expect(safePreviewUrl("http://demo.vercel.app")).toBeNull();
    expect(safePreviewUrl("https://user:pass@demo.vercel.app")).toBeNull();
    expect(safePreviewUrl("https://demo.vercel.app:8443")).toBeNull();
    expect(safePreviewUrl("https://127.0.0.1")).toBeNull();
  });

  it("normalizes safe preview URLs without fragments", () => {
    expect(safePreviewUrl("https://demo.vercel.app/path?q=1#secret-fragment")).toBe(
      "https://demo.vercel.app/path?q=1",
    );
  });
});

describe("deployment state reduction", () => {
  it("fails closed when any selected deployment status reports failure", () => {
    expect(reduceDeploymentState(["success", "failure"])).toBe("failed");
    expect(reduceDeploymentState(["error"])).toBe("failed");
  });

  it("keeps the completion run verifying while deployment work is pending", () => {
    expect(reduceDeploymentState(["queued"])).toBe("pending");
    expect(reduceDeploymentState(["success", "in_progress"])).toBe("pending");
  });

  it("passes a terminal successful deployment", () => {
    expect(reduceDeploymentState(["success"])).toBe("passed");
    expect(reduceDeploymentState([])).toBe("unknown");
  });
});
