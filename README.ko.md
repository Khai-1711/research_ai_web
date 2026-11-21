# Research AI Web — 멀티 에이전트 연구실 & 비주얼 AI 플로우 맵

> 🌐 **언어:** [English](README.md) | **한국어** | [Tiếng Việt](README.vi.md)
>
> 📚 **문서:** [시스템 아키텍처](docs/ARCHITECTURE.ko.md) · [알고리즘 및 참고 연구 논문](docs/ALGORITHMS_AND_RESEARCH.ko.md)
>
> 🔗 **저장소:** https://github.com/Khai-1711/research_ai_web · **연동 Bridge:** https://github.com/Khai-1711/dsh-gemini-bridge

**Research AI Web**은 로컬 우선(Local-first) 방식의 다중 관점 AI 연구 워크스페이스이자 실시간 데이터 흐름 시각화 도구입니다. 적응형 **1 → N AI 리서치 랩**(`http://127.0.0.1:3000`), 완전히 분리된 **비주얼 AI 플로우 맵**(`http://127.0.0.1:3000/flow`), API 키 없는 공개 학술 검색(**arXiv**, **OpenAlex**, **Wikipedia** 및 SSRF 방어가 적용된 URL/PDF 추출), 그리고 다중 계정 **DSH Gemini Bridge**(`acc1..accN`), **Gemini 공식 API**, **OpenAI 호환 API**(OpenAI, DeepSeek, Groq, Ollama, llama.cpp) 연동을 지원합니다.

---

## 핵심 기능

### 1. 적응형 멀티 에이전트 리서치 랩 (`/`)
- **하나의 채팅방에서 1 → N개 AI 관점 운용:** 1:1 집중 연구(전문 펼침 모드)부터 다중 AI 위원회(2줄 핵심 결론 카드, `#tag` 그룹 토글, `@역할` / `@#태그` 지정 호출, 배치 진행률 바)까지 UI 밀도가 자동 전환됩니다.
- **AI별 모델·역할·계정 고정(Pinning):** 각 AI에 고유한 `@이름`, 역할 프롬프트, 모델(`gemini-neon`, `gemini-carbon`, `gemini-4-hydrogen` 또는 외부 API 모델)을 지정하고, 특정 로컬 Bridge 워커(`acc1`, `acc2`, `acc3`, …)에 직접 고정하거나 Gateway 자동 부하 분산에 맡길 수 있습니다.
- **자유로운 사용자 지정 이름:** 개별 Bridge 계정(`acc1..accN`, `data/lane_names.json`에 영구 저장), AI `@핸들`/역할, 연구 방 제목을 화면에서 바로 변경할 수 있습니다.
- **다중 라운드 교차 반박 & 블라인드 심판(Blind Judge):** 독립 답변(Round 0) → 교차 토론 라운드 → **익명화 심판**(`후보 A/B/C` 마스킹)을 통해 동적 루브릭 점수표, **라이빙 아웃라인**(합의점 / 모순점 / 정보 공백), 5개 섹션의 Markdown 보고서를 생성합니다.
- **API 키 없는 공개 학술 Deep Research:** **arXiv**, **OpenAlex**, **Wikipedia**를 병렬 조회하고 공개 URL 및 PDF(`pypdf`)를 추출하여 검증 가능한 `[S1]..[Sk]` 출처 저장소, 결정론적 **인용 검증기(Citation Verifier)**, 감사 로그(`events.jsonl`)를 제공합니다.
- **듀얼 에디토리얼 테마:** *따뜻한 연구 노트* 라이트 모드(`#F7F5F0` / `#1F6F63`)와 *Nocturnal Oddity* 다크 모드(`#100D16` / `#C2F542`)가 탭 간 자동 동기화됩니다.

### 2. 독립형 비주얼 AI 플로우 맵 (`/flow`)
- **제로 커플링(Zero-Coupling) 실시간 시각화:** 채팅 화면과 DOM/상태를 공유하지 않고 백엔드의 append-only `events.jsonl` 및 SSE(`/api/rooms/{id}/events`)만 구독합니다.
- **단계별 DAG & 수렴 버스(Convergence Bus):** `입력 → N개 AI 위원회 → 심판 → 출력` 흐름을 좌→우로 배치하며, 1–4개 AI에서는 개별 베지어 곡선을, 5개 이상에서는 수직 **수렴 버스**와 호버 기반 상·하류 경로 강조를 적용합니다.
- **스윔레인 타임라인 & 단계별 리플레이:** 워커(`acc1..accN`)별 병렬 실행 시간을 간트 타임라인으로 확인하고, 이벤트 기록을 단계별 재생하며 오른쪽 인스펙터에서 원문 프롬프트를 검증합니다.

---

## 디렉터리 구조

```text
research_ai_web/
├── app/                         # Python FastAPI 백엔드 (:3000)
│   ├── main.py                  # FastAPI 진입점, API 라우터 및 SPA 서빙
│   ├── config.py                # .env 기반 Settings 설정
│   ├── bridge.py                # Stateless BridgeClient, 재시도, 고정 레인 직접 라우팅 & JSON 복구
│   ├── providers.py             # ProviderStore (Bridge / Gemini API / OpenAI 호환) & LaneNameStore
│   ├── research.py              # arXiv / OpenAlex / Wikipedia 병렬 검색 + SSRF 방어 URL/PDF 파서
│   ├── routes.py                # REST & SSE API, 관점 오케스트레이션, 블라인드 심판 & 인용 검증
│   └── storage.py               # 원자적 디스크 저장소 (meta.json, sources.json, events.jsonl) & SSE
├── src/                         # React 19 + TypeScript + Tailwind v4 프론트엔드
│   ├── App.tsx                  # 이중 인터페이스 라우터 (/ 및 /flow) + 탭 간 테마 동기화
│   ├── lab/                     # Research Lab UI (채팅, 비교, 보고서, 감사, 좌/우/설정 드로어)
│   ├── flow/                    # 독립형 Flow Map UI (FlowMapApp, FlowCanvasSvg, SwimlaneView)
│   ├── utils/                   # API 클라이언트, 테마/내보내기 유틸리티, 레인 포맷터
│   ├── presets.ts               # 기본 1 AI / 2 AI 방 생성 템플릿
│   └── types.ts                 # 공용 TypeScript 인터페이스
├── tests/
│   └── test_backend.py          # 통합·보안 테스트 10개 (pytest)
├── docs/
│   ├── ARCHITECTURE.md          # 시스템 아키텍처 (EN)
│   ├── ARCHITECTURE.ko.md       # 시스템 아키텍처 (KO)
│   ├── ARCHITECTURE.vi.md       # 시스템 아키텍처 (VI)
│   ├── ALGORITHMS_AND_RESEARCH.md     # 알고리즘 및 참고 논문 (EN)
│   ├── ALGORITHMS_AND_RESEARCH.ko.md  # 알고리즘 및 참고 논문 (KO)
│   └── ALGORITHMS_AND_RESEARCH.vi.md  # 알고리즘 및 참고 논문 (VI)
├── public/assets/aistudio/      # UI/UX 및 Flow Map 설계 명세 PDF
├── requirements.txt             # Python 의존성
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
- **Node.js 22+** (프론트엔드 빌드용)
- **AI 백엔드 (택 1 또는 병행):**
  - 로컬 다중 계정 **DSH Gemini Bridge**([Khai-1711/dsh-gemini-bridge](https://github.com/Khai-1711/dsh-gemini-bridge)) (`http://127.0.0.1:10000`), **및/또는**
  - 설정(Settings) 화면에서 추가하는 **Gemini API 키** / **OpenAI 호환 엔드포인트**(OpenAI, DeepSeek, Groq, Ollama, llama.cpp)

### 1. 의존성 설치 및 프론트엔드 빌드
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

- **로컬 비밀 정보 격리:** 채팅 방 기록(`data/rooms/`), API 키(`data/providers.json`), 계정 별칭(`data/lane_names.json`), `.env` 파일은 `.gitignore`로 Git 추적이 차단되며, 모든 API 키는 응답 시 마스킹(`AIza...9x2Q`)됩니다.
- **2단계 SSRF 방어:** Deep Research URL 입력은 DNS 해석 전후 및 HTTP `Location` 리다이렉트 시 모두 루프백·사설·링크로컬 IP 대역 여부를 검증합니다(`app/research.py`).
- **루프백 전용 고정 라우팅:** `/v1/lanes`에서 해석된 워커 직접 호출은 루프백 호스트(`127.0.0.1` / `localhost` / `::1`)만 허용하며, 고정 계정이 비활성일 경우 다른 계정으로 몰래 우회하지 않고 명시적 `HTTP 502` 오류를 반환합니다.

---

## 검증된 테스트 현황 (`tests/test_backend.py`)

`pytest -v` — **10/10 통과**:
1. Stateless 시스템+사용자 프롬프트 병합
2. 코드 펜스·문법 오류를 견디는 복원력 있는 JSON 파싱
3. 루프백·사설·`file://` URL SSRF 차단
4. Gateway 워커 수 집계 및 게스트 모드 감지
5. 단일 사용자 메시지 전송, `X-Gateway-Lane` 헤더 전파 및 `429` 재시도
6. 블라인드 심판 별칭 복원 및 손상된 JSON 복구
7. 연구 방 CRUD 및 append-only `events.jsonl` 내보내기
8. 프로바이더 API 키 마스킹 및 실시간 모델 목록 조회
9. 예시 데이터 없는 깨끗한 빈 방 초기화
10. 계정 별칭 저장(`PATCH /api/lanes/{id}`) 및 고정 레인 Fail-Closed 직접 라우팅
