// Vercel serverless entrypoint for the existing Express API.
//
// The frontend is deployed as a static Vite app. Without a function under
// /api, same-origin calls such as /api/github/connect resolve to Vercel's 404
// page and GitHub OAuth can never persist the provider token. Exporting the
// Express app as a Vercel Function keeps the browser and API on one origin.
import app from "../artifacts/api-server/src/app";

export default app;
