# Thuật toán & Bài nghiên cứu tham khảo — Research AI Web

> 🌐 **Ngôn ngữ:** [English](ALGORITHMS_AND_RESEARCH.md) | [한국어](ALGORITHMS_AND_RESEARCH.ko.md) | **Tiếng Việt**
>
> 📚 **Tài liệu liên quan:** [README](../README.vi.md) · [Kiến trúc Hệ thống](ARCHITECTURE.vi.md)

Tài liệu này tổng hợp đầy đủ các thuật toán thực sự đã cài đặt trong mã nguồn **Research AI Web** (kèm vị trí file và độ phức tạp), cùng danh sách các bài báo học thuật, tiêu chuẩn kỹ thuật và tài liệu UI/UX đã xác minh làm cơ sở thiết kế cho hệ thống.

---

## Phần 1: Các Thuật toán đã Cài đặt trong Hệ thống

### 1.1. Điều phối Đa AI & Lập lịch Song song có Giới hạn
- **Bể Worker bất đồng bộ có giới hạn (`src/lab/ResearchLabApp.tsx:runPerspectivesBatch`)**
  - Khởi chạy tối đa `min(maxConcurrency, targets.length)` worker bất đồng bộ rút dần từ hàng đợi góc nhìn chung, gắn `AbortController` để bấm **Dừng** là hủy ngay các phiên HTTP đang chạy và ghi sự kiện `run_aborted`.
  - **Kiểm soát tầm nhìn theo vòng (Round-Scoped Visibility)**: Vòng 0 chạy độc lập từng góc nhìn (`peerMessages = undefined`); từ vòng phản biện chéo trở đi mới truyền lập luận vòng trước để các AI phản biện trực diện mà không bị lộ ngữ cảnh sớm.
- **Biên dịch Prompt Stateless 1 tin nhắn User (`app/bridge.py:compile_stateless_user_prompt`)**
  - Gộp chỉ dẫn vai trò hệ thống, kho nguồn `[S1]..[Sk]`, lập luận đồng nghiệp và câu hỏi vào đúng 1 tin nhắn `role: "user"` (`stream=False`), tránh việc Gemini Web âm thầm bỏ qua `role: "system"`.

### 1.2. Định tuyến Gateway, Bám phiên & Chuyển luồng chịu lỗi
- **Tạo khóa phiên tất định (`bridge/app/session_pool.py:compute_session_key`)**
  - Lấy `X-Session-Id` tường minh hoặc băm `SHA-256` (16 ký tự hex đầu) của `agent_name + "\0" + câu hỏi đầu đã chuẩn hóa` để cô lập tối đa `16` ngăn phiên `SessionSlot` (`SESSION_POOL_TTL = 3600s`) trên mỗi worker.
- **Xếp hạng Least-Inflight đa khóa theo thứ tự từ điển (`bridge/app/gateway_router.py:reserve_lane`)**
  - Chọn worker khỏe theo bộ khóa ưu tiên:
    $$\text{rank}(\text{lane}) = \big(\max(\text{inflight}_{\text{worker}}, \text{inflight}_{\text{gw}}),\; \text{role\_penalty},\; \text{sticky\_count},\; \text{index}\big)$$
  - Duy trì bảng bám phiên (`STICKY_TTL = 3600s`, `MAX_STICKY_SESSIONS = 128`, tự loại mục cũ nhất) và đẩy subagent sang luồng phụ khi tải bằng nhau.
- **Ngắt mạch Cooldown & Lùi thời gian hàm mũ (`bridge/app/gateway_router.py:mark_cooldown`, `app/bridge.py:chat_stateless`)**
  - Gateway đặt cooldown `15s` cho worker trả `{429, 503}` hoặc `ConnectError` và tự chuyển sang luồng khỏe khác.
  - WebChat thử lại `{408, 429, 500, 502, 503, 504}` theo hàm mũ có trần ($\min(20\text{s},\, 3 \cdot 2^{\text{attempt}})$), ưu tiên header `Retry-After` (chặn trong `[0, 60]` giây).
- **Giải địa chỉ Luồng Ghim cứng Fail-Closed (`app/bridge.py:resolve_lane_url`)**
  - Khi một AI hoặc Trọng tài có `pinnedLaneId` (vd `acc2`), WebChat tra URL worker qua Gateway `/v1/lanes`, kiểm tra `_is_loopback_url()`, và gửi thẳng tới worker đó — trả lỗi `HTTP 502` rõ ràng nếu luồng ghim đang TẮT/mất kết nối thay vì tự âm thầm nhảy sang tài khoản khác.

### 1.3. Trọng tài Ẩn danh (Blind Judge) & Sửa JSON chịu lỗi
- **Ánh xạ song ánh Ẩn danh ↔ Thực danh (`app/routes.py:run_synthesize`)**
  - Tạo bảng ánh xạ hai chiều `@handle ↔ Ứng viên A/B/C…` trước khi gửi hội thoại cho Trọng tài để giảm thiên kiến tên gọi, sau đó giải ẩn danh tất định cho `rubric`, `consensus.supporters` và `perspectiveBreakdown`.
  - Chấm điểm Rubric 3 trục: `total = round((evidence + logic + rebuttal) / 3.0, 1)` và sắp xếp giảm dần.
- **Tách khối JSON cân bằng ngoặc có nhận biết chuỗi (`app/bridge.py:parse_resilient_json`)**
  - Gỡ khung code Markdown nếu có, chạy máy trạng thái đếm độ sâu ngoặc nhọn $O(N)$ có xử lý dấu nháy kép và ký tự thoát `\` để cô lập đúng đối tượng `{...}` ngoài cùng; thử `json.loads` chuẩn rồi dùng `json_repair.repair_json` sửa lỗi phẩy thừa hoặc cú pháp nhẹ.

### 1.4. Tìm kiếm Học thuật Mở, Xác minh Trích dẫn & Chống SSRF
- **Truy vấn song song 3 kho học thuật (`app/research.py:search_open_academic_sources`)**
  - Gọi đồng thời qua `asyncio.gather` tới arXiv Atom XML API, OpenAlex Works REST API và Wikipedia Search API, chuẩn hóa thành các thẻ dẫn chứng `[S1]..[Sk]`.
- **Tái dựng Abstract từ Chỉ mục Đảo ngược OpenAlex (`app/research.py:_search_openalex`)**
  - Giải nén cấu trúc `{từ: [vị_trí...]}` của OpenAlex trong thời gian $O(W)$ bằng mảng vị trí có trần 400 từ để khôi phục đoạn tóm tắt gốc.
- **Lọc trắng Trích dẫn Tất định (`app/routes.py:extract_cited_sources`, `src/lab/SecondaryViews.tsx:citationStats`)**
  - Trích toàn bộ mã `[S\d+]` bằng regex và giao chặt với tập ID tồn tại trong `sources.json` của phòng, loại bỏ mã bịa (như `[S99]`) và hiển thị thống kê hợp lệ/không khớp trong khung Báo cáo.
- **Lá chắn SSRF 2 tầng DNS & Redirect (`app/research.py:is_safe_public_url`, `fetch_url_as_source`)**
  - Chỉ cho phép `http`/`https`, chặn IP nội bộ/loopback/link-local và đuôi `.local`/`.internal`, phân giải toàn bộ bản ghi DNS `getaddrinfo` để đảm bảo mọi IP đều là IP công khai, tắt tự động redirect (`follow_redirects=False`) và kiểm tra lại đích `Location` trước khi tải (giới hạn 5 MB).

### 1.5. Dựng Đồ thị Luồng Trực quan & Tô sáng Tuyến Nhân quả
- **Gấp chuỗi sự kiện thành DAG tăng dần (`src/flow/FlowCanvasSvg.tsx:buildGraphFromEvents`)**
  - Biến danh sách sự kiện `FlowEvent[]` (`run_started`, `node_started`, `node_warning`, `node_completed`, `node_failed`) thành đồ thị có hướng $(V, E)$ phân tầng theo `stageIndex`, đồng thời chèn các nút `disabled` mờ cho AI đang tắt để người dùng thấy rõ AI nào bị bỏ qua.
- **Bố cục Thích ứng Mật độ & Trục Hội tụ Dọc (`src/flow/FlowCanvasSvg.tsx:stagePairMetrics`, `buildEdgePath`)**
  - Tự chuyển sang `compactMode` khi một chặng có $\ge 5$ nút.
  - Vẽ đường cong Bezier lập phương riêng lẻ khi ít nhánh, và tự chuyển sang **Trục hội tụ dọc (`busX`)** ở các chuyển tiếp dày đặc $N \to 1$ hoặc $N \times N$ để chống rối dây.
- **Duyệt DFS hai chiều Thượng/Hạ nguồn (`src/flow/FlowCanvasSvg.tsx:focusSet`)**
  - Khi rê chuột hoặc chọn nút, chạy hai lượt DFS dùng ngăn xếp ($O(|V| + |E|)$) ngược chiều đầu vào (`up`) và xuôi chiều đầu ra (`down`) để tô sáng trọn tuyến nhân quả và hạ mờ các nhánh không liên quan.

### 1.6. Độ tin cậy của Bridge & Lưu trữ Nguyên tử
- **Trình quét thẻ tuyến tính $O(N)$ không Regex & Fail-Closed Batch (`bridge/app/tool_parser.py`)**
  - Dùng `str.find()` tuyến tính (miễn nhiễm ReDoS) trích khối `<tool_call>...</tool_call>`, chuẩn hóa bí danh tham số, kiểm tra kiểu dữ liệu/ranh giới thư mục và hủy toàn bộ lô nếu bất kỳ thẻ nào hỏng.
- **Bảo vệ chống tự khóa chết khi `init()` (`bridge/app/gemini_session.py:GeminiClient`)**
  - Chặn sớm chuyển hướng đăng nhập (`boq_identityfrontendauthuiserver`) trước khi gọi RPC và ép `current_retry=0, close_on_error=False` trong khi `self._in_init` đang bật để triệt tiêu deadlock đệ quy trên `self._lock`.
- **Ghi tệp nguyên tử (`app/storage.py:_atomic_write_json`, `providers.py`, `bridge/app/routes_admin.py`)**
  - Ghi dữ liệu ra tệp tạm trong cùng thư mục, flush xuống đĩa rồi hoán đổi nguyên tử bằng `os.replace` để tránh hỏng dữ liệu JSON/`.env` khi mất điện hoặc tắt đột ngột.

---

## Phần 2: Các Bài nghiên cứu & Tài liệu Tham khảo (Đã xác minh)

Mọi tài liệu bên dưới đã được đối chiếu trực tiếp từ hội nghị/arXiv/W3C chính thức và gắn liền với các thành phần thực tế trong dự án.

### A. Tranh luận Đa Tác tử & Nghiên cứu Đa Góc nhìn

| # | Bài báo / Tài liệu | Hội nghị & Liên kết | Ứng dụng trong Research AI Web |
| :---: | :--- | :--- | :--- |
| 1 | **Yilun Du, Shuang Li, Antonio Torralba, Joshua B. Tenenbaum, Igor Mordatch** — *Improving Factuality and Reasoning in Language Models through Multiagent Debate* | ICML 2024 (arXiv 05/2023) · [arXiv:2305.14325](https://arxiv.org/abs/2305.14325) | Cơ sở lý thuyết cho quy trình trả lời độc lập Vòng 0 rồi tranh luận chéo nhiều vòng, chứng minh chất lượng lập luận và độ xác thực tăng lên ngay cả khi dùng cùng một họ mô hình. |
| 2 | **Tian Liang et al.** — *Encouraging Divergent Thinking in Large Language Models through Multi-Agent Debate* | EMNLP 2024 (arXiv 05/2023) · [arXiv:2305.19118](https://arxiv.org/abs/2305.19118) · [ACL Anthology](https://aclanthology.org/2024.emnlp-main.992/) | Cơ sở phân vai đối trọng (`@Nghiên_cứu` vs. `@Phản_biện`) kết hợp Trọng tài độc lập nhằm khắc phục hiện tượng *thoái hóa tư duy (Degeneration-of-Thought)* khi 1 model tự phản tư. |
| 3 | **Yijia Shao, Yucheng Jiang, Theodore A. Kanell, Peter Xu, Omar Khattab, Monica S. Lam** — *Assisting in Writing Wikipedia-like Articles From Scratch with Large Language Models (STORM)* | NAACL 2024 · [arXiv:2402.14207](https://arxiv.org/abs/2402.14207) | Gợi cảm hứng cho hệ thống vai trò đa góc nhìn và bước tổng hợp dàn ý có cấu trúc trước khi xuất báo cáo nghiên cứu hoàn chỉnh. |
| 4 | **Yucheng Jiang, Yijia Shao, Dekun Ma, Sina J. Semnani, Monica S. Lam** — *Into the Unknown Unknowns: Engaged Human Learning through Participation in Language Model Agent Conversations (Co-STORM)* | EMNLP 2024 · [arXiv:2408.15232](https://arxiv.org/abs/2408.15232) | Cảm hứng trực tiếp cho trải nghiệm phòng chat nhóm đa AI có con người điều hướng (`@vai` / `@#nhóm`) đi kèm **Dàn ý sống** (Đồng thuận / Mâu thuẫn / Lỗ hổng) cập nhật động. |

### B. Trọng tài Đánh giá, Truy xuất Dẫn chứng & Kiểm chứng Trích dẫn

| # | Bài báo / Tài liệu | Hội nghị & Liên kết | Ứng dụng trong Research AI Web |
| :---: | :--- | :--- | :--- |
| 5 | **Lianmin Zheng et al.** — *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena* | NeurIPS 2023 · [arXiv:2306.05685](https://arxiv.org/abs/2306.05685) | Nền tảng cho cơ chế **Trọng tài ẩn danh** (`Ứng viên A/B/C`), bảng chấm điểm Rubric đa tiêu chí (Bằng chứng / Logic / Phản biện) và chế độ So sánh ẩn danh để giảm thiên kiến tên gọi và tự thiên vị. |
| 6 | **Patrick Lewis et al.** — *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks* | NeurIPS 2020 · [arXiv:2005.11401](https://arxiv.org/abs/2005.11401) | Mô hình nền tảng kết hợp bộ nhớ ngoài (`sources.json`) với suy luận của LLM giúp cập nhật tri thức động và truy vết được nguồn gốc lập luận. |
| 7 | **Tianyu Gao, Howard Yen, Jiatong Yu, Danqi Chen** — *Enabling Large Language Models to Generate Text with Citations (ALCE)* | EMNLP 2023 · [arXiv:2305.14627](https://arxiv.org/abs/2305.14627) | Chỉ ra tỷ lệ bịa/thiếu trích dẫn của LLM, trực tiếp thúc đẩy quy tắc trích dẫn `[S#]` chặt chẽ kèm bộ **Citation Verifier** kiểm tra tất định ở backend & giao diện Báo cáo. |
| 8 | **Jason Priem, Heather Piwowar, Richard Orr** — *OpenAlex: A fully-open index of scholarly works, authors, venues, institutions, and concepts* | arXiv 2022 · [arXiv:2205.01833](https://arxiv.org/abs/2205.01833) | Nguồn dữ liệu học thuật mở không cần API key đứng sau bộ tìm kiếm Deep Research cùng với arXiv Atom API và Wikipedia Search API. |

### C. Tiêu chuẩn Bảo mật Web, Phiên trình duyệt & Tham chiếu UI/UX

| # | Tiêu chuẩn / Sản phẩm tham khảo | Liên kết / Tài liệu | Ứng dụng trong Research AI Web |
| :---: | :--- | :--- | :--- |
| 9 | **W3C WebAppSec — Device Bound Session Credentials (DBSC)** | [W3C TR /dbsc/](https://www.w3.org/TR/dbsc/) · [Chrome DBSC Guide](https://developer.chrome.com/docs/privacy-sandbox/dbsc) | Lý giải nguyên nhân Chrome 157+ khóa phiên `__Secure-1PSIDTS` vào khóa phần cứng thiết bị (khiến cookie trích từ Chrome bị chuyển hướng đăng nhập lại) và dẫn đến giải pháp Extension Firefox Manifest V2 nạp cookie 1-click (`bridge/extension/`). |
| 10 | **Nghiên cứu so sánh UI/UX (5 nền tảng + WCAG 2.1 AA)** | Tài liệu thiết kế cục bộ: `public/assets/aistudio/UI_UX_Research_Report_579a35fc.pdf`, `public/assets/aistudio/Flow_Map_UI_Spec_5149e416.pdf` | Tổng hợp ưu điểm từ **Stanford Co-STORM**, **Perplexity Deep Research**, **OpenAI Deep Research**, **Open WebUI** và **ChatHub** để xây dựng giao diện sổ tay thích ứng 1→N và bản đồ `/flow` tách rời hoàn toàn (tương phản chữ đạt chuẩn WCAG AA $\ge 4.5:1$ ở cả 2 chế độ Sáng/Tối). |
