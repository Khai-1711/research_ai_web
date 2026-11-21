# Research AI Web — Phòng Nghiên Cứu Đa AI & Bản Đồ Luồng Trực Quan

> 🌐 **Ngôn ngữ:** [English](README.md) | [한국어](README.ko.md) | **Tiếng Việt**
>
> 📚 **Tài liệu chuyên sâu:** [Kiến trúc Hệ thống](docs/ARCHITECTURE.vi.md) · [Thuật toán & Bài nghiên cứu tham khảo](docs/ALGORITHMS_AND_RESEARCH.vi.md)
>
> 🔗 **Kho mã nguồn:** https://github.com/Khai-1711/research_ai_web · **Bridge đi kèm:** https://github.com/Khai-1711/dsh-gemini-bridge

**Research AI Web** là không gian nghiên cứu đa góc nhìn AI chạy hoàn toàn cục bộ (local-first), đi kèm bản đồ trực quan hóa luồng dữ liệu theo thời gian thực. Hệ thống kết hợp **Phòng Nghiên cứu thích ứng 1 → N AI** (`http://127.0.0.1:3000`), **Bản đồ Luồng AI trực quan độc lập** (`http://127.0.0.1:3000/flow`), bộ tìm kiếm học thuật mở không cần API key (**arXiv**, **OpenAlex**, **Wikipedia** và trích xuất URL/PDF chống SSRF), và hỗ trợ cắm đa nguồn AI: **DSH Gemini Bridge** đa tài khoản (`acc1..accN`), **Gemini API chính thức**, hoặc bất kỳ API chuẩn **OpenAI-compatible** nào (OpenAI, DeepSeek, Groq, Ollama, llama.cpp).

---

## Tính năng nổi bật

### 1. Phòng Nghiên cứu Đa Góc Nhìn AI (`/`)
- **Linh hoạt 1 → N góc nhìn AI trong cùng 1 phòng:** Tự động đổi mật độ hiển thị từ nghiên cứu 1-1 (mở toàn văn thoáng mắt) tới hội đồng nhiều AI (thẻ rút gọn 2 dòng kết luận, bật/tắt theo nhóm `#tag`, gọi đích danh `@vai` / `@#nhóm`, thanh tiến độ gom đợt).
- **Chọn riêng Model, Vai trò & Ghim cứng Tài khoản Bridge (acc):** Mỗi AI có `@tên_gọi`, chỉ dẫn vai trò, model riêng (`gemini-neon`, `gemini-carbon`, `gemini-4-hydrogen` hoặc model từ API Key), và có thể **ghim cứng vào từng tài khoản Bridge cụ thể** (`acc1`, `acc2`, `acc3`, …) hoặc để Gateway tự chia tải.
- **Tự đặt tên mọi thành phần:** Đổi tên gợi nhớ cho từng `acc1..accN` (lưu tại `data/lane_names.json`), đổi `@tên_AI`/vai trò và đổi tên phòng chat ngay tại chỗ.
- **Phản biện chéo & Trọng tài ẩn danh (Blind Judge):** Trả lời độc lập Vòng 0 → Phản biện chéo các vòng tiếp → **Trọng tài ẩn danh** (che tên thành `Ứng viên A/B/C`) xuất bảng điểm Rubric động, **Dàn ý sống** (Đồng thuận / Mâu thuẫn / Lỗ hổng) và Báo cáo Markdown 5 mục.
- **Deep Research học thuật không cần API Key:** Tìm kiếm song song trên **arXiv**, **OpenAlex**, **Wikipedia** cùng trích xuất URL/PDF (`pypdf`), lưu thành Kho nguồn `[S1]..[Sk]` có siêu liên kết kiểm chứng, bộ **Citation Verifier** xác minh mã trích dẫn và Nhật ký kiểm chứng (`events.jsonl`).
- **Hệ màu Kép biên tập:** Chế độ **Sáng ấm** kiểu sổ tay nghiên cứu (`#F7F5F0` / `#1F6F63`) và chế độ **Tối Quái Dị — Nocturnal Oddity** (`#100D16` / `#C2F542`) đồng bộ tức thì giữa các tab.

### 2. Bản đồ Luồng AI Trực quan Độc lập (`/flow`)
- **Tách biệt hoàn toàn (Zero Coupling):** Không chia sẻ DOM hay trạng thái nội bộ với giao diện Chat; chỉ lắng nghe SSE (`/api/rooms/{id}/events`) từ cùng tệp sự kiện append-only `events.jsonl`.
- **Đồ thị Chặng & Trục hội tụ (Convergence Bus):** Bố trí chặng trái→phải (`Đầu vào → Hội đồng N AI → Trọng tài → Trả về Bạn`), tự chuyển từ đường cong Bezier riêng lẻ (1–4 AI) sang **Trục hội tụ dọc** (5+ AI) kèm rê chuột tô sáng tuyến thượng/hạ nguồn.
- **Làn thời gian (Swimlane) & Phát lại từng bước:** Theo dõi thời gian chạy song song trên từng `acc1..accN` dạng Gantt, tua lại từng bước và kiểm tra prompt thô ở ngăn phải không che khuất nút.

---

## Cấu trúc thư mục

```text
research_ai_web/
├── app/                         # Backend Python FastAPI (:3000)
│   ├── main.py                  # Điểm vào FastAPI, gắn /api/* và phục vụ SPA
│   ├── config.py                # Cấu hình Settings nạp từ .env
│   ├── bridge.py                # BridgeClient stateless, retry/backoff, gọi thẳng acc ghim & sửa JSON
│   ├── providers.py             # ProviderStore (Bridge / Gemini API / OpenAI-compat) & LaneNameStore
│   ├── research.py              # Tìm kiếm song song arXiv / OpenAlex / Wikipedia + đọc URL/PDF chống SSRF
│   ├── routes.py                # REST & SSE API, điều phối hội đồng AI, Trọng tài ẩn danh & kiểm chứng [S#]
│   └── storage.py               # Lưu trữ nguyên tử trên đĩa (meta.json, sources.json, events.jsonl) & SSE
├── src/                         # Frontend React 19 + TypeScript + Tailwind v4
│   ├── App.tsx                  # Bộ định tuyến 2 giao diện (/ và /flow) + đồng bộ chủ đề giữa các tab
│   ├── lab/                     # Giao diện Research Lab (Chat, So sánh, Báo cáo, Kiểm chứng, Ngăn trái/phải/Cài đặt)
│   ├── flow/                    # Giao diện Flow Map độc lập (FlowMapApp, FlowCanvasSvg, SwimlaneView)
│   ├── utils/                   # API client, lưu tùy chọn/xuất Markdown, định dạng tên acc
│   ├── presets.ts               # Mẫu khởi tạo phòng 1 AI và 2 AI
│   └── types.ts                 # Kiểu dữ liệu TypeScript dùng chung
├── tests/
│   └── test_backend.py          # 10 integration & security tests (pytest)
├── docs/
│   ├── ARCHITECTURE.md          # Kiến trúc hệ thống (EN)
│   ├── ARCHITECTURE.ko.md       # Kiến trúc hệ thống (KO)
│   ├── ARCHITECTURE.vi.md       # Kiến trúc hệ thống (VI)
│   ├── ALGORITHMS_AND_RESEARCH.md     # Thuật toán & bài nghiên cứu tham khảo (EN)
│   ├── ALGORITHMS_AND_RESEARCH.ko.md  # Thuật toán & bài nghiên cứu tham khảo (KO)
│   └── ALGORITHMS_AND_RESEARCH.vi.md  # Thuật toán & bài nghiên cứu tham khảo (VI)
├── public/assets/aistudio/      # Tài liệu PDF đặc tả UI/UX và Flow Map
├── requirements.txt             # Thư viện Python
├── package.json                 # Thư viện React + Vite + TypeScript
├── .env.example                 # File cấu hình mẫu
├── README.md                    # Giới thiệu tiếng Anh (English)
├── README.ko.md                 # Giới thiệu tiếng Hàn (한국어)
└── README.vi.md                 # Giới thiệu tiếng Việt (file này)
```

---

## Khởi chạy nhanh

### Yêu cầu môi trường
- **Python 3.12+**
- **Node.js 22+** (để build giao diện React)
- **Nguồn AI (chọn 1 hoặc dùng song song):**
  - Cụm **DSH Gemini Bridge** đa tài khoản ([Khai-1711/dsh-gemini-bridge](https://github.com/Khai-1711/dsh-gemini-bridge)) đang chạy tại `http://127.0.0.1:10000`, **và/hoặc**
  - **Gemini API Key** / **API chuẩn OpenAI** (OpenAI, DeepSeek, Groq, Ollama, llama.cpp) nạp trực tiếp trong ngăn **Cài đặt**.

### 1. Cài thư viện & Build giao diện
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

### 2. Cấu hình & Chạy máy chủ
```bash
cp .env.example .env
python -m app.main
```

Mở trên trình duyệt:
- **Phòng Nghiên cứu (Research Lab):** `http://127.0.0.1:3000`
- **Bản đồ Luồng AI (Flow Map):** `http://127.0.0.1:3000/flow`

### 3. Chạy kiểm thử tự động & kiểm tra kiểu
```bash
pytest -v
npx tsc --noEmit
```

---

## An toàn & Bảo mật

- **Cô lập bí mật cục bộ:** Lịch sử phòng (`data/rooms/`), API key (`data/providers.json`), tên acc tự đặt (`data/lane_names.json`) và các tệp `.env` được chặn commit trong `.gitignore`. Toàn bộ API key được che (`AIza...9x2Q`) trước khi trả ra giao diện.
- **Chống SSRF 2 tầng:** Mọi URL nạp vào Deep Research được kiểm tra dải IP công khai (chặn loopback, mạng nội bộ, link-local) cả trước khi phân giải DNS lẫn sau khi nhận chuyển hướng `Location` (`app/research.py`).
- **Ghim acc khóa Loopback & Fail-Closed:** Địa chỉ worker tra qua `/v1/lanes` bắt buộc thuộc loopback (`127.0.0.1` / `localhost` / `::1`); nếu acc được ghim đang TẮT thì trả lỗi `HTTP 502` rõ ràng thay vì tự nhảy âm thầm sang acc khác.

---

## Kiểm thử tự động đã xác minh (`tests/test_backend.py`)

`pytest -v` — **10/10 passed**:
1. Biên dịch prompt stateless 1 tin nhắn `user`
2. Trích xuất & sửa JSON chịu lỗi có khung code và phẩy thừa
3. Chặn SSRF đối với địa chỉ loopback, nội bộ và `file://`
4. Đếm worker khỏe trên Gateway & phát hiện chế độ Khách (Guest Mode)
5. Đọc header `X-Gateway-Lane`/`X-Actual-Model`/`X-Fallback-From` và tự retry `429`
6. Giải ẩn danh Trọng tài & tự phục hồi JSON tổng hợp
7. CRUD phòng nghiên cứu và xuất `events.jsonl` append-only
8. Che API key bí mật và tự phát hiện danh sách model thật
9. Khởi tạo 1 phòng trống sạch khi thư mục trống (không chèn dữ liệu mẫu)
10. Đổi tên tài khoản (`PATCH /api/lanes/{id}`) và định tuyến thẳng tới acc được ghim (fail-closed khi acc TẮT)
