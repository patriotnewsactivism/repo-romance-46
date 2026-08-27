// Vercel Function wrapper around the API bundle produced during `vercel build`.
export const config = { maxDuration: 500 };
export { default } from "../artifacts/api-server/dist/vercel-function/vercel.mjs";
