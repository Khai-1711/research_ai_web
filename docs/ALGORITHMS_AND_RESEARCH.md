# Algorithms & Research References — Research AI Web

> 🌐 **Language:** **English** | [한국어](ALGORITHMS_AND_RESEARCH.ko.md) | [Tiếng Việt](ALGORITHMS_AND_RESEARCH.vi.md)
>
> 📚 **Related Docs:** [README](../README.md) · [System Architecture](ARCHITECTURE.md)

This document catalogs every algorithm actually implemented in **Research AI Web** (with exact source locations and complexities) alongside the verified academic papers, technical standards, and UI/UX benchmarks that guided the system's design.

---

## Part 1: Implemented Algorithms

### 1.1. Multi-Agent Debate & Bounded Concurrency Scheduling
- **Bounded Async Worker Pool (`src/lab/ResearchLabApp.tsx:runPerspectivesBatch`)**
  - Spawns `min(maxConcurrency, targets.length)` concurrent async workers pulling from a shared perspective queue, paired with an `AbortController` so clicking **Stop** cancels in-flight HTTP calls immediately and logs a `run_aborted` event.
  - Enforces **Round-Scoped Visibility**: Round 0 runs each perspective independently (`peerMessages = undefined`), while cross-debate rounds pass prior-round outputs explicitly so perspectives rebut each other without context leakage.
- **Stateless Single-User Prompt Compilation (`app/bridge.py:compile_stateless_user_prompt`)**
  - Compiles system role instructions, source context `[S1]..[Sk]`, peer arguments, and user query into a single `role: "user"` payload (`stream=False`), preventing Gemini Web from silently dropping `role: "system"` messages.

### 1.2. Gateway Routing, Session Affinity & Failover
- **Deterministic Session Keying (`bridge/app/session_pool.py:compute_session_key`)**
  - Extracts explicit session IDs or hashes `agent_name + "\0" + normalized_first_user_prompt` with `SHA-256` (16-hex prefix) to isolate concurrent sessions across up to `16` worker `SessionSlot` instances (`SESSION_POOL_TTL = 3600s`).
- **Multi-Key Lexicographic Least-Inflight Selection (`bridge/app/gateway_router.py:reserve_lane`)**
  - Evaluates healthy workers with an explicit priority tuple:
    $$\text{rank}(\text{lane}) = \big(\max(\text{inflight}_{\text{worker}}, \text{inflight}_{\text{gw}}),\; \text{role\_penalty},\; \text{sticky\_count},\; \text{index}\big)$$
  - Maintains sticky bindings (`STICKY_TTL = 3600s`, `MAX_STICKY_SESSIONS = 128`) with oldest-entry eviction; spreads subagents away from the primary lead worker when loads tie.
- **Cooldown Circuit Breaker & Exponential Backoff (`bridge/app/gateway_router.py:mark_cooldown`, `app/bridge.py:chat_stateless`)**
  - Gateway puts workers returning `{429, 503}` or `ConnectError` into a `15s` cooldown and fails over to another healthy peer.
  - WebChat retries `{408, 429, 500, 502, 503, 504}` using capped exponential backoff ($\min(20\text{s},\, 3 \cdot 2^{\text{attempt}})$) while respecting `Retry-After` headers (clamped to `[0, 60]` seconds).
- **Direct Fail-Closed Pinned-Lane Resolution (`app/bridge.py:resolve_lane_url`)**
  - When a perspective or Judge sets `pinnedLaneId` (e.g., `acc2`), WebChat resolves its loopback URL from Gateway `/v1/lanes`, validates `_is_loopback_url()`, and dispatches directly to that worker—raising `HTTP 502` if the lane is disabled/unreachable instead of silently running on another account.

### 1.3. Blind LLM-as-a-Judge & Resilient JSON Recovery
- **Bijective Identity Masking (`app/routes.py:run_synthesize`)**
  - Builds a bidirectional alias table (`@handle ↔ Candidate A/B/C…`) before sending transcripts to the Judge model, reducing name/brand bias, then deterministically unmasks `rubric`, `consensus.supporters`, and `perspectiveBreakdown` back to real handles.
  - Computes 3-axis Rubric averages: `total = round((evidence + logic + rebuttal) / 3.0, 1)` and sorts descending.
- **String-Aware Balanced-Brace JSON Extraction (`app/bridge.py:parse_resilient_json`)**
  - Strips Markdown code fences if present, runs an $O(N)$ brace-depth state machine that respects quoted strings and backslash escapes to isolate the outermost `{...}` object, tries strict `json.loads`, and falls back to `json_repair.repair_json` for trailing commas or minor syntax faults.

### 1.4. Open Academic Retrieval, Citation Verification & SSRF Guard
- **Concurrent 3-Source Academic Fan-Out (`app/research.py:search_open_academic_sources`)**
  - Runs `asyncio.gather` across arXiv Atom XML API, OpenAlex Works REST API, and Wikipedia Search API concurrently, normalizing results into verified `[S1]..[Sk]` items.
- **OpenAlex Inverted-Index Reconstruction (`app/research.py:_search_openalex`)**
  - Reconstructs human-readable abstracts from OpenAlex's compressed `{word: [positions...]}` inverted index in $O(W)$ time by scattering tokens into a bounded array (capped at 400 positions).
- **Deterministic Citation Whitelisting (`app/routes.py:extract_cited_sources`, `src/lab/SecondaryViews.tsx:citationStats`)**
  - Extracts `[S\d+]` tokens via regex and intersects them strictly against the room's verified `sources.json` ID set, filtering out fabricated citations (e.g., `[S99]`) and counting valid vs. unmatched citations in the Report view.
- **Two-Stage DNS & Redirect SSRF Shield (`app/research.py:is_safe_public_url`, `fetch_url_as_source`)**
  - Validates scheme (`http`/`https`), blocks private/loopback/link-local IP literals and `.local`/`.internal` suffixes, resolves all DNS `getaddrinfo` records to verify every returned IP is globally routable, disables implicit redirects (`follow_redirects=False`), and re-validates `Location` before fetching (5 MB byte cap).

### 1.5. Visual AI Flow Map Graph Layout & Path Highlighting
- **Event-Sourced Incremental DAG Folding (`src/flow/FlowCanvasSvg.tsx:buildGraphFromEvents`)**
  - Folds append-only `FlowEvent[]` (`run_started`, `node_started`, `node_warning`, `node_completed`, `node_failed`) into a typed graph $(V, E)$ partitioned by `stageIndex`, automatically injecting dimmed `disabled` nodes for turned-off perspectives so users see who was excluded.
- **Adaptive Stage Layout & Convergence Bus (`src/flow/FlowCanvasSvg.tsx:stagePairMetrics`, `buildEdgePath`)**
  - Dynamically switches card geometry (`compactMode` when any stage has $\ge 5$ nodes).
  - Routes edges between consecutive stages using individual cubic Bezier curves at low fan-in/fan-out, and automatically switches to a shared vertical **Convergence Bus** (`busX`) for dense $N \to 1$ or $N \times N$ transitions to prevent edge clutter.
- **Bidirectional Upstream/Downstream DFS (`src/flow/FlowCanvasSvg.tsx:focusSet`)**
  - On node hover or selection, executes two iterative stack-based DFS traversals ($O(|V| + |E|)$) along incoming (`up`) and outgoing (`down`) edges to highlight the complete causal lineage while dimming unrelated branches.

### 1.6. Bridge Reliability & Safe Parsing
- **Linear $O(N)$ Non-Regex Tag Scanner & Fail-Closed Batch Validator (`bridge/app/tool_parser.py`)**
  - Uses `str.find()` linear scanning (immune to ReDoS catastrophic backtracking) to extract `<tool_call>...</tool_call>` blocks, normalizes parameter aliases, enforces schema types and path boundaries, and rejects the entire batch if any single tag is malformed.
- **Non-Reentrant `init()` Deadlock Guard (`bridge/app/gemini_session.py:GeminiClient`)**
  - Intercepts auth redirects (`boq_identityfrontendauthuiserver`) before RPC execution and forces `current_retry=0, close_on_error=False` while `self._in_init` is true, preventing recursive lock re-acquisition on `self._lock`.
- **Atomic File Writes (`app/storage.py:_atomic_write_json`, `providers.py`, `bridge/app/routes_admin.py`)**
  - Writes JSON/env updates to a same-directory temporary file, flushes to disk, and swaps atomically via `os.replace` to prevent partial/corrupted files on crash.

---

## Part 2: Academic Papers & Technical References

Every reference below was verified directly against official venues/arXiv/W3C records and maps to concrete mechanisms built into this project.

### A. Multi-Agent Debate & Multi-Perspective Research

| # | Paper / Reference | Venue & Link | How It Informed Research AI Web |
| :---: | :--- | :--- | :--- |
| 1 | **Yilun Du, Shuang Li, Antonio Torralba, Joshua B. Tenenbaum, Igor Mordatch** — *Improving Factuality and Reasoning in Language Models through Multiagent Debate* | ICML 2024 (arXiv May 2023) · [arXiv:2305.14325](https://arxiv.org/abs/2305.14325) | Core theoretical basis for running multi-round independent answers (Round 0) followed by peer cross-examination rounds, showing factual/reasoning gains even when sharing the same underlying model family. |
| 2 | **Tian Liang et al.** — *Encouraging Divergent Thinking in Large Language Models through Multi-Agent Debate* | EMNLP 2024 (arXiv May 2023) · [arXiv:2305.19118](https://arxiv.org/abs/2305.19118) · [ACL Anthology](https://aclanthology.org/2024.emnlp-main.992/) | Motivated distinct adversarial personas (`@Nghiên_cứu` vs. `@Phản_biện`) and an external Judge to counter the *Degeneration-of-Thought (DoT)* failure mode of single-model self-reflection. |
| 3 | **Yijia Shao, Yucheng Jiang, Theodore A. Kanell, Peter Xu, Omar Khattab, Monica S. Lam** — *Assisting in Writing Wikipedia-like Articles From Scratch with Large Language Models (STORM)* | NAACL 2024 · [arXiv:2402.14207](https://arxiv.org/abs/2402.14207) | Inspired perspective-driven research templates and structured outline curation prior to final report synthesis. |
| 4 | **Yucheng Jiang, Yijia Shao, Dekun Ma, Sina J. Semnani, Monica S. Lam** — *Into the Unknown Unknowns: Engaged Human Learning through Participation in Language Model Agent Conversations (Co-STORM)* | EMNLP 2024 · [arXiv:2408.15232](https://arxiv.org/abs/2408.15232) | Directly inspired the human-in-the-loop multi-agent group chat UX (`@role` / `@#tag` steering) paired with a dynamically updated **Living Outline** (Consensus / Contradictions / Knowledge Gaps). |

### B. Evaluation, Grounded Retrieval & Citation Verification

| # | Paper / Reference | Venue & Link | How It Informed Research AI Web |
| :---: | :--- | :--- | :--- |
| 5 | **Lianmin Zheng et al.** — *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena* | NeurIPS 2023 · [arXiv:2306.05685](https://arxiv.org/abs/2306.05685) | Motivated **Blind Judge Anonymization** (`Candidate A/B/C`), structured multi-criteria Rubric scoring (Evidence / Logic / Rebuttal), and the optional Blind Compare view to reduce identity and self-enhancement biases. |
| 6 | **Patrick Lewis et al.** — *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks* | NeurIPS 2020 · [arXiv:2005.11401](https://arxiv.org/abs/2005.11401) | Foundational paradigm behind combining non-parametric external evidence (`sources.json`) with parametric LLM reasoning for updatable, provenance-backed synthesis. |
| 7 | **Tianyu Gao, Howard Yen, Jiatong Yu, Danqi Chen** — *Enabling Large Language Models to Generate Text with Citations (ALCE)* | EMNLP 2023 · [arXiv:2305.14627](https://arxiv.org/abs/2305.14627) | Highlighted how frequently LLMs hallucinate or omit valid citations, motivating strict `[S#]` prompt rules plus deterministic backend/UI **Citation Verification** (`extract_cited_sources` & `Citation Verifier`). |
| 8 | **Jason Priem, Heather Piwowar, Richard Orr** — *OpenAlex: A fully-open index of scholarly works, authors, venues, institutions, and concepts* | arXiv 2022 · [arXiv:2205.01833](https://arxiv.org/abs/2205.01833) | Powers the project's zero-API-key scholarly retrieval adapter alongside arXiv Atom API and Wikipedia Search API. |

### C. Web Security, Session Standards & UI/UX Benchmarks

| # | Standard / Product Reference | Link / Artifact | How It Informed Research AI Web |
| :---: | :--- | :--- | :--- |
| 9 | **W3C WebAppSec — Device Bound Session Credentials (DBSC)** | [W3C TR /dbsc/](https://www.w3.org/TR/dbsc/) · [Chrome DBSC Guide](https://developer.chrome.com/docs/privacy-sandbox/dbsc) | Explained why Chrome 157+ hardware-binds Google `__Secure-1PSIDTS` sessions (breaking cross-process reuse) and motivated shipping the Firefox Manifest V2 1-click Cookie Sync extension (`bridge/extension/`). |
| 10 | **UI/UX Comparative Study (5 Platforms + WCAG 2.1 AA)** | Local design specs: `public/assets/aistudio/UI_UX_Research_Report_579a35fc.pdf`, `public/assets/aistudio/Flow_Map_UI_Spec_5149e416.pdf` | Synthesized best practices from **Stanford Co-STORM**, **Perplexity Deep Research**, **OpenAI Deep Research**, **Open WebUI**, and **ChatHub** into the 1→N density-adaptive notebook UI and zero-coupling `/flow` DAG visualizer (with $\ge 4.5:1$ WCAG AA text contrast in both Light and Dark themes). |
