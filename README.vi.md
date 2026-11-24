# Research AI Web — Phòng Nghiên Cứu Đa AI & Bản Đồ Luồng Trực Quan

> 🌐 **Ngôn ngữ:** [English](README.md) | [한국어](README.ko.md) | **Tiếng Việt**
>
> 📚 **Tài liệu chuyên sâu:** [Kiến trúc Hệ thống](docs/ARCHITECTURE.vi.md) · [Thuật toán & Bài nghiên cứu tham khảo](docs/ALGORITHMS_AND_RESEARCH.vi.md)
>
> 🔗 **Kho mã nguồn:** https://github.com/Khai-1711/research_ai_web · **Bridge đi kèm:** https://github.com/Khai-1711/dsh-gemini-bridge

**Research AI Web** là không gian nghiên cứu đa góc nhìn AI chạy hoàn toàn cục bộ (*local-first*), đi kèm bản đồ trực quan hóa luồng dữ liệu theo thời gian thực. Hệ thống kết hợp **Phòng Nghiên cứu thích ứng 1 → N AI** (`http://127.0.0.1:3000`), **Bản đồ Luồng AI trực quan độc lập** (`http://127.0.0.1:3000/flow`), bộ truy xuất học thuật mở không cần API key (**arXiv**, **OpenAlex**, **Wikipedia**, tự nâng cấp bài mở lên PDF toàn văn, trích xuất URL/PDF chống SSRF 5 chặng, nạp `.pdf` từ máy lên tới 15 MB), tầng **Kiểm chứng định lượng tự động (`verifier.py`)**, và hỗ trợ cắm đa nguồn AI: **DSH Gemini Bridge** đa tài khoản cô lập phi trạng thái (`acc1..accN`), **Gemini API chính thức**, hoặc bất kỳ API chuẩn **OpenAI-compatible** nào (OpenAI, DeepSeek, Groq, Ollama, llama.cpp).

---

## Tính năng nổi bật

### 1. Phòng Nghiên cứu Đa Góc Nhìn AI (`/`)
- **Linh hoạt 1 → N góc nhìn AI trong cùng 1 phòng:** Tự động đổi mật độ hiển thị từ nghiên cứu 1-1 (mở toàn văn thoáng mắt) tới hội đồng nhiều AI (chuyển giữa `Thẻ gọn` và `Mở tất cả`, bật/tắt từng vai hoặc theo nhóm `#tag`, gọi đích danh `@vai` / `@#nhóm`, thanh tiến độ gom đợt).
- **Cô lập phiên & Trọng tài chéo tài khoản (`X-DSH-Ephemeral` + `X-Exclude-Lanes`):** Mỗi lượt hỏi gửi header `X-DSH-Ephemeral: 1` để các luồng Gemini Web không rò rỉ ngữ cảnh hay ledger giữa các vai/phòng khác nhau; đồng thời Trọng tài tự động tránh các tài khoản `acc` đã tham gia tranh luận nếu còn tài khoản khỏe khác.
- **Chọn riêng Model, Vai trò & Ghim cứng Tài khoản Bridge (`acc`):** Mỗi AI có `@tên_gọi`, chỉ dẫn vai trò, model riêng (`gemini-neon`, `gemini-carbon`, `gemini-4-hydrogen` hoặc model từ API Key), và có thể **ghim cứng vào từng tài khoản Bridge cụ thể** (`acc1`, `acc2`, `acc3`, …) hoặc để Gateway tự cân bằng tải.
- **Quản lý Profile Vault & Tự tạo luồng ngay trên Web:** Bấm `Đăng nhập 1 lần` → `Xong & Sync`, chạy `Sync ngầm` (hoặc `Sync tất cả`), bấm `+ Thêm acc` để tạo luồng `.env.accN` mới, đặt tên gợi nhớ (lưu tại `data/lane_names.json`) và gán thẳng vào phòng.
- **Deep Research Toàn văn PDF & Nạp PDF cục bộ:**
  - Tìm kiếm song song **arXiv**, **OpenAlex** (tái dựng abstract từ chỉ mục đảo ngược) và **Wikipedia**, đồng thời tự động tải & trích xuất **Toàn văn PDF** (tới 20 trang, `16.000` ký tự) cho tới 3 nguồn mở đầu bảng.
  - Hỗ trợ nạp trực tiếp tệp `.pdf` từ máy tính (`POST /api/research/upload-pdf`, tối đa **15 MB**, đọc tới **25 trang**), đính kèm URL công khai (kiểm tra SSRF tới 5 bước chuyển hướng) hoặc dán đoạn trích tay.
  - Gắn nhãn mức độ nguồn rõ ràng **`Toàn văn`** (`full_text`), **`Chỉ Tóm tắt`** (`abstract_only`), **`Trích đoạn`** (`excerpt`) để người dùng và Trọng tài biết độ sâu bằng chứng thật.
- **Tách bạch `[S#]` vs `[Suy luận từ S#]` & Kiểm chứng Định lượng (`app/verifier.py`):**
  - Mọi AI bắt buộc chỉ gắn `[S#]` khi dữ kiện xuất hiện trực tiếp trong nguồn và dùng `[Suy luận từ S#]` cho phần tính toán/suy diễn thêm.
  - Sau mỗi lượt AI, backend đối chiếu tất định số liệu (`%`, số thập phân, cỡ mẫu `n=...`), phát hiện mã `[S#]` bịa đặt và cảnh báo nếu trích dẫn từ nguồn chỉ có tóm tắt; kết quả kiểm chứng hiển thị ngay trong khung **Kiểm chứng tự động** dưới câu trả lời và đưa vào cho Trọng tài chấm điểm.
- **Hiển thị Markdown học thuật & Trọng tài ẩn danh (Blind Judge):** Kết xuất đầy đủ bảng GFM, tiêu đề, khối trích dẫn, code block, huy hiệu trích dẫn bấm để tô sáng nguồn; Trọng tài che tên thành `Ứng viên A/B/C…`, xuất bảng Rubric 3 trục (`Bằng chứng` / `Logic` / `Phản biện`), **Dàn ý sống** và Báo cáo 5 mục (tải `.md`).
- **Luồng Nghiên cứu Ưu tiên Giữ Kết nối (`X-DSH-Research-Mode: 1` + SSE Liveness):** Không còn cắt cứng 180 giây hay tự hạ model thông minh (`gemini-carbon` / `gemini-neon` xuống `gemini-4-hydrogen`) khi AI đang suy luận sâu; giao diện hiển thị trạng thái sống thực tế (`queued_lock` → `waiting_gemini` → `thinking` → `generating` kèm nhịp tim heartbeat).
- **Chia sẻ qua GitHub Pages tới Backend Cục bộ (`share-pages`):** Bạn bè (1–2 người) có thể mở giao diện tĩnh ngay trên GitHub Pages và kết nối an toàn tới backend đang chạy trên máy bạn qua HTTPS Tunnel (`python start.py share`) kèm Passcode tự sinh và khóa toàn bộ thao tác quản trị máy chủ.

### 2. Bản đồ Luồng AI Trực quan Độc lập (`/flow`)
- **Tách biệt hoàn toàn (Zero Coupling):** Không chia sẻ DOM hay trạng thái nội bộ với giao diện Chat; chỉ lắng nghe SSE (`/api/rooms/{id}/events`) từ cùng tệp sự kiện append-only `events.jsonl`.
- **Đồ thị Chặng & Trục hội tụ (Convergence Bus):** Bố trí chặng trái→phải (`Đầu vào → Hội đồng N AI → Trọng tài → Trả về Bạn`), tự chuyển từ đường cong Bezier riêng lẻ (1–4 AI) sang **Trục hội tụ dọc** (5+ AI) kèm rê chuột tô sáng tuyến thượng/hạ nguồn.
- **Làn thời gian (Swimlane) & Phát lại từng bước:** Theo dõi thời gian chạy song song trên từng `acc1..accN` dạng Gantt, tua lại từng bước và kiểm tra prompt thô ở ngăn phải không che khuất nút.

---

## Hướng dẫn sử dụng giao diện Web (Từ A–Z)

### Bước 1 — Khởi động & Kiểm tra kết nối AI (`⚙️ Cài đặt`)
1. Mở trình duyệt vào `http://127.0.0.1:3000`.
2. Nếu thanh cảnh báo phía trên báo chưa đăng nhập Cookie (Guest Mode) hoặc có tài khoản bị trùng nhau, bấm nút **Cài đặt** (biểu tượng bánh răng trên thanh đỉnh).
3. Trong mục **Nguồn AI đã kết nối → Từng tài khoản Bridge**:
   - Bấm **Đăng nhập 1 lần** ở `acc1`, đăng nhập Google/Gemini trong cửa sổ trình duyệt vừa mở rồi bấm **Xong & Sync**.
   - Nếu có thêm tài khoản Google khác, bấm **Thêm acc** (cạnh nút **Sync tất cả**) để tạo luồng `acc2`, `acc3`… và đăng nhập từng tài khoản độc lập. Ở các lần mở máy sau, chỉ cần bấm **Sync ngầm** hoặc **Sync tất cả** (~3–5 giây, không mở tab).
   - Bấm **Tên** để đặt tên gợi nhớ (vd `Acc Nghiên Cứu`, `Acc Phản Biện`), bấm **Test** để kiểm tra kết nối, hoặc bấm **Gán vai** để đưa luôn acc đó thành 1 AI trong phòng.
   - Hoặc bấm **Thêm AI** ở đầu mục để cắm **Gemini API Key** / **OpenAI-compatible** (OpenAI, DeepSeek, Groq, Ollama…).
4. Ở phía dưới ngăn **Cài đặt**, chỉnh **Số luồng chạy song song (`maxConcurrency`)** sao cho không vượt quá số `acc` đang khỏe nếu muốn chạy cùng lúc nhiều AI không phải xếp hàng.

### Bước 2 — Tạo Phòng & Phân công Hội đồng AI
1. Mở ngăn trái bằng biểu tượng cạnh chữ **Research Lab** (hoặc bấm phím `[`):
   - Tab phòng cho phép chọn phòng, đổi tên, xóa phòng hoặc tạo phòng mới từ mẫu gợi ý.
   - Tab góc nhìn (hoặc bấm thẳng vào các chip trên thanh **Phân công AI:** ngay trên khung chat) cho phép **thêm/sửa `@Tên_AI`**, chọn **Model** (`gemini-carbon` để lập luận sâu/kỹ thuật, `gemini-neon` để phân tích sâu, `gemini-4-hydrogen` cho tác vụ nhanh), chọn **Tài khoản Bridge ghim riêng** (`acc1`, `acc2`…) hoặc để **Tự động**, và bật/tắt theo từng vai hay theo cụm `#tag`.
2. Bên phải thanh **Phân công AI:** là bộ chọn **Model & Tài khoản cho Trọng tài** (`Acc: Tự động` sẽ tự động ưu tiên tài khoản khác với các AI vừa tranh luận để đảm bảo khách quan).

### Bước 3 — Nạp Tài liệu & Bằng chứng Học thuật vào Kho nguồn (`]`)
Mở ngăn phải bằng nút **Nguồn (N)** (hoặc phím `]`) để theo dõi các nguồn `[S1]..[Sk]`. Bạn có 3 cách nạp nguồn trước khi hỏi:
1. **Tìm nguồn học thuật tự động (`Deep Research`):** Gõ chủ đề hoặc câu hỏi nghiên cứu vào ô nhập rồi bấm nút **Deep Research** ngay phía trên khung nhập. Hệ thống tự truy vấn arXiv, OpenAlex, Wikipedia, tự tải toàn văn PDF cho các bài báo mở và nạp danh sách `[S#]` vào Kho nguồn lẫn khung chat.
2. **Nạp tệp PDF có sẵn trên máy hoặc dán URL/đoạn trích (`URL / Tài liệu`):**
   - Bấm nút **URL / Tài liệu** phía trên khung nhập.
   - Chọn **Chọn file PDF (.pdf) trên máy…** (hỗ trợ PDF có lớp chữ tới **15 MB**, trích xuất tới 25 trang), **hoặc** dán URL bài viết/arXiv/PDF công khai, **hoặc** dán trực tiếp tiêu đề & đoạn văn bản, rồi bấm **Thêm vào Kho nguồn**.
3. **Kiểm tra độ sâu từng nguồn:** Trong ngăn phải **Kho nguồn (N)**, chú ý huy hiệu cạnh `[S#]`:
   - **`Toàn văn`**: Đã có nội dung đầy đủ (PDF toàn văn / trang dài) để AI đối chiếu số liệu chi tiết.
   - **`Chỉ Tóm tắt`**: Mới có Abstract; AI không được bịa chi tiết ngoài phần tóm tắt.
   - Nút **In toàn bộ Kho nguồn vào Chat** dùng để chèn nhanh toàn bộ hồ sơ nguồn hiện tại thành tin nhắn hệ thống trong phòng.

### Bước 4 — Đặt câu hỏi, Thảo luận & Tổng hợp Trọng tài
1. Bật/tắt chế độ **Tài liệu Chuyên sâu** ↔ **Chế độ Súc tích** ngay phía trên ô nhập (mặc định nên giữ **Tài liệu Chuyên sâu** để các vòng sau giữ được hồ sơ nghiên cứu dài tới `16.000` ký tự/bài và lịch sử tới `60.000` ký tự).
2. Thực hiện theo 1 trong 2 cách:
   - **Cách A — Chạy 1 chạm (`Chạy trọn quy trình`):** Gõ đề tài nghiên cứu rồi bấm **Chạy trọn quy trình** → Hệ thống tự chạy lần lượt **Deep Research + nạp nguồn** → **Vòng phân tích độc lập** → **Phản biện chéo** → **Trọng tài chốt**.
   - **Cách B — Từng bước chủ động:**
     1. Nhập câu hỏi và bấm **Gửi** (hoặc nhấn `Enter`, dùng `Shift+Enter` để xuống dòng). Có thể gõ `@tên_AI` hoặc `@#nhóm` trong câu hỏi (có menu gợi ý tự động) để chỉ gọi đích danh các góc nhìn cần thiết.
     2. Bấm **Tự tranh luận vòng tiếp** để mọi AI đang bật đọc lập luận của nhau từ vòng trước và phản biện trực diện kẽ hở số liệu/logic.
     3. Bấm **Trọng tài chốt** để tổng hợp & chấm điểm toàn bộ phiên thảo luận.
   - Khi đang chạy, có thể bấm **Dừng** trên thẻ tiến độ bất cứ lúc nào để hủy ngay các lượt HTTP chưa xong.

### Bước 5 — Đọc, Kiểm chứng Kết quả & Quan sát Bản đồ Luồng (`/flow`)
- **Đọc & kiểm nguồn ngay trong Chat:**
  - Bấm trực tiếp vào huy hiệu `[S1]` trong câu trả lời để tự động mở ngăn phải và tô sáng đúng nguồn đó.
  - Phân biệt rõ thẻ `[S1]` (sự kiện/số liệu có thật trong nguồn) với thẻ `[Suy luận · S1]` (suy diễn/phép tính AI tự suy ra từ nguồn).
  - Mở hộp **Kiểm chứng tự động** dưới mỗi câu trả lời để xem số trích dẫn hợp lệ và tỷ lệ `Số liệu khớp: X/Y` do backend đối chiếu; bấm **Ghim vào Báo cáo**, **Hỏi riêng @…**, hoặc **Đưa vào So sánh** ngay cuối mỗi thẻ.
- **4 tab làm việc trên thanh đỉnh:**
  1. **Phòng chat**: Hội thoại đa góc nhìn (`Thẻ gọn` hoặc `Mở tất cả`) và thanh tìm ý / lọc theo `@vai`.
  2. **So sánh**: Đặt song song 2–4 góc nhìn theo từng vòng; hỗ trợ bật nút **Ẩn danh: BẬT/TẮT** để tự đọc mù trước khi nhìn tên AI.
  3. **Báo cáo**: Xem tổng hợp điều hành, **Kiểm chứng Toàn vẹn & Trích dẫn**, tranh luận còn mở, bảng điểm Rubric (`Bằng chứng` / `Logic` / `Phản biện` / `Tổng` — cảnh báo nhãn `Dự phòng` nếu Trọng tài trả thiếu điểm JSON) và bấm **Tải Báo cáo (.md)**.
  4. **Kiểm chứng**: Xem prompt thô đầy đủ từng AI đã nhận theo từng vòng, cảnh báo `Fallback` (nếu có) và bấm **Tải events.jsonl gốc**.
- **Quan sát trực quan trên Bản đồ Luồng (`Flow Map`):** Bấm nút **Flow Map** ở góc trên bên phải để mở `/flow`, xem sơ đồ chặng `Đầu vào → Hội đồng → Trọng tài → Trả về Bạn`, chuyển sang **Làn thời gian** để soi từng luồng `acc1..accN` chạy song song hay nối tiếp, hoặc tua lại từng sự kiện.

---

## Cấu trúc thư mục

```text
research_ai_web/
├── app/                         # Backend Python FastAPI (:3000) — 10 module đơn nhiệm vụ
│   ├── main.py                  # Điểm vào FastAPI, gắn /api/* và phục vụ SPA từ dist/
│   ├── config.py                # Cấu hình Settings nạp từ .env
│   ├── bridge.py                # BridgeClient stateless (X-DSH-Ephemeral: 1), retry/backoff, ghim acc & sửa JSON
│   ├── providers.py             # ProviderStore (Bridge / Gemini API / OpenAI-compat) & LaneNameStore
│   ├── research.py              # Tìm kiếm song song arXiv/OpenAlex/Wikipedia, nâng cấp PDF toàn văn, đọc URL/PDF
│   ├── verifier.py              # Kiểm chứng [S#] vs [Suy luận từ S#] và đối chiếu số liệu định lượng thuần Python
│   ├── prompts.py               # Quản lý ngân sách ngữ cảnh đa vòng (60.000 ký tự Chuyên sâu) & quy tắc viết [S#]
│   ├── judge.py                 # Trọng tài ẩn danh 2 chiều, tổng hợp điểm Rubric & tránh acc vừa tranh luận (X-Exclude-Lanes)
│   ├── routes.py                # Router HTTP mỏng (/api/*, /api/research/upload-pdf) tái xuất helper tương thích ngược
│   └── storage.py               # Lưu trữ nguyên tử trên đĩa (meta.json, sources.json, events.jsonl) & SSE
├── src/                         # Frontend React 19 + TypeScript + Tailwind v4
│   ├── App.tsx                  # Bộ định tuyến 2 giao diện (/ và /flow) + đồng bộ chủ đề giữa các tab
│   ├── lab/                     # Giao diện Research Lab (ResearchLabApp, GroupFeed, MarkdownText, Composer, Drawers, SecondaryViews)
│   ├── flow/                    # Giao diện Flow Map độc lập (FlowMapApp, FlowCanvasSvg, SwimlaneView)
│   ├── utils/                   # API client, lưu tùy chọn/xuất Markdown, định dạng tên acc
│   ├── presets.ts               # Mẫu khởi tạo phòng 1 AI và 2 AI
│   └── types.ts                 # Kiểu dữ liệu TypeScript dùng chung
├── tests/
│   └── test_backend.py          # 27 integration & unit tests (pytest)
├── docs/
│   ├── ARCHITECTURE.md / .ko.md / .vi.md
│   └── ALGORITHMS_AND_RESEARCH.md / .ko.md / .vi.md
├── public/assets/aistudio/      # Tài liệu PDF đặc tả UI/UX và Flow Map
├── requirements.txt             # Thư viện Python (kèm pypdf trích xuất PDF)
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
- **Node.js 22+** (để build giao diện React; Vite 8 yêu cầu Node 22+)
- **Nguồn AI (chọn 1 hoặc dùng song song):**
  - Cụm **DSH Gemini Bridge** đa tài khoản ([Khai-1711/dsh-gemini-bridge](https://github.com/Khai-1711/dsh-gemini-bridge)) đang chạy tại `http://127.0.0.1:10000`, **và/hoặc**
  - **Gemini API Key** / **API chuẩn OpenAI** (OpenAI, DeepSeek, Groq, Ollama, llama.cpp) nạp trực tiếp trong ngăn **Cài đặt**.

### 1. Cài thư viện & Build giao diện (trong `webchat/`)
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
*(Nếu dùng bộ khởi động hợp nhất ở thư mục cha chứa cả `bridge/` và `webchat/`, có thể chạy `python start.py` để bật cả Gateway, các worker `acc1..N` và WebChat cùng lúc.)*

Mở trên trình duyệt:
- **Phòng Nghiên cứu (Research Lab):** `http://127.0.0.1:3000`
- **Bản đồ Luồng AI (Flow Map):** `http://127.0.0.1:3000/flow`

### 3. Chạy kiểm thử tự động & kiểm tra kiểu
```bash
pytest -v
npx tsc --noEmit
```

### 4. Chia sẻ cho bạn bè dùng thử qua GitHub Pages (nhánh `share-pages`)
1. Đẩy nhánh `share-pages` lên GitHub; workflow [deploy-pages.yml](.github/workflows/deploy-pages.yml) tự động build `dist/` với đường dẫn tương đối (`base: './'`) lên `https://khai-1711.github.io/research_ai_web/`.
2. Tại thư mục gốc workspace trên máy bạn, chạy backend cục bộ (`python start.py`) và mở HTTPS Tunnel + mã Passcode trong terminal thứ 2:
   ```bash
   python start.py share
   ```
   *(Yêu cầu đã cài `cloudflared`; lệnh này tự tạo tệp `.share_token` nội bộ, kích hoạt bảo vệ trên cổng `:3000` và in sẵn **Link mời 1 chạm** dạng `https://khai-1711.github.io/research_ai_web/?api=<tunnel-url>#token=<passcode>` — hoặc mở **Cài đặt** ngay trên Web để bật/copy link.)*
3. Bạn bè chỉ cần mở Link mời trên trình duyệt là dùng chung được ngay mà không cần cài Python/Node; token nằm trong `#fragment` và tự xóa khỏi thanh địa chỉ sau khi lưu vào `localStorage`.

---

## An toàn & Bảo mật

- **Cô lập bí mật cục bộ:** Lịch sử phòng (`data/rooms/`), API key (`data/providers.json`), tên acc tự đặt (`data/lane_names.json`), `.share_token` và các tệp `.env` được chặn commit trong `.gitignore`. Toàn bộ API key được che (`AIza...9x2Q`) trước khi trả ra giao diện.
- **Bảo vệ Tunnel & Khóa quyền Máy chủ:** Middleware trong `app/main.py` phân biệt truy cập trực tiếp từ máy chủ với truy cập qua proxy/tunnel (`Cf-Connecting-Ip`, `X-Forwarded-For`, `Origin` ngoài): mọi yêu cầu từ xa thiếu `X-Share-Token` / `share_token` đều nhận `401`, và mọi API tác động lên máy chủ (mở trình duyệt đăng nhập cookie, `Sync ngầm`, tạo acc mới, thêm/xóa API key, xem `.share_token`) bị chặn cứng `403` từ xa.
- **Cô lập phiên Bridge (`X-DSH-Ephemeral: 1`):** Mỗi lượt nghiên cứu chạy độc lập hoàn toàn trên Bridge, không đọc/ghi vào sổ ghi nhớ hoặc tệp handoff của các tác vụ khác và không lưu đè trạng thái phiên chat.
- **Chống SSRF đa chặng:** Mọi URL nạp vào Deep Research hoặc tự tải PDF nguồn mở đều được kiểm tra dải IP công khai (chặn loopback, mạng nội bộ, link-local) trước khi kết nối và tại từng bước chuyển hướng `Location` tối đa 5 chặng (`app/research.py`).
- **Tải PDF an toàn:** Tệp `.pdf` tải lên qua `/api/research/upload-pdf` bị chặn ở ngưỡng **15 MB**, kiểm tra chữ ký `%PDF-`, và báo lỗi rõ nếu PDF chỉ là bản quét hình ảnh chưa có lớp chữ.
- **Ghim acc khóa Loopback & Fail-Closed:** Địa chỉ worker tra qua `/v1/lanes` bắt buộc thuộc loopback (`127.0.0.1` / `localhost` / `::1`); nếu acc được ghim đang TẮT thì trả lỗi `HTTP 502` rõ ràng thay vì tự nhảy âm thầm sang acc khác.

---

## Kiểm thử tự động đã xác minh (`tests/test_backend.py`)

`pytest -v` — **31/31 passed**:
- Nhóm Bridge, Định tuyến & Giữ kết nối Nghiên cứu (`test_compile_stateless_merges_system_into_user_prompt`, `test_health_accurately_counts_workers_and_detects_guest_mode`, `test_perspective_uses_single_user_message_reads_gateway_lane_and_retries_429`, `test_lane_rename_and_pinned_lane_direct_routing`, `test_bridge_ephemeral_and_synthesize_exclude_lanes`, `test_bridge_client_chat_stateless_streams_liveness_and_keeps_model`, `test_perspective_sse_endpoint_emits_status_and_result_events`)
- Nhóm Bảo mật Chia sẻ Từ xa (`test_remote_share_security_middleware_blocks_unauthed_and_host_admin_routes`)
- Nhóm Profile Vault & Proxy Cookie (`test_health_merges_profile_vault_and_detects_duplicate_account_keys`, `test_lane_profile_vault_proxy_endpoints_forward_origin_and_payloads`, `test_lane_profile_vault_propagates_bridge_error_as_502`)
- Nhóm Ngữ cảnh Đa vòng & Chế độ Chuyên sâu (`test_perspective_round_0_omits_conversation_history_block`, `test_perspective_round_1_includes_full_latest_round_roles`, `test_perspective_compresses_older_rounds_and_respects_max_history_chars`, `test_perspective_prefers_conversation_history_over_peer_messages_and_keeps_legacy_fallback`, `test_research_role_unlocks_deep_length_and_preserves_full_dossier_for_critics`)
- Nhóm Trọng tài ẩn danh & Sửa JSON (`test_resilient_json_parses_fenced_and_trailing_comma`, `test_synthesize_handles_malformed_json_and_unmasks_aliases`, `test_judge_prompt_includes_source_excerpts_and_user_turns`, `test_judge_missing_scores_marks_fallback_instead_of_fake_8_0`, `test_judge_bidirectional_anonymization_masks_and_unmasks_all_fields`)
- Nhóm Tìm kiếm Học thuật, PDF, SSRF & Kiểm chứng (`test_ssrf_blocks_loopback_and_private_ips`, `test_research_query_normalization_and_long_source_excerpts`, `test_fetch_url_multi_hop_redirect_and_ssrf_block`, `test_upload_pdf_extracts_fulltext_and_rejects_invalid_bytes`, `test_search_upgrades_open_access_arxiv_to_fulltext_pdf`, `test_verifier_detects_fabricated_numbers_and_distinguishes_inferences`, `test_verifier_splits_markdown_table_cells_without_cross_cell_false_positives`)
- Nhóm Lưu trữ & Nhà cung cấp (`test_room_crud_and_flow_events_jsonl`, `test_providers_mask_secrets_and_models_discovery`, `test_empty_storage_creates_single_clean_room_without_examples`)
