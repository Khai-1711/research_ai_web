# 알고리즘 및 참고 연구 논문 — Research AI Web

> 🌐 **언어:** [English](ALGORITHMS_AND_RESEARCH.md) | **한국어** | [Tiếng Việt](ALGORITHMS_AND_RESEARCH.vi.md)
>
> 📚 **관련 문서:** [README](../README.ko.md) · [시스템 아키텍처](ARCHITECTURE.ko.md)

본 문서는 **Research AI Web** 코드베이스에 실제로 구현된 모든 핵심 알고리즘(정확한 파일 경로 및 시간 복잡도 포함)과 시스템 설계에 근거가 된 학술 논문·기술 표준·UI/UX 벤치마크를 정리합니다.

---

## 제1부: 실제 구현된 핵심 알고리즘

### 1.1. 멀티 에이전트 토론, 심층 컨텍스트 예산 및 무상태 격리
- **제한된 비동기 워커 풀 (`src/lab/ResearchLabApp.tsx:runPerspectivesBatch`)**
  - 공유 관점 큐에서 작업을 꺼내는 `min(maxConcurrency, targets.length)`개의 비동기 워커를 실행하고 `AbortController`를 연결해 **Dừng** 클릭 시 진행 중인 HTTP 요청을 즉시 취소하며 `run_aborted` 이벤트를 기록합니다.
  - **라운드별 가시성 제어 & 심층 컨텍스트 (`app/prompts.py:format_conversation_history`, `build_perspective_prompts`)**: Round 0은 독립 응답(`peerMessages = undefined`), 교차 반박 라운드는 이전 라운드 발화를 명시 전달합니다. **Chuyên sâu** 모드(`detailMode="deep"`)에서는 이력 예산을 `MAX_DEEP_HISTORY_CHARS = 60000`으로 확대하고 연구 문서를 턴당 최대 `MAX_PRESERVED_RESEARCH_CHARS = 16000`자, 출처를 최대 `12000`자까지 보존합니다.
- **무상태 격리 프롬프트 컴파일 (`app/bridge.py:compile_stateless_user_prompt`, `chat_stateless`)**
  - 시스템 지시, 엄격한 인용 규칙, 출처 `[S1]..[Sk]`, 동료 발언 및 질문을 단일 `role: "user"` 페이로드에 병합하고 `X-DSH-Ephemeral: 1` 헤더를 전송해 Gemini Web의 `role: "system"` 무시 및 Bridge 워커 세션 오염을 동시에 방지합니다.

### 1.2. 게이트웨이 라우팅, Ephemeral 분산 및 페일오버
- **고정 세션(Sticky) vs 공정 Ephemeral 라운드로빈 + `X-Exclude-Lanes` (`bridge/app/gateway_router.py:reserve_lane`)**
  - 일반 지속 세션은 결정론적 세션 키(`compute_session_key`, `SHA-256` 상위 16 hex)와 Sticky 정책(`STICKY_TTL = 3600s`, `MAX_STICKY_SESSIONS = 128`)을 따릅니다:
    $$\text{rank}(\text{lane}) = \big(\max(\text{inflight}_{\text{worker}}, \text{inflight}_{\text{gw}}),\; \text{role\_penalty},\; \text{sticky\_count},\; \text{index}\big)$$
  - `X-DSH-Ephemeral: 1` 연구 요청은 Sticky를 우회해 `_rr_cursor` 라운드로빈으로 정상 계정에 부하를 고르게 배분하며, 심판이 `X-Exclude-Lanes`를 전달하면 건강한 대체 계정이 있는 한 토론 참여 계정을 우선 회피합니다.
- **쿨다운 서킷 브레이커 & 지수 백오프 (`bridge/app/gateway_router.py:mark_cooldown`, `app/bridge.py:chat_stateless`)**
  - `{429, 503}` 또는 `ConnectError` 발생 워커를 `15s` 쿨다운하고 다른 정상 워커로 페일오버하며, WebChat은 `{408, 429, 500, 502, 503, 504}`에 대해 `Retry-After`(`0..60s`)를 존중하는 상한 지수 백오프($\min(20\text{s},\, 3 \cdot 2^{\text{attempt}})$)를 수행합니다.
- **Fail-Closed 고정 레인 해석 (`app/bridge.py:resolve_lane_url`)**
  - `pinnedLaneId`(예: `acc2`) 지정 시 `/v1/lanes`에서 루프백 URL을 검증해 직접 호출하며, 비활성·응답 불가 계정은 우회 없이 즉시 `HTTP 502`를 반환합니다.

### 1.3. 교차 계정 블라인드 심판 및 복원력 있는 JSON 파싱
- **일대일 익명 별칭 매핑 (`app/judge.py:synthesize_judge_report`, `mask_handles_in_text`, `unmask_handles_in_text`)**
  - 심판 호출 전 `@핸들 ↔ Ứng viên A/B/C…`(`Candidate A` 변형 포함) 양방향 매핑을 생성하고, 토론에 참여한 `used_lanes`를 `X-Exclude-Lanes`로 자동 전달하며, `verifier.py` 감사 보고서를 프롬프트에 삽입해 3축 루브릭 점수(`total = round((evidence + logic + rebuttal) / 3.0, 1)`)를 산출합니다.
  - 심판 JSON 점수가 누락된 경우 `fallbackScored = true`(`5.0` 기본값)와 `evaluationWarnings`를 명확히 기록합니다.
- **문자열 인식 중괄호 균형 JSON 추출 (`app/bridge.py:parse_resilient_json`)**
  - 코드 펜스 제거 후 따옴표·이스케이프 인식 $O(N)$ 상태로 최외곽 `{...}` 블록을 추출하고 `json.loads` 실패 시 `json_repair.repair_json`으로 복구합니다.

### 1.4. 공개 학술 검색, PDF 전문 업그레이드, 정량 검증 & SSRF 방어
- **3개 공개 학술 소스 병렬 검색 & OA PDF 전문 업그레이드 (`app/research.py:search_open_academic_sources`, `_upgrade_item_to_fulltext`)**
  - `asyncio.gather`로 arXiv Atom XML, OpenAlex Works API($O(W)$ 역인덱스 초록 복원 포함), Wikipedia Search API를 동시 조회한 뒤 관련도 순 중복 제거(최대 6건)를 거쳐 상위 3개 오픈 액세스 논문을 **PDF 전문**(`pypdf`, 최대 20페이지, `MAX_FULLTEXT_EXCERPT_LEN = 16000`)으로 자동 업그레이드합니다.
  - 로컬 `.pdf` 업로드(`extract_uploaded_pdf_source`, 최대 `15MB`, `25`페이지)를 지원하며 모든 출처에 `contentLevel`(`full_text` | `abstract_only` | `excerpt`)을 기록합니다.
- **인용 및 수치 주장 결정론적 검증 (`app/verifier.py:verify_perspective_turn`, `extract_citation_breakdown`)**
  - 직접 인용(`[S#]`), 추론(`[Suy luận từ S#]`), 허위 인용 ID를 분리합니다.
  - 문장 분리 후 `[S#]` 직접 인용 문장의 정량 수치(`%`, 소수점, 표본 수 `n=...`, `.`/`,` 구분자 모두 지원)를 추출해(`Mục 2.1`/`Table 3.2` 및 `[Suy luận từ S#]` 구간 제외) 인용된 원문과 수치적으로 대조하고 불일치 항목을 `unverifiedNumbers`와 `warnings`에 보고합니다.
- **5단계 DNS & 리다이렉트 SSRF 방어 (`app/research.py:is_safe_public_url`, `_safe_get_following_redirects`)**
  - `http`/`https` 외 스킴, 사설·루프백·링크로컬 IP 및 `.local`/`.internal` 도메인을 차단하고 DNS `getaddrinfo` 전체 IP를 검증하며, `follow_redirects=False` 상태에서 최대 5단계 `Location` 리다이렉트마다 SSRF를 재검사(`15MB` 상한)합니다.

### 1.5. 비주얼 AI 플로우 맵 DAG 레이아웃 및 경로 탐색
- **이벤트 소싱 기반 증분 DAG 폴딩 (`src/flow/FlowCanvasSvg.tsx:buildGraphFromEvents`)**
  - append-only `FlowEvent[]` 스트림을 `stageIndex`별 그래프 $(V, E)$로 접어 구성하며 비활성 AI도 흐린 `disabled` 노드로 표시합니다.
- **적응형 밀도 레이아웃 & 수직 수렴 버스 (`src/flow/FlowCanvasSvg.tsx:stagePairMetrics`, `buildEdgePath`)**
  - 단계당 5개 이상 노드에서 `compactMode`로 전환하고, 밀집된 $N \to 1$ / $N \times N$ 구간은 수직 **수렴 버스(`busX`)**로 연결합니다.
- **양방향 상·하류 DFS 경로 강조 (`src/flow/FlowCanvasSvg.tsx:focusSet`)**
  - 노드 호버/선택 시 반복 DFS($O(|V| + |E|)$)로 상류(`up`)와 하류(`down`) 인과 경로를 강조합니다.

### 1.6. Bridge 프로토콜 안정성
- **선형 $O(N)$ 비정규식 태그 스캐너 & 스트림 UI 필터 (`bridge/app/tool_parser.py`, `bridge/app/streaming.py`)**
  - `str.find()` 스캐너로 `<tool_call>`을 안전하게 추출하고, 스트리밍 버퍼 필터(`ToolCallAwareStreamer` + `strip_gemini_ui_artifacts`)로 Gemini Web 내부 XML(`<ElicitationsGroup>`, `<Elicitation>`)만 제거하며 유효한 JSON 툴 호출을 보존합니다.
- **비재진입 `init()` 교착 방지 가드 (`bridge/app/gemini_session.py:GeminiClient`)**
  - RPC 전 로그인 리다이렉트를 선제 감지하고 `self._in_init` 중 `current_retry=0, close_on_error=False`로 `self._lock` 자기 교착을 차단합니다.
- **원자적 파일 쓰기 (`app/storage.py:_atomic_write_json`, `providers.py`, `bridge/app/routes_admin.py`)**
  - 임시 파일 기록 + 플러시 + `os.replace`로 JSON/`.env` 손상을 방지합니다.

---

## 제2부: 참고 학술 논문 및 기술 표준

아래 모든 문헌은 공식 학회·arXiv·W3C 원문과 대조 검증되었으며, 본 프로젝트의 구체적 설계 요소와 직접 연결됩니다.

### A. 멀티 에이전트 토론 및 다중 관점 연구

| # | 논문 / 참고 문헌 | 학회 및 링크 | 본 프로젝트 적용 내용 |
| :---: | :--- | :--- | :--- |
| 1 | **Yilun Du, Shuang Li, Antonio Torralba, Joshua B. Tenenbaum, Igor Mordatch** — *Improving Factuality and Reasoning in Language Models through Multiagent Debate* | ICML 2024 (arXiv 2023.05) · [arXiv:2305.14325](https://arxiv.org/abs/2305.14325) | 동일 계열 모델을 사용하더라도 독립 초기 응답(Round 0) 후 교차 토론을 거치면 사실성과 추론 정확도가 향상된다는 핵심 이론적 근거. |
| 2 | **Tian Liang et al.** — *Encouraging Divergent Thinking in Large Language Models through Multi-Agent Debate* | EMNLP 2024 (arXiv 2023.05) · [arXiv:2305.19118](https://arxiv.org/abs/2305.19118) · [ACL Anthology](https://aclanthology.org/2024.emnlp-main.992/) | 단일 모델 자기 성찰의 사고 고착(*Degeneration-of-Thought, DoT*)을 극복하기 위해 대립 역할(`@Nghiên_cứu` vs. `@Phản_biện`)과 독립 심판 구조를 채택한 근거. |
| 3 | **Yijia Shao, Yucheng Jiang, Theodore A. Kanell, Peter Xu, Omar Khattab, Monica S. Lam** — *Assisting in Writing Wikipedia-like Articles From Scratch with Large Language Models (STORM)* | NAACL 2024 · [arXiv:2402.14207](https://arxiv.org/abs/2402.14207) | 다중 관점 역할 템플릿과 최종 보고서 작성 전 구조화된 아웃라인(Outline) 정제 파이프라인 설계에 영감을 제공. |
| 4 | **Yucheng Jiang, Yijia Shao, Dekun Ma, Sina J. Semnani, Monica S. Lam** — *Into the Unknown Unknowns: Engaged Human Learning through Participation in Language Model Agent Conversations (Co-STORM)* | EMNLP 2024 · [arXiv:2408.15232](https://arxiv.org/abs/2408.15232) | 인간 참여형 멀티 에이전트 그룹 채팅(`@역할`/`@#태그` 지시)과 실시간 갱신 **라이빙 아웃라인**(합의점·모순점·정보 공백) UX 설계의 토대. |

### B. 심판 평가, 근거 기반 검색 및 인용 검증

| # | 논문 / 참고 문헌 | 학회 및 링크 | 본 프로젝트 적용 내용 |
| :---: | :--- | :--- | :--- |
| 5 | **Lianmin Zheng et al.** — *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena* | NeurIPS 2023 · [arXiv:2306.05685](https://arxiv.org/abs/2306.05685) | **블라인드 심판 익명화**(`Ứng viên A/B/C`), 다축 루브릭(근거·논리·반박), 교차 계정 배정(`X-Exclude-Lanes`) 및 블라인드 비교 화면 설계의 근거. |
| 6 | **Patrick Lewis et al.** — *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks* | NeurIPS 2020 · [arXiv:2005.11401](https://arxiv.org/abs/2005.11401) | 외부 근거 저장소(`sources.json`, `16,000`자 PDF 전문)와 LLM 추론을 결합해 출처 추적이 가능한 연구 종합을 구현한 RAG 아키텍처. |
| 7 | **Tianyu Gao, Howard Yen, Jiatong Yu, Danqi Chen** — *Enabling Large Language Models to Generate Text with Citations (ALCE)* | EMNLP 2023 · [arXiv:2305.14627](https://arxiv.org/abs/2305.14627) | 엄격한 `[S#]` vs `[Suy luận từ S#]` 인용 규칙 및 결정론적 백엔드/UI **인용·수치 검증기**(`app/verifier.py`) 구현의 직접적 동기. |
| 8 | **Jason Priem, Heather Piwowar, Richard Orr** — *OpenAlex: A fully-open index of scholarly works, authors, venues, institutions, and concepts* | arXiv 2022 · [arXiv:2205.01833](https://arxiv.org/abs/2205.01833) | arXiv Atom API·Wikipedia API와 함께 API 키 없는 무료 학술 검색 어댑터를 구성하는 공개 학술 데이터베이스. |

### C. 웹 보안, 세션 표준 및 UI/UX 벤치마크

| # | 표준 / 제품 참고 자료 | 링크 / 산출물 | 본 프로젝트 적용 내용 |
| :---: | :--- | :--- | :--- |
| 9 | **W3C WebAppSec — Device Bound Session Credentials (DBSC)** | [W3C TR /dbsc/](https://www.w3.org/TR/dbsc/) · [Chrome DBSC Guide](https://developer.chrome.com/docs/privacy-sandbox/dbsc) | Chrome 157+ 세션 바인딩 제약을 규명하고, 무창 Profile Vault CDP 동기화 및 Firefox MV2 쿠키 동기화 확장(`bridge/extension/`)을 채택한 근거. |
| 10 | **UI/UX 비교 연구 (5개 플랫폼 + WCAG 2.1 AA)** | 프로젝트 내 설계 문서: `public/assets/aistudio/UI_UX_Research_Report_579a35fc.pdf`, `public/assets/aistudio/Flow_Map_UI_Spec_5149e416.pdf` | **Stanford Co-STORM**, **Perplexity Deep Research**, **OpenAI Deep Research**, **Open WebUI**, **ChatHub**의 장점을 통합해 1→N 밀도 적응형 노트북 UI와 제로 커플링 `/flow` 시각화(라이트·다크 모드 모두 WCAG AA $\ge 4.5:1$ 대비)를 설계. |
