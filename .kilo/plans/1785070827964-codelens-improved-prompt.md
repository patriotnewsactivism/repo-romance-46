# Code Lens — Improved Build Prompt & Product Backlog

## Goal

Ship a reliable, impressive local demo of **Code Lens**: drop in a file (or load a sample), toggle analysis tasks, call xAI `grok-4.5` via the Responses API from the server only, and render structured results in under one minute.

This plan has two deliverables:

1. **Hardened greenfield build prompt** (paste into an implementation agent) — Phase 0 / v1.
2. **Phased product upgrades** after v1 works — streaming, apply/download, history, multi-file, GitHub import.

## Locked decisions

| Topic | Decision |
|---|---|
| Stack | Next.js App Router + TypeScript + Tailwind CSS + shadcn/ui |
| Package manager | npm (or pnpm if agent prefers; document one) |
| Analyze scope (v1) | **Selected file required** — disable Analyze until a file is selected |
| Whole-repo analysis | **Out of v1** — deferred to multi-file phase |
| Model | `grok-4.5` via `POST https://api.x.ai/v1/responses` |
| API key | `XAI_API_KEY` server-only; preflight refuse if missing |
| Mocking | **Forbidden** — real API only; clear errors on failure |
| Naming | Product: "Code Lens". API helper: xAI / Grok. Do not invent "grok-build" as a product name in UI |

## Out of scope (v1)

- Auth, multi-user, persistence to a database
- Writing files back to disk from the browser
- Auto-running all files in an uploaded folder
- Streaming (v1.1), history (v1.2), multi-file (v1.3), GitHub import (v1.4)

---

## Phase 0 — Hardened greenfield build prompt

Copy everything in the fenced block below into an implementation agent. Do not weaken security or mock requirements.

````markdown
# Build: Code Lens (v1 local demo)

Build a web app called **Code Lens**. A developer drops in source files, selects one file, enables analysis tasks, and runs real xAI Grok analysis. Optimize for a reliable local demo that is visual, impressive, and verifiable in under one minute. Prefer boring reliability over cleverness.

## Stack (mandatory)

- **Next.js** (App Router) + **TypeScript** + **Tailwind CSS** + **shadcn/ui**
- Syntax highlighting: `shiki` or `react-syntax-highlighter` (pick one; use consistently)
- Icons: `lucide-react`
- Single package at repo root; `npm run dev` starts the app
- Node 20+

Do not use a separate backend framework. Use one Next.js Route Handler for analysis.

## Project layout (suggested)

```
codelens/
  README.md
  package.json
  scripts/check-api-key.mjs
  app/
    layout.tsx
    page.tsx
    globals.css
    api/analyze/route.ts
  components/
    DropZone.tsx
    FileTree.tsx
    CodeViewer.tsx
    TaskToggles.tsx
    AnalyzeButton.tsx
    ResultsPanel.tsx
    SampleLoader.tsx
    CopyButton.tsx
    StatusBanner.tsx
  lib/
    grok.ts              # server-only
    parse-model-json.ts
    file-filters.ts
    samples.ts
    types.ts
    language.ts
  .env.example
```

Mark `lib/grok.ts` with server-only semantics (`import "server-only"` if available). **Never** import it from client components.

## Core UX

### Layout

Dark developer-tool aesthetic. Three panes on desktop:

1. **Left** — drop zone + file tree/list (selected file highlighted)
2. **Center** — code viewer with syntax highlighting for the selected file
3. **Right** — task toggles, Analyze button, results panels

Stack panes vertically on small screens. Empty, loading, success, API error, and JSON parse error states must all be obvious.

### Upload

- Drag-and-drop folder or file(s), plus file picker fallback
- Folder upload via `webkitdirectory` / directory input; also support multi-file selection
- Read files in the browser with the File API only — **no backend file storage**
- On upload, build an in-memory list: `{ id, path, name, language, content, size }`

### File filters and caps (enforce exactly)

**Allow extensions** (text/source only):  
`.js .jsx .ts .tsx .mjs .cjs .py .go .rs .java .kt .rb .php .cs .cpp .c .h .hpp .css .scss .html .json .md .yml .yaml .toml .sql .sh .bash .zsh .vue .svelte .txt`

**Skip:**

- Anything not in the allow list
- Empty files
- Files matching binary-ish names: `*.png *.jpg *.jpeg *.gif *.webp *.ico *.pdf *.zip *.gz *.woff *.woff2 *.ttf *.eot *.mp4 *.mp3 *.wasm *.exe *.dll`
- Paths containing `node_modules/`, `.git/`, `dist/`, `build/`, `.next/`

**Limits:**

- Max individual file: **200 KB**
- Max total payload kept in memory: **2 MB**
- Max files kept: **100**
- If a file is skipped or truncated, show a dismissible banner listing counts and reasons (e.g. "Skipped 12 files (binary/too large). Kept 8 files.")

### Language detection

Map extension → language id for highlighter + API (`javascript`, `typescript`, `python`, etc.). Unknown allowed text → `text`.

### File tree

- Show relative path
- Click selects file; highlight selection
- If user uploads a single file, auto-select it
- Clear selection control optional

### Code viewer

- Show selected file content with syntax highlighting
- Placeholder when nothing selected: "Select a file or load a sample"
- Monospace, scrollable, line-friendly

### Task toggles (chips or switches)

Default all **on**:

1. **Explain** — plain-English explanation
2. **Fix Bugs** — likely bugs + corrected code
3. **Generate Tests** — unit tests in an appropriate framework
4. **Suggest Improvements** — actionable refactors / quality / performance

At least one task must be enabled to run Analyze.

### Analyze button

- Enabled only when: a file is selected **and** ≥1 task enabled **and** not currently loading
- Label while running: "Analyzing…" with per-panel skeletons on the right
- Runs **only the selected file** (v1). Do **not** analyze the whole folder in v1.
- If user tries with no selection, show inline error: "Select a file to analyze"

### Results area

One clearly labeled panel per **enabled** task that returned data:

- **Explanation** — prose
- **Bug fixes** — summary, issue list, `fixed_code` in highlighted block + Copy
- **Tests** — framework label, test `code` highlighted + Copy
- **Improvements** — bullet list

Rules:

- Render only panels for keys present in parsed JSON
- If a requested task key is missing, show a soft per-task message: "No result returned for this task"
- Code blocks: syntax highlight + **Copy** button
- Never crash the page on bad model output

### Built-in samples (mandatory — use this exact source)

Three one-click samples. Loading a sample clears prior results, sets file tree to that single virtual file, selects it, and fills the viewer.

#### Sample 1 — `sum.js` (JavaScript, off-by-one)

```javascript
// Sum numbers from 1 to n (inclusive). Contains an off-by-one bug.
function sumToN(n) {
  let total = 0;
  for (let i = 1; i < n; i++) {
    total += i;
  }
  return total;
}

console.log(sumToN(5)); // expected 15, actual 10
```

#### Sample 2 — `average.py` (Python, empty-list edge case)

```python
# Return the average of a list of numbers.
# Bug: does not handle an empty list.
def average(nums):
    total = 0
    for n in nums:
        total += n
    return total / len(nums)


if __name__ == "__main__":
    print(average([10, 20, 30]))
    print(average([]))  # ZeroDivisionError
```

#### Sample 3 — `formatName.ts` (TypeScript, correct but refactorable / untested)

```typescript
// Format a person's display name. Correct, but verbose and untested.
export function formatName(
  first: string,
  middle: string | null | undefined,
  last: string
): string {
  let result = "";
  if (first !== undefined && first !== null) {
    result = result + first.trim();
  }
  if (middle !== undefined && middle !== null && middle.trim() !== "") {
    if (result.length > 0) {
      result = result + " ";
    }
    result = result + middle.trim();
  }
  if (last !== undefined && last !== null) {
    if (result.length > 0) {
      result = result + " ";
    }
    result = result + last.trim();
  }
  return result;
}
```

## API / security (non-negotiable)

### Environment

- Read key only from server env: `XAI_API_KEY`
- `.env.example` contains: `XAI_API_KEY=xai-...` (placeholder only)
- `.gitignore` must include `.env*` (except `.env.example`)

### Preflight key check

Add `scripts/check-api-key.mjs` that:

1. Loads env if needed (or relies on shell export)
2. If `process.env.XAI_API_KEY` is missing/empty, prints:

```
Missing XAI_API_KEY.

1. Generate a key at https://console.x.ai
2. Export it in this terminal:
   export XAI_API_KEY="xai-..."
3. Re-run npm run dev
```

3. Exits with code `1`

Wire scripts:

```json
{
  "scripts": {
    "predev": "node scripts/check-api-key.mjs",
    "dev": "next dev",
    "prestart": "node scripts/check-api-key.mjs",
    "start": "next start",
    "build": "next build"
  }
}
```

Do not start the dev/start server when the key is missing (`predev`/`prestart` failure is enough).

### Server helper `lib/grok.ts`

- `import "server-only"` when possible
- `callGrokAnalysis(params)`:
  - If key missing at runtime: throw a typed error with setup instructions (do not call network)
  - `POST https://api.x.ai/v1/responses`
  - Headers:
    - `Authorization: Bearer ${process.env.XAI_API_KEY}`
    - `Content-Type: application/json`
  - Body:
    - `model`: `"grok-4.5"`
    - `input`: string that includes language, filename, selected tasks, and full file source, plus instruction to return **strict JSON only** (no markdown fences, no prose) in the exact schema below
  - Timeout: **60s** (AbortController)
  - Parse response text:
    - Prefer `output_text` if present
    - Else extract and join `output[].content[]` entries where `type === "output_text"`
  - On non-2xx: throw error with **status code** + short safe message; never include API key or raw auth headers
  - Never log the API key

### Route Handler `POST /api/analyze`

**Request JSON:**

```ts
{
  filename: string;
  language: string;
  code: string;           // max 200_000 chars; reject if larger
  tasks: Array<"explain" | "fix_bugs" | "generate_tests" | "suggest_improvements">;
}
```

Validation:

- Reject empty `code` or empty `tasks` with 400
- Reject unknown task ids with 400
- Cap `code` length server-side even if client already capped

**Success response JSON:**

```ts
{
  ok: true;
  data: AnalysisResult;  // parsed object (may be partial)
}
```

**Error response JSON (never leak secrets):**

```ts
{
  ok: false;
  error: {
    code: "missing_api_key" | "bad_request" | "upstream_http" | "upstream_timeout" | "parse_error" | "unknown";
    message: string;       // safe for UI
    status?: number;       // upstream HTTP status when relevant
    rawText?: string;      // only for parse_error — model text for "Copy raw output"
  }
}
```

Browser calls **only** `/api/analyze`. Never call `api.x.ai` from the client. Never return `XAI_API_KEY` in any response body, header, or log line visible to the client.

### Model output schema (strict)

Ask the model for JSON only, keys only for requested tasks:

```json
{
  "explanation": "plain-English explanation of the code",
  "bug_fixes": {
    "summary": "short description of the bugs found",
    "issues": ["bug 1 plus why it is wrong", "bug 2 plus why it is wrong"],
    "fixed_code": "the corrected source code"
  },
  "tests": {
    "framework": "test framework used",
    "code": "the unit test source code"
  },
  "improvements": ["actionable improvement 1", "actionable improvement 2"]
}
```

Task → key mapping:

| Task id | JSON key |
|---|---|
| explain | explanation |
| fix_bugs | bug_fixes |
| generate_tests | tests |
| suggest_improvements | improvements |

### Response parsing ladder (`lib/parse-model-json.ts`)

1. `JSON.parse` full text
2. Strip markdown fences (``` or ```json) and parse again
3. Slice from first `{` to last `}` and parse again
4. If still failing: return parse error with `rawText` — UI shows error panel + **Copy raw output**. Do not crash.

Validate lightly after parse (object type; optional fields). Strip unknown top-level keys.

## UI states checklist

| State | Behavior |
|---|---|
| Empty | Drop zone + samples prominent; results placeholder |
| File selected | Viewer filled; Analyze enabled if tasks on |
| Loading | Button disabled; skeletons in enabled result panels |
| Success | Panels for returned keys; missing requested keys get soft message |
| API error | Banner/panel with safe message + status if any; setup text if missing key |
| Parse error | Panel with message + raw text (collapsible) + Copy raw output |
| Upload warnings | Banner for skipped/truncated files |

## README (required)

Include:

1. Prerequisites (Node 20+, xAI key)
2. `export XAI_API_KEY="xai-..."` from https://console.x.ai
3. `npm install` && `npm run dev`
4. Open the printed localhost URL
5. Demo path: load **sum.js** sample → leave all tasks on → Analyze → confirm four panels or error UI
6. Security note: key is server-only

## Acceptance tests (agent must perform)

After implementing:

1. With **no** `XAI_API_KEY`, `npm run dev` fails preflight with the setup message.
2. With key set, app starts; load Sample 1 (`sum.js`).
3. Enable all four tasks; click Analyze.
4. Confirm browser calls only `/api/analyze` (not `api.x.ai`).
5. Confirm either:
   - Parsed panels render for returned keys, code blocks highlighted with Copy, **or**
   - Non-crashing parse error with Copy raw output, **or**
   - Clear upstream error with status (no secrets).
6. Upload a tiny `.png` or huge file and confirm skip/limit messaging.
7. Confirm no `XAI_API_KEY` value appears in client bundle, HTML, or network response bodies (spot-check).

## Definition of done (v1)

- [ ] Three samples load and analyze path works end-to-end with real API
- [ ] Selected-file-only Analyze; no whole-repo path
- [ ] Server-only Grok helper + `/api/analyze`
- [ ] Preflight key check on dev/start
- [ ] Parse ladder + all UI states
- [ ] README demo instructions
- [ ] Filters/caps/skip messaging
````

---

## Phase 1+ — Product upgrades (after v1 green)

Implement in order. Each phase must keep v1 security invariants (server-only key, no mocks as success path).

### v1.1 — Streaming / progressive results (priority 1)

**Problem:** One monolithic wait feels slow.

**Design:**

- Prefer **parallel per-task server calls** (up to 4) from `/api/analyze` **or** split into `POST /api/analyze/task` and let the client fire enabled tasks in parallel.
- Simpler reliable approach for demo: client fires one request per enabled task in parallel to `POST /api/analyze` with `tasks: [single]`; each panel has its own loading/error/success state.
- Optional later: true HTTP streaming (SSE) of tokens — only if parallel panel loading is insufficient.

**UI:** Independent panel spinners; first panel can complete while others load.

**Failure modes:** Partial success (2/4 tasks OK) must still render successes; failed panels show individual errors. Do not fail the whole page.

**Validation:** Load sample → Analyze → panels populate at different times; killing one task type still shows others.

### v1.2 — Apply fix / download tests + diff (priority 2)

**Design:**

- On bug_fixes.fixed_code: buttons **Copy**, **Download fixed file** (same filename), **View diff** (side-by-side or unified vs original selected content using a small diff lib e.g. `diff` + simple render).
- On tests.code: **Copy**, **Download** as `*.test.*` / `test_*.py` based on language.
- Do not write to the user's real filesystem beyond browser download.

**Validation:** Sample 1 produces downloadable fixed JS; diff shows loop bound change.

### v1.3 — Analysis history (priority 3)

**Design:**

- Persist last **20** runs in `localStorage` key `codelens.history.v1`.
- Record: `{ id, timestamp, filename, language, tasks[], result | error, codeHash }` — store code only if &lt; 100KB else store hash + filename.
- UI: "History" drawer to re-open a past result (read-only) or re-run.
- Clear history control.

**Failure modes:** QuotaExceeded — drop oldest entries; never crash.

**Validation:** Run two samples; refresh page; history still lists both.

### v1.4 — Multi-file / repo summary (priority 4)

**Only after selected-file v1 is solid.**

**Design:**

1. User enables **Repo mode** toggle (off by default).
2. Caps: max **8** files, **400 KB** total code sent, prefer entrypoints (`main.*`, `index.*`, `app.*`, `src/**`) then by smaller size.
3. Two-step optional:
   - Call A: manifest summary (paths + one-line guesses) 
   - Call B: deep analysis on top 1–3 hotspots **or** single bundled prompt with clear `// FILE: path` separators
4. Results: **Repo summary** panel + optional per-file subpanels.
5. Still never send binaries; still server-only API.

**Failure modes:** Over cap → banner "Analyzing 8 of 40 files (size cap)"; user can pick files manually for inclusion.

**Validation:** Upload small multi-file folder; repo mode produces summary without timeout every time on happy path.

### v1.5 — GitHub import (priority 5)

**Design:**

- Input: public repo URL + optional path prefix.
- Server route `POST /api/github/import` uses GitHub REST API (no token required for public small trees; optional `GITHUB_TOKEN` for rate limits).
- Fetch tree, filter with same extension rules, download up to caps (files/size), return to client as virtual file list.
- Never expose tokens to client.

**Risks:** Rate limits, huge repos, private repos unsupported in v1.5 unless token present — show clear errors.

**Validation:** Import a tiny public repo path; file tree populates; analyze one file.

---

## Data flow (v1)

```
Browser File API / samples
  → in-memory FileEntry[]
  → user selects one file + tasks
  → POST /api/analyze { filename, language, code, tasks }
      → lib/grok.ts → api.x.ai/v1/responses (Bearer XAI_API_KEY)
      → extract output text
      → parse-model-json ladder
  → { ok, data | error }
  → Results panels / error UI
```

## Failure modes (cross-cutting)

| Failure | User-visible behavior |
|---|---|
| Missing `XAI_API_KEY` | Dev server won't start; if runtime missing, UI setup instructions + console.x.ai |
| Upstream 4xx/5xx | Status + safe message; retry CTA |
| Upstream timeout (60s) | Timeout message; retry |
| Non-JSON model output | Parse error panel + Copy raw |
| Partial JSON keys | Soft missing-task messages |
| Oversize upload | Skip/truncate banner; analyze still works on kept files |
| No file selected | Analyze disabled + hint |
| Network drop | Fetch error panel |

## Risks

- **Model schema drift:** Strict JSON instruction + parse ladder + raw fallback mitigates.
- **Token / cost blowups:** v1 single-file + 200KB cap; multi-file phase has stricter aggregate caps.
- **Key leakage:** server-only module, no key in responses, preflight script, client never imports grok helper.
- **Folder upload browser quirks:** `webkitdirectory` + multi-file picker fallback.
- **xAI response shape changes:** support both `output_text` and canonical `output[].content[]`.

## Implementation order for an agent

1. Scaffold Next.js + Tailwind + shadcn; dark layout shell (3 panes)
2. Types, samples, language map, file filters
3. Drop zone, file tree, code viewer, task toggles (client state only)
4. `scripts/check-api-key.mjs` + npm script wiring + `.env.example` + README
5. `lib/grok.ts` + `parse-model-json.ts` + `POST /api/analyze`
6. Wire Analyze + results panels + all error states + Copy buttons
7. Run acceptance tests with real key
8. Stop — do not start v1.1 until acceptance passes

## Validation plan (human or agent)

**v1 demo script (&lt; 1 minute):**

1. `export XAI_API_KEY=... && npm run dev`
2. Open app → click Sample 1
3. Analyze with all tasks
4. Confirm panels or graceful error
5. Spot-check Network tab: only same-origin `/api/analyze`

**v1.1+:** per-phase validation bullets above.

## Open questions

None material — stack, analyze scope, and upgrade order are decided. If xAI docs differ on response field names at implement time, follow live docs while keeping the dual extraction path (`output_text` + content array).
