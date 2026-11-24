# Algorithms & Research References — Research AI Web

> 🌐 **Language:** **English** | [한국어](ALGORITHMS_AND_RESEARCH.ko.md) | [Tiếng Việt](ALGORITHMS_AND_RESEARCH.vi.md)
>
> 📚 **Related Docs:** [README](../README.md) · [System Architecture](ARCHITECTURE.md)

This document catalogs every algorithm actually implemented in **Research AI Web** (with exact source locations and complexities) alongside the verified academic papers, technical standards, and UI/UX benchmarks that guided the system's design.

---

## Part 1: Implemented Algorithms

### 1.1. Multi-Agent Debate, Deep Context Budgets & Stateless Isolation
- **Bounded Async Worker Pool (`src/lab/ResearchLabApp.tsx:runPerspectivesBatch`)**
  - Spawns `min(maxConcurrency, targets.length)` concurrent async workers pulling from a shared perspective queue, paired with an `AbortController` so clicking **Dừng** cancels in-flight HTTP calls immediately and logs a `run_aborted` event.
  - **Round-Scoped Visibility & Deep Context (`app/prompts.py:format_conversation_history`, `build_perspective_prompts`)**: Round 0 runs each perspective independently (`peerMessages = undefined`), while cross-debate rounds pass prior-round arguments explicitly. Deep mode (`detailMode="deep"`) expands conversation budgets to `MAX_DEEP_HISTORY_CHARS = 60000`, preserves research dossiers up to `MAX_PRESERVED_RESEARCH_CHARS = 16000` chars/turn, and supplies up to `12000` chars per source instead of truncating older research turns at `240` chars.
- **Stateless Ephemeral Prompt Compilation (`app/bridge.py:compile_stateless_user_prompt`, `chat_stateless`)**
  - Compiles system role instructions, strict citation rules, source context `[S1]..[Sk]`, peer arguments, and user query into a single `role: "user"` payload with `X-DSH-Ephemeral: 1`, preventing Gemini Web from ignoring `role: "system"` and isolating Bridge workers from persistent sessions/ledgers.

### 1.2. Gateway Routing, Ephemeral Balance & Failover
- **Sticky Sessions vs. Fair Ephemeral Round-Robin + `X-Exclude-Lanes` (`bridge/app/gateway_router.py:reserve_lane`)**
  - Long-lived coding sessions use deterministic keying (`compute_session_key`, 16-hex `SHA-256` prefix) and sticky bindings (`STICKY_TTL = 3600s`, `MAX_STICKY_SESSIONS = 128`) ranked by:
    $$\text{rank}(\text{lane}) = \big(\max(\text{inflight}_{\text{worker}}, \text{inflight}_{\text{gw}}),\; \text{role\_penalty},\; \text{sticky\_count},\; \text{index}\big)$$
  - Ephemeral requests (`X-DSH-Ephemeral: 1`) bypass sticky affinity and advance `_rr_cursor` round-robin across healthy peers for even load distribution; when Judge includes `X-Exclude-Lanes`, Gateway softly prefers lanes absent from the exclusion set whenever healthy alternatives exist.
- **Cooldown Circuit Breaker & Exponential Backoff (`bridge/app/gateway_router.py:mark_cooldown`, `app/bridge.py:chat_stateless`)**
  - Gateway places workers returning `{429, 503}` or `ConnectError` into a `15s` cooldown and fails over cleanly.
  - WebChat retries `{408, 429, 500, 502, 503, 504}` with capped exponential backoff ($\min(20\text{s},\, 3 \cdot 2^{\text{attempt}})$) honoring `Retry-After` (clamped to `[0, 60]`s).
- **Direct Fail-Closed Pinned-Lane Resolution (`app/bridge.py:resolve_lane_url`)**
  - When `pinnedLaneId` is specified (e.g., `acc2`), WebChat resolves the loopback worker URL via `/v1/lanes`, checks `_is_loopback_url()`, and dispatches directly—failing closed (`HTTP 502`) if disabled or unreachable.

### 1.3. Cross-Account Blind Judge & Resilient JSON Recovery
- **Bijective Identity Masking (`app/judge.py:synthesize_judge_report`, `mask_handles_in_text`, `unmask_handles_in_text`)**
  - Builds a bidirectional alias table (`@handle ↔ Ứng viên A/B/C…`, also unmasking `Candidate A` variants) before sending transcripts to Judge, automatically collects debaters' `used_lanes` into `X-Exclude-Lanes`, embeds the `verifier.py` audit report into the prompt, and computes 3-axis Rubric totals (`total = round((evidence + logic + rebuttal) / 3.0, 1)`).
  - Flags incomplete Judge JSON scores with `fallbackScored = true` (`5.0` baseline) and appends transparent `evaluationWarnings` instead of hallucinating scores.
- **String-Aware Balanced-Brace JSON Extraction (`app/bridge.py:parse_resilient_json`)**
  - Strips Markdown code fences, isolates the outermost `{...}` object via a quote/escape-aware $O(N)$ brace-depth scanner, tries `json.loads`, and falls back to `json_repair.repair_json`.

### 1.4. Open Academic Retrieval, Full-Text PDF, Quantitative Verification & SSRF Shield
- **Concurrent 3-Source Search & Open-Access Full-Text PDF Upgrade (`app/research.py:search_open_academic_sources`, `_upgrade_item_to_fulltext`)**
  - Queries arXiv Atom XML API, OpenAlex Works REST API (reconstructing inverted-index abstracts `{word: [positions...]}` in $O(W)$ time), and Wikipedia Search API via `asyncio.gather`; ranks by query relevance, deduplicates up to 6 sources, and upgrades up to 3 open-access arXiv/OpenAlex candidates to **Full-Text PDF** (`pypdf`, up to 20 pages, `MAX_FULLTEXT_EXCERPT_LEN = 16000`).
  - Supports local `.pdf` uploads (`extract_uploaded_pdf_source`, 15 MB cap, 25 pages) and labels every source `contentLevel` (`full_text` | `abstract_only` | `excerpt`).
- **Citation & Quantitative Claim Verifier (`app/verifier.py:verify_perspective_turn`, `extract_citation_breakdown`)**
  - Separates direct citations `[S#]`, explicit inferences `[Suy luận từ S#]`, and fabricated source IDs outside `sources.json`.
  - Splits responses into sentences, extracts quantitative numeric claims (`%`, decimals, sample sizes `n=...` supporting both `.` and `,` separators) in direct `[S#]` sentences (ignoring numbers inside `[Suy luận từ S#]` or section labels like `Table 2.1`), and compares parsed numerical values against the cited source text, reporting unmatched figures in `unverifiedNumbers` and `warnings`.
- **5-Hop DNS & Redirect SSRF Shield (`app/research.py:is_safe_public_url`, `_safe_get_following_redirects`)**
  - Permits only `http`/`https`, blocks private/loopback/link-local IPs and `.local`/`.internal` hostnames, validates every DNS `getaddrinfo` IP, disables implicit redirects (`follow_redirects=False`), and re-validates up to 5 `Location` redirect hops with a `15 MB` cap.

### 1.5. Visual AI Flow Map Graph Layout & Path Highlighting
- **Event-Sourced Incremental DAG Folding (`src/flow/FlowCanvasSvg.tsx:buildGraphFromEvents`)**
  - Folds append-only `FlowEvent[]` records into a stage-partitioned graph $(V, E)$, injecting dimmed `disabled` nodes for excluded perspectives.
- **Adaptive Stage Layout & Convergence Bus (`src/flow/FlowCanvasSvg.tsx:stagePairMetrics`, `buildEdgePath`)**
  - Switches to `compactMode` when a stage holds $\ge 5$ nodes, routing dense $N \to 1$ / $N \times N$ edges through a shared vertical **Convergence Bus** (`busX`).
- **Bidirectional Upstream/Downstream DFS (`src/flow/FlowCanvasSvg.tsx:focusSet`)**
  - Executes two iterative DFS passes ($O(|V| + |E|)$) along incoming and outgoing edges on hover/selection to highlight the causal path.

### 1.6. Bridge Reliability & Safe Parsing
- **Linear $O(N)$ Non-Regex Tag Scanner & Stream Sanitizer (`bridge/app/tool_parser.py`, `bridge/app/streaming.py`)**
  - Uses `str.find()` linear scanning for `<tool_call>` blocks and buffers partial tags (`ToolCallAwareStreamer` + `strip_gemini_ui_artifacts`) to strip internal Gemini Web UI XML (`<ElicitationsGroup>`, `<Elicitation>`) while preserving valid `<tool_call>` JSON strings.
- **Non-Reentrant `init()` Deadlock Guard (`bridge/app/gemini_session.py:GeminiClient`)**
  - Intercepts auth redirects (`boq_identityfrontendauthuiserver`) before RPC calls and forces `current_retry=0, close_on_error=False` under `self._in_init` to prevent `self._lock` self-deadlock.
- **Atomic File Writes (`app/storage.py:_atomic_write_json`, `providers.py`, `bridge/app/routes_admin.py`)**
  - Writes JSON/`.env` updates to a same-directory temp file, flushes to disk, and swaps atomically with `os.replace`.

---

## Part 2: Academic Papers & Technical References

Every reference below was verified directly against official venues/arXiv/W3C records and maps to concrete mechanisms built into this project.

### A. Multi-Agent Debate & Multi-Perspective Research

| # | Paper / Reference | Venue & Link | How It Informed Research AI Web |
| :---: | :--- | :--- | :--- |
| 1 | **Yilun Du, Shuang Li, Antonio Torralba, Joshua B. Tenenbaum, Igor Mordatch** — *Improving Factuality and Reasoning in Language Models through Multiagent Debate* | ICML 2024 (arXiv May 2023) · [arXiv:2305.14325](https://arxiv.org/abs/2305.14325) | Core theoretical basis for running multi-round independent answers (Round 0) followed by peer cross-examination rounds, showing factual/reasoning gains even when sharing the same underlying model family. |
| 2 | **Tian Liang et al.** — *Encouraging Divergent Thinking in Large Language Models through Multi-Agent Debate* | EMNLP 2024 (arXiv May 2023) · [arXiv:2305.19118](https://arxiv.org/abs/2305.19118) · [ACL Anthology](https://aclanthology.org/2024.emnlp-main.992/) | Motivated distinct adversarial personas (`@Nghiên_cứu` vs. `@Phản_biện`) and an independent Judge to counter the *Degeneration-of-Thought (DoT)* failure mode of single-model self-reflection. |
| 3 | **Yijia Shao, Yucheng Jiang, Theodore A. Kanell, Peter Xu, Omar Khattab, Monica S. Lam** — *Assisting in Writing Wikipedia-like Articles From Scratch with Large Language Models (STORM)* | NAACL 2024 · [arXiv:2402.14207](https://arxiv.org/abs/2402.14207) | Inspired perspective-driven research templates and structured outline curation prior to final report synthesis. |
| 4 | **Yucheng Jiang, Yijia Shao, Dekun Ma, Sina J. Semnani, Monica S. Lam** — *Into the Unknown Unknowns: Engaged Human Learning through Participation in Language Model Agent Conversations (Co-STORM)* | EMNLP 2024 · [arXiv:2408.15232](https://arxiv.org/abs/2408.15232) | Directly inspired the human-in-the-loop multi-agent group chat UX (`@role` / `@#tag` steering) paired with a dynamically updated **Living Outline** (Consensus / Contradictions / Knowledge Gaps). |

### B. Evaluation, Grounded Retrieval & Citation Verification

| # | Paper / Reference | Venue & Link | How It Informed Research AI Web |
| :---: | :--- | :--- | :--- |
| 5 | **Lianmin Zheng et al.** — *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena* | NeurIPS 2023 · [arXiv:2306.05685](https://arxiv.org/abs/2306.05685) | Motivated **Blind Judge Anonymization** (`Ứng viên A/B/C`), structured multi-criteria Rubric scoring (Evidence / Logic / Rebuttal), cross-account exclusion (`X-Exclude-Lanes`), and Blind Compare mode. |
| 6 | **Patrick Lewis et al.** — *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks* | NeurIPS 2020 · [arXiv:2005.11401](https://arxiv.org/abs/2005.11401) | Foundational paradigm behind pairing external evidence (`sources.json`, `16,000`-char full-text PDFs) with LLM reasoning for updatable, provenance-backed synthesis. |
| 7 | **Tianyu Gao, Howard Yen, Jiatong Yu, Danqi Chen** — *Enabling Large Language Models to Generate Text with Citations (ALCE)* | EMNLP 2023 · [arXiv:2305.14627](https://arxiv.org/abs/2305.14627) | Motivated strict `[S#]` vs. `[Suy luận từ S#]` prompt rules paired with our deterministic **Citation & Quantitative Verifier** (`app/verifier.py`). |
| 8 | **Jason Priem, Heather Piwowar, Richard Orr** — *OpenAlex: A fully-open index of scholarly works, authors, venues, institutions, and concepts* | arXiv 2022 · [arXiv:2205.01833](https://arxiv.org/abs/2205.01833) | Powers the project's zero-API-key scholarly retrieval adapter alongside arXiv Atom API and Wikipedia Search API. |

### C. Web Security, Session Standards & UI/UX Benchmarks

| # | Standard / Product Reference | Link / Artifact | How It Informed Research AI Web |
| :---: | :--- | :--- | :--- |
| 9 | **W3C WebAppSec — Device Bound Session Credentials (DBSC)** | [W3C TR /dbsc/](https://www.w3.org/TR/dbsc/) · [Chrome DBSC Guide](https://developer.chrome.com/docs/privacy-sandbox/dbsc) | Explained why Chrome 157+ hardware-binds Google `__Secure-1PSIDTS` sessions and motivated shipping both headless Profile Vault CDP cookie sync and the Firefox MV2 Cookie Sync extension (`bridge/extension/`). |
| 10 | **UI/UX Comparative Study (5 Platforms + WCAG 2.1 AA)** | Local design specs: `public/assets/aistudio/UI_UX_Research_Report_579a35fc.pdf`, `public/assets/aistudio/Flow_Map_UI_Spec_5149e416.pdf` | Synthesized best practices from **Stanford Co-STORM**, **Perplexity Deep Research**, **OpenAI Deep Research**, **Open WebUI**, and **ChatHub** into the 1→N density-adaptive notebook UI and zero-coupling `/flow` DAG visualizer (with $\ge 4.5:1$ WCAG AA text contrast in both Light and Dark themes). |
