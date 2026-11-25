# Research AI Web — Multi-Agent Research Lab & Visual AI Flow Map

> 🌐 **Language:** **English** | [한국어](README.ko.md) | [Tiếng Việt](README.vi.md)
>
> 📚 **Documentation:** [System Architecture](docs/ARCHITECTURE.md) · [Algorithms & Research References](docs/ALGORITHMS_AND_RESEARCH.md)
>
> 🔗 **Repository:** https://github.com/Khai-1711/research_ai_web · **Companion Bridge:** https://github.com/Khai-1711/dsh-gemini-bridge

**Research AI Web** is a local-first multi-perspective AI research workspace and real-time execution visualizer. It combines an adaptive **1 → N AI Research Lab** (`http://127.0.0.1:3000`), an independent **Visual AI Flow Map** (`http://127.0.0.1:3000/flow`), zero-API-key open academic retrieval (**arXiv**, **OpenAlex**, **Wikipedia**, automatic OA full-text PDF upgrade, 5-hop SSRF-guarded URL/PDF fetching, and local `.pdf` upload up to 15 MB), a deterministic **Citation & Quantitative Verifier (`app/verifier.py`)**, and pluggable AI providers: stateless ephemeral multi-account **DSH Gemini Bridge** (`acc1..accN`), **Gemini Official API**, and any **OpenAI-compatible API** (OpenAI, DeepSeek, Groq, Ollama, llama.cpp).

---

## Key Features

### 1. Adaptive Multi-Agent Research Lab (`/`)
- **1 → N AI Perspectives in One Room:** Automatically adapts UI density from 1-on-1 focused research to multi-agent councils (toggleable `Thẻ gọn` vs `Mở tất cả` cards, `#tag` group switches, `@role` / `@#tag` mentions, and batch progress strips).
- **Stateless Ephemeral Isolation & Cross-Account Judge (`X-DSH-Ephemeral` + `X-Exclude-Lanes`):** Every turn sends `X-DSH-Ephemeral: 1` so Bridge workers do not leak chat sessions, models, or handoff ledgers across perspectives/rooms, while Blind Judge automatically sends `X-Exclude-Lanes` to prefer an independent Google account that did not participate in the debate.
- **Per-AI Model, Role & Bridge Account Pinning:** Assign each AI its own `@handle`, role prompt, model (`gemini-neon`, `gemini-carbon`, `gemini-4-hydrogen`, or external API models), and optionally pin it to a specific Bridge worker (`acc1`, `acc2`, `acc3`, …) or let Gateway load-balance automatically.
- **Web-Based Profile Vault Login & Account Creation:** Manage accounts directly in **Settings** (`Đăng nhập 1 lần` → `Xong & Sync`, headless `Sync ngầm` / `Sync tất cả`, `+ Thêm acc` dynamic worker creation, inline friendly naming stored in `data/lane_names.json`, and 1-click role assignment).
- **Full-Text Deep Research & Local PDF Upload:**
  - Queries **arXiv**, **OpenAlex** (with inverted-index abstract reconstruction), and **Wikipedia** in parallel, then automatically upgrades up to 3 open-access candidates to **Full-Text PDF** excerpts (`pypdf`, up to 20 pages / `16,000` characters).
  - Supports uploading local `.pdf` research papers (`POST /api/research/upload-pdf`, up to **15 MB** / **25 pages**), fetching public URLs with per-hop SSRF validation (up to 5 redirects), or pasting text excerpts manually.
  - Labels every source honestly with `contentLevel`: **`Toàn văn`** (`full_text`), **`Chỉ Tóm tắt`** (`abstract_only`), or **`Trích đoạn`** (`excerpt`).
- **Direct Evidence `[S#]` vs. Inference `[Suy luận từ S#]` & Deterministic Verifier (`app/verifier.py`):**
  - System prompts strictly separate verbatim/factual source claims (`[S#]`) from AI-computed extrapolations (`[Suy luận từ S#]`).
  - Every response is deterministically audited for hallucinated source IDs, abstract-only citations, and quantitative numeric claims (`%`, decimals, sample sizes `n=...`), surfacing **Kiểm chứng tự động** cards in the chat feed and feeding an objective audit report to Blind Judge.
- **Rich Academic Markdown & Blind Judge Synthesis:** Full GFM Markdown rendering (tables, headings, blockquotes, code blocks, clickable citation pills), bidirectional anonymization (`Ứng viên A/B/C…`), 3-axis Rubric scoring (`Evidence` / `Logic` / `Rebuttal`), **Living Outline**, and 5-section Markdown report export.
- **Liveness-First Deep Research Streaming (`X-DSH-Research-Mode: 1` + SSE Heartbeat):** Research turns lift the 180s wall-clock cap and avoid automatic 50s smart-model downgrades (`gemini-carbon` / `gemini-neon` stays active), streaming live progress (`queued_lock` → `waiting_gemini` → `thinking` → `generating`) and keep-alive heartbeats end-to-end.
- **GitHub Pages Sharing to Local Backend (`share-pages`):** Deploy the static frontend on GitHub Pages while letting 1–2 trusted friends connect straight to your local backend over an HTTPS tunnel (`python start.py share`) with no login required (optional `WEBCHAT_SHARE_TOKEN` in `.env`) and host-admin controls locked remotely.

### 2. Independent Visual AI Flow Map (`/flow`)
- **Zero-Coupling Live Visualization:** Shares zero DOM/state with the Chat surface; subscribes exclusively via Server-Sent Events (`/api/rooms/{id}/events`) to the same append-only `events.jsonl` log.
- **Stage Graph & Convergence Bus:** Renders execution stages left-to-right (`Input → N AI Council → Judge → Output`), switching smoothly from individual Bezier curves (1–4 AIs) to a vertical **Convergence Bus** (5+ AIs) with upstream/downstream lineage highlighting.
- **Swimlane Timeline & Step Replay:** Inspect parallel execution across `acc1..accN` on a Gantt timeline, replay events step-by-step, and inspect raw prompts in the right drawer.

---

## Step-by-Step Web Interface User Guide

### Step 1 — Connect AI Accounts & Workers (`⚙️ Cài đặt`)
1. Open `http://127.0.0.1:3000` in your browser.
2. Click the **Settings (gear icon)** in the top-right bar to configure providers and Bridge accounts:
   - Under **Nguồn AI đã kết nối → Từng tài khoản Bridge**, click **Đăng nhập 1 lần** on `acc1`, complete Google/Gemini login in the opened browser window, then click **Xong & Sync**.
   - Click **Thêm acc** to spawn additional `.env.accN` workers (`acc2`, `acc3`, …) for separate Google accounts; on subsequent runs use **Sync ngầm** or **Sync tất cả** (~3–5s headless cookie refresh).
   - Use **Tên** to give accounts memorable names, **Test** to verify live generation, or **Gán vai** to add that lane directly as a room perspective.
   - Or click **Thêm AI** to plug in a **Gemini API Key** or **OpenAI-compatible** endpoint (OpenAI, DeepSeek, Groq, Ollama, etc.).
3. Adjust **maxConcurrency** in Settings to match your healthy worker count when running parallel councils.

### Step 2 — Organize Rooms & AI Council Roles
1. Toggle the left drawer (top-left button or `[` key) to switch rooms, rename/delete rooms, or create a new room from a preset.
2. Edit AI perspectives via the roster tab or by clicking chips on the **Phân công AI:** strip above the chat feed:
   - Customize `@handle`, role prompt, model (`gemini-carbon` for complex coding/deep analysis, `gemini-neon` for deep analytical work, `gemini-4-hydrogen` for fast turns), `#tags`, and optional **pinned Bridge account** (`acc1`, `acc2`, … or auto load-balance).
   - Choose the **Judge (Trọng tài)** model and optional lane on the right side of the role strip (`Acc: Tự động` automatically avoids lanes used by debaters via `X-Exclude-Lanes` whenever healthy alternatives exist).

### Step 3 — Ingest Sources & Academic Evidence (`]`)
Toggle the right **Kho nguồn (`Nguồn (N)`)** drawer (`]` key) to monitor `[S1]..[Sk]` evidence. There are 3 ways to populate sources:
1. **Automated Deep Research:** Type your topic/question and click **Deep Research**. The backend searches arXiv, OpenAlex, and Wikipedia concurrently and upgrades top open-access papers to **Full-Text PDF** excerpts automatically.
2. **Upload Local `.pdf` Files / Attach URLs or Notes:**
   - Click **URL / Tài liệu** above the composer box.
   - Choose **Chọn file PDF (.pdf) trên máy…** (up to **15 MB**, up to **25 pages** extracted via `pypdf`), **or** paste an article/arXiv/PDF URL, **or** paste text excerpts manually, then click **Thêm vào Kho nguồn**.
3. **Inspect Evidence Depth:** Check the source level pill beside each `[S#]` card: **`Toàn văn`** (full text extracted), **`Chỉ Tóm tắt`** (abstract only), or **`Trích đoạn`** (excerpt).

### Step 4 — Run Perspectives, Debate & Judge Synthesis
1. Keep **Tài liệu Chuyên sâu** active above the composer for long multi-round research (preserves up to `16,000` chars per research dossier and `60,000` chars conversation context; switch to **Chế độ Súc tích** for short answers).
2. Run either **1-click end-to-end** or **manual step-by-step**:
   - **1-Click Pipeline (`Chạy trọn quy trình`):** Automatically executes Deep Research → independent perspectives → cross-debate → Blind Judge synthesis.
   - **Step-by-Step Control:**
     - Type a prompt and press `Enter` / **Gửi** (optionally tag `@handle` or `@#tag` with autocomplete to target specific perspectives).
     - Click **Tự tranh luận vòng tiếp** so active perspectives cross-examine each other's prior-round arguments and numbers.
     - Click **Trọng tài chốt** to generate the anonymized Rubric, Living Outline, and Executive Summary.
   - Click **Dừng** on any active progress card to abort in-flight requests immediately.

### Step 5 — Verify Evidence & Explore the Flow Map (`/flow`)
- **Inline Source Verification:** Click any `[S#]` citation badge to highlight the backing source in the right drawer; distinguish **`[S#]`** (direct factual claim in source) from **`[Suy luận · S#]`** (derived/synthesized reasoning), and check the **Kiểm chứng tự động** box below each AI message (`Số liệu khớp: X/Y`).
- **Top View Tabs:** Switch between **Phòng chat**, **So sánh** (2–4 perspectives side-by-side with optional **Ẩn danh** blind toggle), **Báo cáo** (5-section report + **Tải Báo cáo (.md)**), and **Kiểm chứng** (raw prompts per turn, Fallback warnings, and **Tải events.jsonl gốc**).
- **Visual Flow Map (`Flow Map` button → `/flow`):** Observe live stage DAG graphs, inspect per-account Gantt timelines (**Làn thời gian**), or replay execution step-by-step.

---

## Repository Structure

```text
research_ai_web/
├── app/                         # Python FastAPI Backend (:3000) — 10 single-responsibility modules
│   ├── main.py                  # FastAPI factory, /api/* mounting & dist/ SPA serving
│   ├── config.py                # Typed Settings loaded from .env
│   ├── bridge.py                # Stateless BridgeClient (X-DSH-Ephemeral: 1), retry/backoff & JSON repair
│   ├── providers.py             # ProviderStore (Bridge / Gemini API / OpenAI-compat) & LaneNameStore
│   ├── research.py              # Concurrent arXiv/OpenAlex/Wikipedia search, OA PDF full-text upgrade & SSRF shield
│   ├── verifier.py              # Pure-Python verifier for [S#] vs [Suy luận từ S#] and quantitative numeric claims
│   ├── prompts.py               # Multi-round history compression (60,000-char deep budget) & citation rules
│   ├── judge.py                 # Blind Judge alias masking, Rubric synthesis & cross-account X-Exclude-Lanes routing
│   ├── routes.py                # Thin REST/SSE router (/api/*, /api/research/upload-pdf) + compat re-exports
│   └── storage.py               # Atomic disk storage (meta.json, sources.json, events.jsonl) & SSE pub/sub
├── src/                         # React 19 + TypeScript + Tailwind v4 Frontend
│   ├── App.tsx                  # Dual-surface router (/ and /flow) + cross-tab theme sync
│   ├── lab/                     # Research Lab UI (ResearchLabApp, GroupFeed, MarkdownText, Composer, Drawers, SecondaryViews)
│   ├── flow/                    # Independent Flow Map UI (FlowMapApp, FlowCanvasSvg, SwimlaneView)
│   ├── utils/                   # API client, theme/export utilities, lane formatting
│   ├── presets.ts               # Starter 1-AI and 2-AI room templates
│   └── types.ts                 # Shared TypeScript interfaces
├── tests/
│   └── test_backend.py          # 27 integration & unit tests (pytest)
├── docs/
│   ├── ARCHITECTURE.md / .ko.md / .vi.md
│   └── ALGORITHMS_AND_RESEARCH.md / .ko.md / .vi.md
├── public/assets/aistudio/      # Original UI/UX & Flow Map specification PDFs
├── requirements.txt             # Python dependencies (including pypdf)
├── package.json                 # React + Vite + TypeScript dependencies
├── .env.example                 # Environment template
├── README.md                    # English overview (this file)
├── README.ko.md                 # Korean overview (한국어)
└── README.vi.md                 # Vietnamese overview (Tiếng Việt)
```

---

## Quick Start

### Prerequisites
- **Python 3.12+**
- **Node.js 22+** (Vite 8 requires Node 22+ to build the React frontend)
- **AI Backend (either or both):**
  - Companion multi-account **DSH Gemini Bridge** ([Khai-1711/dsh-gemini-bridge](https://github.com/Khai-1711/dsh-gemini-bridge)) running on `http://127.0.0.1:10000`, **and/or**
  - Any **Gemini API Key** or **OpenAI-compatible endpoint** added in **Settings**.

### 1. Install Dependencies & Build Frontend (inside `webchat/`)
```bash
python -m venv .venv
# Windows PowerShell:
.\.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

pip install -r requirements.txt
npm install
npm run build
```

### 2. Configure Environment & Run
```bash
cp .env.example .env
python -m app.main
```
*(If using the parent workspace orchestrator `start.py` alongside `bridge/`, run `python start.py` to launch Gateway, `acc1..N`, and WebChat together.)*

Open in your browser:
- **Research Lab:** `http://127.0.0.1:3000`
- **Visual AI Flow Map:** `http://127.0.0.1:3000/flow`

### 3. Run Automated Tests & Typecheck
```bash
pytest -v
npx tsc --noEmit
```

### 4. Share via GitHub Pages (`share-pages` branch)
1. Push the `share-pages` branch to GitHub; [deploy-pages.yml](.github/workflows/deploy-pages.yml) builds `dist/` with relative asset paths (`base: './'`) to `https://khai-1711.github.io/research_ai_web/`.
2. Run one command from the workspace root to start Bridge, WebChat (`:3000`), and the HTTPS tunnel together:
   ```bash
   python start.py share
   ```
   *(Requires `cloudflared`; prints a direct invite URL `https://khai-1711.github.io/research_ai_web/?api=<https-tunnel>` with no login required — optionally set `WEBCHAT_SHARE_TOKEN=...` in `webchat/.env` if you ever want an extra token.)*
3. Press `Ctrl+C` or close the terminal to shut down the tunnel when finished.

---

## Security & Privacy

- **Local-First Secret Isolation:** Runtime room histories (`data/rooms/`), user API keys (`data/providers.json`), custom account names (`data/lane_names.json`), `.share_token`, and `.env` files are excluded via `.gitignore`. API keys are masked (`AIza...9x2Q`) in every API response.
- **Host-Admin Lockdown (`app/main.py`):** Distinguishes direct local loopback requests from proxied/tunnel requests (`Cf-Connecting-Ip`, `X-Forwarded-For`, external `Origin`): host-only machine endpoints (browser cookie login, worker creation, provider key creation/deletion, `/api/share-info`) strictly return `403` for remote callers; if `WEBCHAT_SHARE_TOKEN` is optionally set in `.env`, unauthenticated remote calls return `401`.
- **Stateless Bridge Isolation (`X-DSH-Ephemeral: 1`):** Research requests instruct Bridge workers never to read or mutate persistent chat sessions, model defaults, transcripts, or coding handoff ledgers.
- **Multi-Hop SSRF Defense (`app/research.py`):** Rejects non-HTTP(S) schemes, private/loopback/link-local IPs, and `.local`/`.internal` hostnames before DNS resolution and on every HTTP `Location` redirect hop (up to 5 hops).
- **Safe Local PDF Ingestion:** `/api/research/upload-pdf` enforces a strict **15 MB** cap and `%PDF-` signature validation, returning clean `400`/`413` errors on invalid or image-only PDFs.
- **Loopback-Only Pinned Routing:** Direct worker URLs resolved via `/v1/lanes` enforce loopback hosts (`127.0.0.1` / `localhost` / `::1`) and fail closed (`HTTP 502`) when a pinned account is disabled or unreachable.

---

## Verified Test Coverage (`tests/test_backend.py`)

`pytest -v` — **31/31 passed**:
- **Bridge, Routing, Ephemeral & Research Liveness:** stateless prompt compilation, gateway worker/guest status, single-user turns + `429` retry, custom lane naming + fail-closed pinned routing, `X-DSH-Ephemeral: 1` + `X-Exclude-Lanes`, SSE liveness parsing (`: dsh-status`, `: keep-alive`, kept model) and `/api/ai/perspective` SSE streaming.
- **Remote Tunnel Security Middleware:** `401` + CORS rejection without token via proxy headers, `X-Share-Token` / `share_token` auth, `isLocalOwner` flags, and strict `403` host-admin lock vs direct local owner access.
- **Profile Vault Proxying:** merging vault health + duplicate-account detection, origin/payload forwarding on login/sync endpoints, fail-closed `502` propagation.
- **Deep Context & Multi-Round History:** Round 0 history omission, Round 1 full peer context, `60,000`-char deep history preservation & older-turn compression, research dossier preservation.
- **Blind Judge & Resilient JSON:** fenced/malformed JSON recovery, source excerpts + verification report injection, fallback score flagging, bidirectional anonymization/unmasking.
- **Academic Search, PDF Ingestion, SSRF & Verifier:** loopback/private IP blocking, multi-hop redirect SSRF blocking, academic query normalization, open-access arXiv full-text PDF upgrade, local PDF upload extraction + invalid-byte rejection, deterministic fabricated-number and inference detection (`verifier.py`, including Markdown table cell boundaries).
- **Storage & Providers:** room CRUD + append-only `events.jsonl`, secret masking + live model discovery, clean empty-room initialization.
