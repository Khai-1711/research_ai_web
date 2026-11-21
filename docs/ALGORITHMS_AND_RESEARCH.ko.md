# 알고리즘 및 참고 연구 논문 — Research AI Web

> 🌐 **언어:** [English](ALGORITHMS_AND_RESEARCH.md) | **한국어** | [Tiếng Việt](ALGORITHMS_AND_RESEARCH.vi.md)
>
> 📚 **관련 문서:** [README](../README.ko.md) · [시스템 아키텍처](ARCHITECTURE.ko.md)

본 문서는 **Research AI Web** 코드베이스에 실제로 구현된 모든 핵심 알고리즘(정확한 파일 경로 및 시간 복잡도 포함)과 시스템 설계에 근거가 된 학술 논문·기술 표준·UI/UX 벤치마크를 정리합니다.

---

## 제1부: 실제 구현된 핵심 알고리즘

### 1.1. 멀티 에이전트 토론 및 제한된 동시성 스케줄링
- **제한된 비동기 워커 풀 (`src/lab/ResearchLabApp.tsx:runPerspectivesBatch`)**
  - 공유 관점 큐에서 작업을 꺼내는 `min(maxConcurrency, targets.length)`개의 비동기 워커를 실행하고, `AbortController`를 연결해 **중지(Stop)** 클릭 시 진행 중인 HTTP 요청을 즉시 취소하며 `run_aborted` 이벤트를 기록합니다.
  - **라운드별 가시성 제어(Round-Scoped Visibility)**: Round 0에서는 각 AI가 서로의 답변을 보지 못한 채 독립 응답(`peerMessages = undefined`)하고, 교차 반박 라운드에서만 이전 라운드 발언을 전달해 컨텍스트 오염을 방지합니다.
- **Stateless 단일 사용자 프롬프트 컴파일 (`app/bridge.py:compile_stateless_user_prompt`)**
  - 시스템 역할 지시, 출처 `[S1]..[Sk]`, 동료 발언 및 사용자 질문을 단일 `role: "user"` 페이로드(`stream=False`)로 병합해 Gemini Web이 `role: "system"`을 무시하는 문제를 차단합니다.

### 1.2. 게이트웨이 라우팅, 세션 고정 및 페일오버
- **결정론적 세션 키 해싱 (`bridge/app/session_pool.py:compute_session_key`)**
  - 명시적 세션 ID 또는 `agent_name + "\0" + 정규화된 첫 사용자 메시지`를 `SHA-256`(상위 16 hex)으로 해싱해 워커당 최대 `16`개의 독립 `SessionSlot`(`SESSION_POOL_TTL = 3600s`)을 격리합니다.
- **다중 키 사전식 최소 부하(Least-Inflight) 선택 (`bridge/app/gateway_router.py:reserve_lane`)**
  - 정상 워커를 다음 우선순위 튜플로 정렬해 선택합니다.
    $$\text{rank}(\text{lane}) = \big(\max(\text{inflight}_{\text{worker}}, \text{inflight}_{\text{gw}}),\; \text{role\_penalty},\; \text{sticky\_count},\; \text{index}\big)$$
  - `STICKY_TTL = 3600s`, `MAX_STICKY_SESSIONS = 128` 정책으로 활성 대화를 동일 워커에 유지하고, 동률 시 서브에이전트를 메인 리드 워커와 분리 배치합니다.
- **쿨다운 서킷 브레이커 & 지수 백오프 (`bridge/app/gateway_router.py:mark_cooldown`, `app/bridge.py:chat_stateless`)**
  - Gateway는 `{429, 503}` 또는 `ConnectError` 발생 워커를 `15s` 쿨다운 처리하고 다른 정상 워커로 페일오버합니다.
  - WebChat은 `{408, 429, 500, 502, 503, 504}`에 대해 `Retry-After` 헤더(`[0, 60]`초 제한)를 존중하는 상한 지수 백오프($\min(20\text{s},\, 3 \cdot 2^{\text{attempt}})$)를 적용합니다.
- **Fail-Closed 고정 레인 직접 해석 (`app/bridge.py:resolve_lane_url`)**
  - AI 관점 또는 심판에 `pinnedLaneId`(예: `acc2`)가 지정되면 Gateway `/v1/lanes`에서 해당 워커의 로컬 주소를 조회하고 `_is_loopback_url()` 검증 후 직접 호출합니다. 지정 계정이 꺼져 있거나 응답 불가면 다른 계정으로 몰래 우회하지 않고 즉시 `HTTP 502`를 반환합니다.

### 1.3. 블라인드 LLM-as-a-Judge 및 복원력 있는 JSON 파싱
- **일대일(Bijective) 익명 별칭 매핑 (`app/routes.py:run_synthesize`)**
  - 심판 호출 전 실제 `@핸들`을 `후보 A/B/C…`로 가려 이름·역할 편향을 줄이고, 응답 수신 후 `rubric`, `consensus.supporters`, `perspectiveBreakdown`을 결정론적으로 원래 핸들로 복원합니다.
  - 3축 루브릭 평균(`total = round((evidence + logic + rebuttal) / 3.0, 1)`)을 계산해 내림차순 정렬합니다.
- **문자열 인식 중괄호 균형 JSON 추출 (`app/bridge.py:parse_resilient_json`)**
  - Markdown 코드 펜스를 벗긴 뒤, 따옴표와 이스케이프 문자를 인식하는 $O(N)$ 중괄호 깊이 상태 머신으로 최외곽 `{...}` 블록을 추출하고, `json.loads` 실패 시 `json_repair.repair_json`으로 후행 쉼표 등 경미한 문법 오류를 자동 복구합니다.

### 1.4. 공개 학술 검색, 인용 검증 및 SSRF 방어
- **3개 공개 학술 소스 병렬 팬아웃 (`app/research.py:search_open_academic_sources`)**
  - `asyncio.gather`로 arXiv Atom XML API, OpenAlex Works REST API, Wikipedia Search API를 동시 조회해 검증된 `[S1]..[Sk]` 출처 목록으로 정규화합니다.
- **OpenAlex 역인덱스 초록 복원 (`app/research.py:_search_openalex`)**
  - OpenAlex의 압축된 `{단어: [위치...]}` 역인덱스를 크기 제한 배열(최대 400 토큰)에 분산 배치해 $O(W)$ 시간에 원문 초록을 복원합니다.
- **결정론적 인용 화이트리스트 검증 (`app/routes.py:extract_cited_sources`, `src/lab/SecondaryViews.tsx:citationStats`)**
  - 응답 텍스트의 `[S\d+]` 패턴을 방의 실제 `sources.json` ID 집합과 교집합 필터링해 모델이 지어낸 가짜 인용(`[S99]` 등)을 제거하고, 보고서 화면에 유효/불일치 통계를 표시합니다.
- **2단계 DNS & 리다이렉트 SSRF 방어 (`app/research.py:is_safe_public_url`, `fetch_url_as_source`)**
  - `http`/`https` 외 스킴 및 사설·루프백·링크로컬 IP와 `.local`/`.internal` 도메인을 차단하고, DNS 조회 결과의 모든 IP가 공인 IP인지 검증하며, `follow_redirects=False` 상태에서 `Location` 리다이렉트 대상을 재검증(5MB 상한)합니다.

### 1.5. 비주얼 AI 플로우 맵 DAG 레이아웃 및 경로 탐색
- **이벤트 소싱 기반 증분 DAG 폴딩 (`src/flow/FlowCanvasSvg.tsx:buildGraphFromEvents`)**
  - append-only `FlowEvent[]` 스트림(`run_started`, `node_started`, `node_warning`, `node_completed`, `node_failed`)을 `stageIndex`별 그래프 $(V, E)$로 접어 구성하며, 비활성 AI도 흐린 `disabled` 노드로 자동 배치해 제외된 대상을 투명하게 보여줍니다.
- **적응형 밀도 레이아웃 & 수직 수렴 버스 (`src/flow/FlowCanvasSvg.tsx:stagePairMetrics`, `buildEdgePath`)**
  - 단계당 노드가 5개 이상이면 `compactMode` 카드로 전환합니다.
  - 소규모 단계 간에는 개별 3차 베지어 곡선을 사용하고, 밀집된 $N \to 1$ 또는 $N \times N$ 구간은 중앙 수직 **수렴 버스(`busX`)**로 묶어 간선 교차 혼잡을 해소합니다.
- **양방향 상·하류 DFS 경로 강조 (`src/flow/FlowCanvasSvg.tsx:focusSet`)**
  - 노드 호버/선택 시 스택 기반 반복 DFS($O(|V| + |E|)$)를 상류(`up`)와 하류(`down`) 양방향으로 수행해 전체 인과 경로만 선명하게 강조하고 나머지 가지를 흐리게 처리합니다.

### 1.6. Bridge 프로토콜 안정성 알고리즘
- **선형 $O(N)$ 비정규식 태그 스캐너 & Fail-Closed 배치 검증 (`bridge/app/tool_parser.py`)**
  - 정규식 역추적(ReDoS) 위험이 없는 `str.find()` 선형 스캔으로 `<tool_call>...</tool_call>` 블록을 추출하고, 파라미터 별칭 정규화·스키마 타입 검사·경로 경계 검사를 거쳐 단 하나의 태그라도 손상되면 전체 배치를 거부합니다.
- **비재진입 `init()` 교착 방지 가드 (`bridge/app/gemini_session.py:GeminiClient`)**
  - RPC 실행 전 Google 로그인 리다이렉트(`boq_identityfrontendauthuiserver`)를 선제 감지하고, `self._in_init` 구간에서 `current_retry=0, close_on_error=False`를 강제해 `self._lock` 재귀 교착을 제거합니다.
- **원자적 파일 쓰기 (`app/storage.py:_atomic_write_json`, `providers.py`, `bridge/app/routes_admin.py`)**
  - 동일 디렉터리 임시 파일에 기록 후 플러시하고 `os.replace`로 원자적 교체하여 비정상 종료 시 JSON/설정 파일 손상을 방지합니다.

---

## 제2부: 참고 학술 논문 및 기술 표준

아래 모든 문헌은 공식 학회·arXiv·W3C 원문과 대조 검증되었으며, 본 프로젝트의 구체적 설계 요소와 직접 연결됩니다.

### A. 멀티 에이전트 토론 및 다중 관점 연구

| # | 논문 / 참고 문헌 | 학회 및 링크 | 본 프로젝트 적용 내용 |
| :---: | :--- | :--- | :--- |
| 1 | **Yilun Du, Shuang Li, Antonio Torralba, Joshua B. Tenenbaum, Igor Mordatch** — *Improving Factuality and Reasoning in Language Models through Multiagent Debate* | ICML 2024 (arXiv 2023.05) · [arXiv:2305.14325](https://arxiv.org/abs/2305.14325) | 동일 계열 모델을 사용하더라도 독립 초기 응답(Round 0) 후 다중 라운드 교차 토론을 거치면 사실성과 추론 정확도가 향상된다는 핵심 이론적 근거. |
| 2 | **Tian Liang et al.** — *Encouraging Divergent Thinking in Large Language Models through Multi-Agent Debate* | EMNLP 2024 (arXiv 2023.05) · [arXiv:2305.19118](https://arxiv.org/abs/2305.19118) · [ACL Anthology](https://aclanthology.org/2024.emnlp-main.992/) | 단일 모델 자기 성찰의 사고 고착(*Degeneration-of-Thought, DoT*)을 극복하기 위해 대립 역할(`@Nghiên_cứu` vs. `@Phản_biện`)과 독립 심판 구조를 채택한 근거. |
| 3 | **Yijia Shao, Yucheng Jiang, Theodore A. Kanell, Peter Xu, Omar Khattab, Monica S. Lam** — *Assisting in Writing Wikipedia-like Articles From Scratch with Large Language Models (STORM)* | NAACL 2024 · [arXiv:2402.14207](https://arxiv.org/abs/2402.14207) | 다중 관점 역할 템플릿과 최종 보고서 작성 전 구조화된 아웃라인(Outline) 정제 파이프라인 설계에 영감을 제공. |
| 4 | **Yucheng Jiang, Yijia Shao, Dekun Ma, Sina J. Semnani, Monica S. Lam** — *Into the Unknown Unknowns: Engaged Human Learning through Participation in Language Model Agent Conversations (Co-STORM)* | EMNLP 2024 · [arXiv:2408.15232](https://arxiv.org/abs/2408.15232) | 인간 참여형 멀티 에이전트 그룹 채팅(`@역할`/`@#태그` 지시)과 실시간 갱신 **라이빙 아웃라인**(합의점·모순점·정보 공백) UX 설계의 직접적 토대. |

### B. 심판 평가, 근거 기반 검색 및 인용 검증

| # | 논문 / 참고 문헌 | 학회 및 링크 | 본 프로젝트 적용 내용 |
| :---: | :--- | :--- | :--- |
| 5 | **Lianmin Zheng et al.** — *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena* | NeurIPS 2023 · [arXiv:2306.05685](https://arxiv.org/abs/2306.05685) | 명칭·자기 선호 편향을 줄이기 위한 **블라인드 심판 익명화**(`후보 A/B/C`), 다축 루브릭(근거·논리·반박) 및 블라인드 비교 화면 설계의 근거. |
| 6 | **Patrick Lewis et al.** — *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks* | NeurIPS 2020 · [arXiv:2005.11401](https://arxiv.org/abs/2005.11401) | 비모수 외부 출처 저장소(`sources.json`)와 언어 모델 생성을 결합해 출처 추적이 가능한 연구 종합을 구현한 RAG 기본 아키텍처. |
| 7 | **Tianyu Gao, Howard Yen, Jiatong Yu, Danqi Chen** — *Enabling Large Language Models to Generate Text with Citations (ALCE)* | EMNLP 2023 · [arXiv:2305.14627](https://arxiv.org/abs/2305.14627) | LLM의 인용 환각 빈도를 입증한 연구로, 엄격한 `[S#]` 인용 규칙과 결정론적 백엔드/UI **Citation Verifier** 구현의 직접적 동기. |
| 8 | **Jason Priem, Heather Piwowar, Richard Orr** — *OpenAlex: A fully-open index of scholarly works, authors, venues, institutions, and concepts* | arXiv 2022 · [arXiv:2205.01833](https://arxiv.org/abs/2205.01833) | arXiv Atom API·Wikipedia API와 함께 API 키 없는 무료 학술 검색 어댑터를 구성하는 핵심 공개 학술 데이터베이스. |

### C. 웹 보안, 세션 표준 및 UI/UX 벤치마크

| # | 표준 / 제품 참고 자료 | 링크 / 산출물 | 본 프로젝트 적용 내용 |
| :---: | :--- | :--- | :--- |
| 9 | **W3C WebAppSec — Device Bound Session Credentials (DBSC)** | [W3C TR /dbsc/](https://www.w3.org/TR/dbsc/) · [Chrome DBSC Guide](https://developer.chrome.com/docs/privacy-sandbox/dbsc) | Chrome 157+에서 Google `__Secure-1PSIDTS` 세션이 기기 키에 바인딩되어 프로세스 외부 재사용이 차단되는 원인을 규명하고, Firefox Manifest V2 원클릭 쿠키 동기화 확장(`bridge/extension/`)을 채택한 근거. |
| 10 | **UI/UX 비교 연구 (5개 플랫폼 + WCAG 2.1 AA)** | 프로젝트 내 설계 문서: `public/assets/aistudio/UI_UX_Research_Report_579a35fc.pdf`, `public/assets/aistudio/Flow_Map_UI_Spec_5149e416.pdf` | **Stanford Co-STORM**, **Perplexity Deep Research**, **OpenAI Deep Research**, **Open WebUI**, **ChatHub**의 장점을 통합해 1→N 밀도 적응형 노트북 UI와 제로 커플링 `/flow` 시각화(라이트·다크 모드 모두 WCAG AA $\ge 4.5:1$ 대비)를 설계. |
