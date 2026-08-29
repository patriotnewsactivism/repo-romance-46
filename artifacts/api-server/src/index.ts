import "./instrument";
import app from "./app";
import { logger } from "./lib/logger";
import { backgroundTaskCount, drainBackgroundTasks } from "./lib/background-tasks";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal, activeBackgroundTasks: backgroundTaskCount() }, "Graceful shutdown started");
  const hardStop = setTimeout(() => {
    logger.error({ signal, activeBackgroundTasks: backgroundTaskCount() }, "Graceful shutdown timed out");
    process.exit(1);
  }, 15_000);
  hardStop.unref();
  server.close(async () => {
    await drainBackgroundTasks(10_000);
    clearTimeout(hardStop);
    logger.info({ signal }, "Graceful shutdown complete");
    process.exit(0);
  });
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
