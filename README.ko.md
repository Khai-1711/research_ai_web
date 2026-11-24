# Research AI Web — 멀티 에이전트 연구실 & 비주얼 AI 플로우 맵

> 🌐 **언어:** [English](README.md) | **한국어** | [Tiếng Việt](README.vi.md)
>
> 📚 **문서:** [시스템 아키텍처](docs/ARCHITECTURE.ko.md) · [알고리즘 및 참고 연구 논문](docs/ALGORITHMS_AND_RESEARCH.ko.md)
>
> 🔗 **저장소:** https://github.com/Khai-1711/research_ai_web · **연동 Bridge:** https://github.com/Khai-1711/dsh-gemini-bridge

**Research AI Web**은 로컬 우선(Local-first) 방식의 다중 관점 AI 연구 워크스페이스이자 실시간 데이터 흐름 시각화 도구입니다. 적응형 **1 → N AI 리서치 랩**(`http://127.0.0.1:3000`), 완전히 분리된 **비주얼 AI 플로우 맵**(`http://127.0.0.1:3000/flow`), API 키 없는 공개 학술 검색(**arXiv**, **OpenAlex**, **Wikipedia**, 오픈 액세스 PDF 전문 자동 업그레이드, 5단계 리다이렉트 SSRF 방어 URL/PDF 파서, 최대 15MB 로컬 `.pdf` 업로드), 결정론적 **인용·수치 검증기(`app/verifier.py`)**, 그리고 무상태 격리 **DSH Gemini Bridge**(`acc1..accN`), **Gemini 공식 API**, **OpenAI 호환 API**(OpenAI, DeepSeek, Groq, Ollama, llama.cpp) 연동을 제공합니다.

---

## 핵심 기능

### 1. 적응형 멀티 에이전트 리서치 랩 (`/`)
- **하나의 채팅방에서 1 → N개 AI 관점 운용:** 1:1 집중 연구부터 다중 AI 위원회(`Thẻ gọn` 요약 카드 ↔ `Mở tất cả` 전체 펼침 전환, `#tag` 그룹 토글, `@역할` / `@#태그` 호출, 배치 진행률 바)까지 UI 밀도가 자동 전환됩니다.
- **무상태(Ephemeral) 격리 및 교차 계정 심판 (`X-DSH-Ephemeral` + `X-Exclude-Lanes`):** 모든 연구 턴에 `X-DSH-Ephemeral: 1`을 전송해 Bridge 워커의 기존 세션·모델·핸드오프 원장 오염을 차단하고, 블라인드 심판은 토론에 사용된 계정 목록을 `X-Exclude-Lanes`로 전달해 독립된 Google 계정을 우선 배정받습니다.
- **AI별 모델·역할·계정 고정(Pinning):** 각 AI에 고유한 `@핸들`, 역할 프롬프트, 모델(`gemini-neon`, `gemini-carbon`, `gemini-4-hydrogen` 또는 외부 API 모델)을 지정하고, 특정 Bridge 워커(`acc1`, `acc2`, …)에 직접 고정하거나 Gateway 자동 분산에 맡길 수 있습니다.
- **웹 기반 Profile Vault 로그인 & 계정 동적 추가:** 설정 Drawer에서 `Đăng nhập 1 lần` → `Xong & Sync`, 백그라운드 `Sync ngầm` / `Sync tất cả`, `+ Thêm acc` 동적 워커 생성, 계정 별칭 지정(`data/lane_names.json`), 원클릭 방 역할 추가를 수행합니다.
- **Deep Research 전문 PDF 추출 & 로컬 PDF 업로드:**
  - **arXiv**, **OpenAlex**(역인덱스 초록 복원 포함), **Wikipedia**를 병렬 검색한 뒤, 상위 3개 오픈 액세스 논문의 **PDF 전문**(최대 20페이지, `16,000`자)을 자동 다운로드·추출합니다.
  - 로컬 `.pdf` 파일 업로드(`POST /api/research/upload-pdf`, 최대 **15MB** / **25페이지**), 최대 5단계 리다이렉트 SSRF 검증을 거친 공개 URL 추출, 수동 텍스트 첨부를 지원하며 각 출처의 실제 깊이를 **`Toàn văn`**(`full_text`) / **`Chỉ Tóm tắt`**(`abstract_only`) / **`Trích đoạn`**(`excerpt`)로 표시합니다.
- **직접 근거 `[S#]` vs 추론 `[Suy luận từ S#]` 분리 및 정량 검증 (`app/verifier.py`):**
  - 프롬프트 규칙으로 원문 근거(`[S#]`)와 AI 계산·추론(`[Suy luận từ S#]`)을 엄격히 구분합니다.
  - 백엔드 검증기가 매 AI 응답마다 조작된 `[S#]`, 초록 전용 출처 인용, 수치 주장(`%`, 소수점, 표본 크기 `n=...`)을 원문과 결정론적으로 대조해 카드 하단 **Kiểm chứng tự động** 및 심판 감사 보고서에 제공합니다.
- **풍부한 학술 Markdown & 블라인드 심판:** GFM 표·제목·인용문·코드 블록 및 클릭 가능한 인용 배지를 렌더링하며, 양방향 익명화(`Ứng viên A/B/C…`), 3축 루브릭(`Evidence` / `Logic` / `Rebuttal`), **라이빙 아웃라인**, 5개 섹션 `.md` 보고서 내보내기를 제공합니다.

### 2. 독립형 비주얼 AI 플로우 맵 (`/flow`)
- **제로 커플링(Zero-Coupling) 실시간 시각화:** 채팅 화면과 DOM·상태를 공유하지 않고 백엔드의 append-only `events.jsonl` 및 SSE(`/api/rooms/{id}/events`)만 구독합니다.
- **단계별 DAG & 수렴 버스(Convergence Bus):** `입력 → N개 AI 위원회 → 심판 → 출력` 흐름을 좌→우로 배치하고, 1–4개 AI에서는 개별 베지어 곡선을, 5개 이상에서는 수직 **수렴 버스**와 호버 기반 상·하류 경로 강조를 제공합니다.
- **스윔레인 타임라인 & 단계별 리플레이:** 워커(`acc1..accN`)별 병렬 실행 시간을 간트 타임라인으로 확인하고, 이벤트 기록을 단계별 재생하며 오른쪽 인스펙터에서 원문 프롬프트를 검증합니다.

---

## 웹 인터페이스 단계별 사용 가이드

### 1단계 — AI 계정 및 공급자 연결 (`⚙️ Cài đặt`)
1. 브라우저에서 `http://127.0.0.1:3000`에 접속합니다.
2. 오른쪽 상단 **설정(톱니바퀴) 아이콘**을 눌러 AI 연결 상태를 확인합니다:
   - **Từng tài khoản Bridge**에서 `acc1`의 **Đăng nhập 1 lần**을 눌러 열린 브라우저에서 Google/Gemini 로그인을 완료한 뒤 **Xong & Sync**를 누릅니다.
   - 추가 Google 계정이 있으면 **Thêm acc** 버튼으로 `acc2`, `acc3` 워커를 생성해 각각 로그인할 수 있으며, 이후 재실행 시에는 **Sync ngầm** 또는 **Sync tất cả**로 3~5초 만에 무창(headless) 쿠키 동기화가 가능합니다.
   - **Tên**으로 계정 별칭을 지정하거나 **Test**로 연결 점검, **Gán vai**로 방에 즉시 AI 역할을 추가할 수 있습니다.
   - 또는 상단 **Thêm AI**로 **Gemini API Key**나 **OpenAI 호환 API**(OpenAI, DeepSeek, Groq, Ollama 등)를 등록합니다.
3. 동시 실행 수(`maxConcurrency`)를 정상 워커 수에 맞게 조정해 대기 병목을 줄입니다.

### 2단계 — 연구 방 관리 및 AI 위원회 역할 배치
1. 왼쪽 서랍(상단 좌측 버튼 또는 `[` 키)에서 방을 전환·생성·이름 변경·삭제하거나 AI 역할(`@handle`, 프롬프트, 모델 `gemini-carbon`/`gemini-neon`/`gemini-4-hydrogen`, `#tag`, 고정 `acc`)을 편집합니다.
2. 채팅 상단 **Phân công AI:** 바에서 활성화된 AI와 모델을 한눈에 확인하고, 오른쪽 **Trọng tài** 선택기에서 심판 모델 및 계정을 지정할 수 있습니다(`Acc: Tự động`은 토론 참여 계정을 자동 회피).

### 3단계 — 학술 출처 및 PDF 문서 적재 (`]` 키)
오른쪽 **Kho nguồn (`Nguồn (N)`)** 서랍(`]` 키)에서 `[S1]..[Sk]` 근거를 관리하며 3가지 방식으로 출처를 추가할 수 있습니다.
1. **자동 Deep Research:** 입력창에 연구 주제를 적고 **Deep Research** 버튼을 누르면 arXiv·OpenAlex·Wikipedia를 병렬 검색해 오픈 액세스 PDF 전문까지 자동 적재합니다.
2. **로컬 `.pdf` 업로드 / URL·텍스트 첨부:** 입력창 위 **URL / Tài liệu** 버튼을 눌러 컴퓨터의 **`.pdf` 파일 선택(최대 15MB, 25페이지)**, 공개 URL 입력, 또는 발췌 텍스트 직접 입력 후 **Thêm vào Kho nguồn**을 누릅니다.
3. **근거 깊이 배지 확인:** 각 `[S#]` 카드의 **`Toàn văn`**(전문 추출), **`Chỉ Tóm tắt`**(초록만 확보), **`Trích đoạn`**(발췌문) 배지로 인용 가능 범위를 즉시 확인합니다.

### 4단계 — 질의, 교차 토론 및 심판 종합 실행
1. 긴 다중 라운드 연구에서는 입력창 상단의 **Tài liệu Chuyên sâu** 모드를 유지하는 것이 좋습니다(전문 문서 최대 `16,000`자, 대화 이력 `60,000`자 보존).
2. 원하는 방식으로 실행합니다:
   - **원클릭 전체 파이프라인 (`Chạy trọn quy trình`):** 주제 입력 후 클릭하면 출처 검색 → 독립 분석 → 교차 반박 → 블라인드 심판까지 순차 자동 실행됩니다.
   - **단계별 수동 제어:** 질문 입력 후 `Enter` / **Gửi** (`@역할` 또는 `@#태그` 자동완성으로 특정 AI 지정 호출 가능) → **Tự tranh luận vòng tiếp**으로 상호 반박 → **Trọng tài chốt**으로 루브릭 및 보고서 생성.
   - 실행 중에는 언제든 진행 표시줄의 **Dừng** 버튼으로 진행 중인 HTTP 요청을 즉시 중단할 수 있습니다.

### 5단계 — 인용 검증 확인 및 플로우 맵 관찰 (`/flow`)
- **근거 클릭 및 자동 검증 확인:** 본문의 `[S#]` 배지를 클릭하면 오른쪽 서랍의 해당 출처로 스크롤·강조됩니다. 원문 기반 `[S#]`과 추론 `[Suy luận · S#]`을 구분해 읽고, 각 카드 하단의 **Kiểm chứng tự động**(`Số liệu khớp: X/Y`)에서 수치 대조 결과를 확인합니다.
- **상단 4개 탭 활용:** **Phòng chat** · **So sánh**(2–4개 AI 나란히 비교, `Ẩn danh` 블라인드 모드 지원) · **Báo cáo**(5개 섹션 보고서 및 `.md` 다운로드) · **Kiểm chứng**(턴별 원문 프롬프트, Fallback 경고, `events.jsonl` 다운로드).
- **비주얼 플로우 맵 (`Flow Map` → `/flow`):** 단계별 실행 그래프와 워커별 간트 차트(**Làn thời gian**)를 실시간 또는 단계별 재생 모드로 확인합니다.

---

## 디렉터리 구조

```text
research_ai_web/
├── app/                         # Python FastAPI 백엔드 (:3000) — 단일 책임 10개 모듈
│   ├── main.py                  # FastAPI 앱 팩토리, API 마운트 및 dist/ SPA 서빙
│   ├── config.py                # .env 기반 Settings 설정
│   ├── bridge.py                # 무상태 BridgeClient (X-DSH-Ephemeral: 1), 재시도 & JSON 복구
│   ├── providers.py             # ProviderStore (Bridge / Gemini API / OpenAI 호환) & LaneNameStore
│   ├── research.py              # arXiv/OpenAlex/Wikipedia 병렬 검색, OA PDF 전문 업그레이드 & SSRF 방어
│   ├── verifier.py              # [S#] vs [Suy luận từ S#] 구분 및 수치 정합성 결정론적 검증기
│   ├── prompts.py               # 다중 라운드 컨텍스트 압축 (60,000자 심층 예산) & 인용 규칙 생성기
│   ├── judge.py                 # 양방향 익명화 심판, 루브릭 산출 & 교차 계정 라우팅 (X-Exclude-Lanes)
│   ├── routes.py                # 얇은 HTTP/SSE 라우터 (/api/*, /api/research/upload-pdf) & 호환성 재수출
│   └── storage.py               # 원자적 디스크 저장소 (meta.json, sources.json, events.jsonl) & SSE
├── src/                         # React 19 + TypeScript + Tailwind v4 프론트엔드
│   ├── App.tsx                  # 이중 인터페이스 라우터 (/ 및 /flow) + 탭 간 테마 동기화
│   ├── lab/                     # Research Lab UI (ResearchLabApp, GroupFeed, MarkdownText, Composer, Drawers, SecondaryViews)
│   ├── flow/                    # 독립형 Flow Map UI (FlowMapApp, FlowCanvasSvg, SwimlaneView)
│   ├── utils/                   # API 클라이언트, 테마/내보내기 유틸리티, 레인 포맷터
│   ├── presets.ts               # 기본 1 AI / 2 AI 방 생성 템플릿
│   └── types.ts                 # 공용 TypeScript 인터페이스
├── tests/
│   └── test_backend.py          # 통합·단위 테스트 27개 (pytest)
├── docs/
│   ├── ARCHITECTURE.md / .ko.md / .vi.md
│   └── ALGORITHMS_AND_RESEARCH.md / .ko.md / .vi.md
├── public/assets/aistudio/      # UI/UX 및 Flow Map 설계 명세 PDF
├── requirements.txt             # Python 의존성 (pypdf 포함)
├── package.json                 # React + Vite + TypeScript 의존성
├── .env.example                 # 환경 변수 예시
├── README.md                    # 영문 안내서 (English)
├── README.ko.md                 # 한국어 안내서 (현재 문서)
└── README.vi.md                 # 베트남어 안내서 (Tiếng Việt)
```

---

## 빠른 시작

### 사전 요구 사항
- **Python 3.12+**
- **Node.js 22+** (Vite 8 프론트엔드 빌드 필수)
- **AI 백엔드 (택 1 또는 병행):**
  - 로컬 다중 계정 **DSH Gemini Bridge**([Khai-1711/dsh-gemini-bridge](https://github.com/Khai-1711/dsh-gemini-bridge)) (`http://127.0.0.1:10000`), **및/또는**
  - **설정(Cài đặt)** 화면에서 추가하는 **Gemini API 키** / **OpenAI 호환 엔드포인트**

### 1. 의존성 설치 및 프론트엔드 빌드 (`webchat/` 내부)
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

### 2. 환경 설정 및 실행
```bash
cp .env.example .env
python -m app.main
```
*(상위 통합 워크스페이스에서 `bridge/`와 함께 기동할 경우 루트에서 `python start.py`를 실행하면 Gateway, `acc1..N`, WebChat을 한 번에 시작할 수 있습니다.)*

브라우저 접속:
- **리서치 랩:** `http://127.0.0.1:3000`
- **비주얼 AI 플로우 맵:** `http://127.0.0.1:3000/flow`

### 3. 자동 테스트 및 타입 검사
```bash
pytest -v
npx tsc --noEmit
```

---

## 보안 및 개인정보 보호

- **로컬 비밀 정보 격리:** 채팅 방 기록(`data/rooms/`), API 키(`data/providers.json`), 계정 별칭(`data/lane_names.json`), `.env` 파일은 `.gitignore`로 Git 추적이 차단되며 API 키는 항상 마스킹(`AIza...9x2Q`)됩니다.
- **무상태 Bridge 격리 (`X-DSH-Ephemeral: 1`):** 연구 요청은 Bridge 워커의 기존 채팅 세션·모델 기본값·핸드오프 원장을 읽거나 수정하지 않습니다.
- **다단계 SSRF 방어 (`app/research.py`):** 비-HTTP(S) 스킴, 루프백·사설·링크로컬 IP 및 `.local`/`.internal` 호스트를 DNS 해석 전후와 최대 5단계 HTTP `Location` 리다이렉트마다 재검증합니다.
- **안전한 로컬 PDF 업로드:** `/api/research/upload-pdf`는 **15MB** 상한과 `%PDF-` 서명을 검증하며, 텍스트 레이어가 없는 이미지 스캔 PDF는 명확한 오류로 거부합니다.
- **루프백 전용 Fail-Closed 고정 라우팅:** `/v1/lanes`에서 해석된 워커 직접 호출은 루프백 호스트만 허용하며 비활성 계정 지정 시 `HTTP 502`를 반환합니다.

---

## 검증된 테스트 현황 (`tests/test_backend.py`)

`pytest -v` — **27/27 통과**:
- **Bridge 라우팅 & 무상태 격리:** 단일 사용자 프롬프트 병합, 워커/게스트 상태 집계, `429` 백오프 재시도, 계정 별칭 저장 및 Fail-Closed 고정 라우팅, `X-DSH-Ephemeral: 1` 및 `X-Exclude-Lanes` 검증
- **Profile Vault 프록시:** 상태 병합 및 중복 계정 감지, 로그인/동기화 Origin·페이로드 전달, 오류 시 `502` 전파
- **다중 라운드 심층 컨텍스트:** Round 0 이력 배제, Round 1 동료 전체 맥락 전달, `60,000`자 심층 이력 예산 및 과거 턴 압축, 연구 문서 전문 보존
- **블라인드 심판 & JSON 복구:** 코드 펜스·문법 오류 복구, 출처 발췌·검증 보고서 주입, 누락 점수 폴백 경고, 양방향 익명화·실명 복원
- **학술 검색, PDF, SSRF & 인용 검증기:** 루프백/사설 IP 차단, 다단계 리다이렉트 SSRF 차단, 학술 질의 정규화, arXiv 오픈 액세스 PDF 전문 업그레이드, 로컬 PDF 추출 및 비정상 바이트 거부, 조작 수치·추론 분리 검증(`verifier.py`)
- **저장소 & 공급자:** 방 CRUD 및 `events.jsonl` 내보내기, API 키 마스킹 및 모델 목록 조회, 빈 저장소 클린 초기화
