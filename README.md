# Research AI Web — Multi-Agent Research Lab & Visual AI Flow Map

> 🌐 **Language:** **English** | [한국어](README.ko.md) | [Tiếng Việt](README.vi.md)
>
> 📚 **Documentation:** [System Architecture](docs/ARCHITECTURE.md) · [Algorithms & Research References](docs/ALGORITHMS_AND_RESEARCH.md)
>
> 🔗 **Repository:** https://github.com/Khai-1711/research_ai_web · **Companion Bridge:** https://github.com/Khai-1711/dsh-gemini-bridge

**Research AI Web** is a local-first, multi-perspective AI research workspace and real-time execution visualizer. It combines an adaptive **1 → N AI Research Lab** (`http://127.0.0.1:3000`), an independent **Visual AI Flow Map** (`http://127.0.0.1:3000/flow`), zero-API-key open academic retrieval (**arXiv**, **OpenAlex**, **Wikipedia**, and public URL/PDF extraction with SSRF defense), and pluggable AI providers: local multi-account **DSH Gemini Bridge** (`acc1..accN`), **Gemini Official API**, and any **OpenAI-compatible API** (OpenAI, DeepSeek, Groq, Ollama, llama.cpp).

---

## Key Features

### 1. Adaptive Multi-Agent Research Lab (`/`)
- **1 → N AI Perspectives in One Room:** Scales automatically from focused 1-on-1 research (full prose view) to multi-agent councils (compact 2-line conclusion cards, `#tag` group toggles, `@role` / `@#tag` mentions, and batch progress bars).
- **Per-AI Model, Role & Bridge Account Pinning:** Assign each AI its own `@handle`, role prompt, model (`gemini-neon`, `gemini-carbon`, `gemini-4-hydrogen`, or any connected API model), and optionally pin it directly to a specific local Bridge worker (`acc1`, `acc2`, `acc3`, …) or leave it on automatic Gateway load-balancing.
- **Custom Naming Everywhere:** Rename individual Bridge accounts (`acc1..accN` stored in `data/lane_names.json`), AI `@handle`/roles, and research rooms inline.
- **Multi-Round Cross-Examination & Blind Judge:** Independent Round 0 answers → cross-debate rounds → **Blind LLM-as-a-Judge** synthesis (anonymizing roles as `Candidate A/B/C`) generating a dynamic Rubric table, **Living Outline** (Consensus / Contradictions / Knowledge Gaps), and a 5-section exportable Markdown report.
- **Zero-Key Academic Deep Research:** Parallel retrieval across **arXiv**, **OpenAlex**, and **Wikipedia**, plus public URL/PDF ingestion (`pypdf`), stored as verifiable `[S1]..[Sk]` citations with deterministic **Citation Verification** and Audit Trail (`events.jsonl`).
- **Dual Editorial Theme:** Warm *Research Notebook* Light Mode (`#F7F5F0` / `#1F6F63`) and *Nocturnal Oddity* Dark Mode (`#100D16` / `#C2F542`) synchronized across browser tabs.

### 2. Independent Visual AI Flow Map (`/flow`)
- **Zero-Coupling Live Visualization:** Subscribes exclusively via Server-Sent Events (`/api/rooms/{id}/events`) to the same append-only `events.jsonl` truth log as the chat surface.
- **Stage Graph & Convergence Bus:** Renders stages left-to-right (`Input → N AI Council → Judge → Output`), switching smoothly from individual Bezier curves (1–4 AIs) to a vertical **Convergence Bus** (5+ AIs) with hover-based upstream/downstream path highlighting.
- **Swimlane Timeline & Step Replay:** Inspect per-worker concurrency (`acc1..accN`) on a Gantt timeline, replay execution step-by-step, and inspect raw prompts/payloads in a non-overlapping side drawer.

---

## Repository Structure

```text
research_ai_web/
├── app/                         # Python FastAPI Backend (:3000)
│   ├── main.py                  # FastAPI entry point, API mounting & SPA serving
│   ├── config.py                # Typed Settings loaded from .env
│   ├── bridge.py                # Stateless BridgeClient, retry/backoff, direct pinned-lane routing & JSON repair
│   ├── providers.py             # ProviderStore (Bridge / Gemini API / OpenAI-compat) & LaneNameStore
│   ├── research.py              # Parallel arXiv / OpenAlex / Wikipedia search + SSRF-guarded URL/PDF fetcher
│   ├── routes.py                # REST & SSE API, perspective orchestration, Blind Judge & citation verifier
│   └── storage.py               # Atomic disk storage (meta.json, sources.json, append-only events.jsonl) & SSE pub/sub
├── src/                         # React 19 + TypeScript + Tailwind v4 Frontend
│   ├── App.tsx                  # Dual-surface router (/ and /flow) + cross-tab theme sync
│   ├── lab/                     # Research Lab UI (ResearchLabApp, GroupFeed, Composer, Left/Right/Settings drawers, Compare/Report/Audit)
│   ├── flow/                    # Independent Flow Map UI (FlowMapApp, FlowCanvasSvg, SwimlaneView)
│   ├── utils/                   # API client, theme/export utilities, lane formatting
│   ├── presets.ts               # Starter 1-AI and 2-AI room templates
│   └── types.ts                 # Shared TypeScript interfaces
├── tests/
│   └── test_backend.py          # 10 integration & security tests (pytest)
├── docs/
│   ├── ARCHITECTURE.md          # System architecture & data flows (EN)
│   ├── ARCHITECTURE.ko.md       # System architecture & data flows (KO)
│   ├── ARCHITECTURE.vi.md       # System architecture & data flows (VI)
│   ├── ALGORITHMS_AND_RESEARCH.md     # Algorithms & academic references (EN)
│   ├── ALGORITHMS_AND_RESEARCH.ko.md  # Algorithms & academic references (KO)
│   └── ALGORITHMS_AND_RESEARCH.vi.md  # Algorithms & academic references (VI)
├── public/assets/aistudio/      # Original UI/UX & Flow Map specification PDFs
├── requirements.txt             # Python dependencies
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
- **Node.js 22+** (to build the React frontend)
- **AI Backend (either or both):**
  - Companion multi-account **DSH Gemini Bridge** ([Khai-1711/dsh-gemini-bridge](https://github.com/Khai-1711/dsh-gemini-bridge)) running on `http://127.0.0.1:10000`, **and/or**
  - Any **Gemini API Key** or **OpenAI-compatible endpoint** (OpenAI, DeepSeek, Groq, Ollama, llama.cpp) added directly in the **Settings** drawer.

### 1. Install Python & Frontend Dependencies
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

Open in your browser:
- **Research Lab:** `http://127.0.0.1:3000`
- **Visual AI Flow Map:** `http://127.0.0.1:3000/flow`

### 3. Run Automated Tests & Typecheck
```bash
pytest -v
npx tsc --noEmit
```

---

## Security & Privacy

- **Local-First Secret Isolation:** Runtime room histories (`data/rooms/`), user provider API keys (`data/providers.json`), custom account names (`data/lane_names.json`), and `.env` files are excluded via `.gitignore`. All stored API keys are masked (`AIza...9x2Q`) before leaving the backend.
- **Two-Stage SSRF Defense:** User-supplied URLs in Deep Research are validated against loopback, private, and link-local IP ranges both before DNS resolution and on HTTP `Location` redirects (`app/research.py`).
- **Loopback-Only Pinned Routing:** Direct worker URLs resolved via `/v1/lanes` strictly enforce loopback hosts (`127.0.0.1` / `localhost` / `::1`) and fail closed (`HTTP 502`) when a pinned account is disabled or unreachable.

---

## Verified Test Coverage (`tests/test_backend.py`)

`pytest -v` — **10/10 passed**:
1. Stateless system+user prompt compilation (`test_compile_stateless_merges_system_into_user_prompt`)
2. Resilient JSON extraction & repair (`test_resilient_json_parses_fenced_and_trailing_comma`)
3. SSRF blocking of loopback/private/file URLs (`test_ssrf_blocks_loopback_and_private_ips`)
4. Gateway worker counting & Guest Mode detection (`test_health_accurately_counts_workers_and_detects_guest_mode`)
5. Single-user turn, `X-Gateway-Lane` propagation & `429` retry (`test_perspective_uses_single_user_message_reads_gateway_lane_and_retries_429`)
6. Blind Judge alias unmasking & malformed JSON recovery (`test_synthesize_handles_malformed_json_and_unmasks_aliases`)
7. Room CRUD & append-only `events.jsonl` export (`test_room_crud_and_flow_events_jsonl`)
8. Provider API key masking & live model discovery (`test_providers_mask_secrets_and_models_discovery`)
9. Clean empty-room startup without static examples (`test_empty_storage_creates_single_clean_room_without_examples`)
10. Custom lane naming (`PATCH /api/lanes/{id}`) & direct fail-closed pinned-lane routing (`test_lane_rename_and_pinned_lane_direct_routing`)
