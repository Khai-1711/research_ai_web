import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Globe } from 'lucide-react';

export type UiLanguage = 'vi' | 'en' | 'zh' | 'ja' | 'ko';

export const LANG_STORAGE_KEY = 'research_lab_lang_v1';

export const UI_LANGUAGES: Array<{
  code: UiLanguage;
  label: string;
  shortLabel: string;
  locale: string;
}> = [
  { code: 'vi', label: 'Tiếng Việt', shortLabel: 'VI', locale: 'vi-VN' },
  { code: 'en', label: 'English', shortLabel: 'EN', locale: 'en-US' },
  { code: 'zh', label: '中文', shortLabel: '中文', locale: 'zh-CN' },
  { code: 'ja', label: '日本語', shortLabel: '日本語', locale: 'ja-JP' },
  { code: 'ko', label: '한국어', shortLabel: '한국어', locale: 'ko-KR' },
];

const VI = {
  // Common
  save: 'Lưu',
  cancel: 'Hủy',
  auto: 'Tự động',
  openSettings: 'Mở Cài đặt',
  testBtn: 'Test',
  testingShort: 'Đang thử...',
  savingText: 'Đang lưu...',

  // Language selector
  langSelectAria: 'Chọn ngôn ngữ giao diện',
  langSectionTitle: 'Ngôn ngữ giao diện',
  langSectionHint: 'Đổi toàn bộ nhãn nút, báo cáo và sơ đồ giữa 5 ngôn ngữ (tự đồng bộ nhiều tab).',
  langAutoAiNote: 'AI & Trọng tài tự động trả lời theo ngôn ngữ bạn gõ trong câu hỏi.',

  // Header & ResearchLabApp
  toggleLeftTitle: 'Thu/mở ngăn Phòng & Góc nhìn (phím [)',
  navAriaLabel: 'Chế độ xem',
  navChat: 'Phòng chat',
  navCompare: 'So sánh',
  navReport: 'Báo cáo',
  navAudit: 'Kiểm chứng',
  flowMapTitle: 'Mở Giao diện 2: Bản đồ Luồng AI trực quan',
  themeToDarkTitle: 'Chuyển sang giao diện Tối',
  themeToLightTitle: 'Chuyển sang giao diện Sáng ấm',
  themeDarkLabel: 'Tối quái dị',
  themeLightLabel: 'Sáng ấm',
  settingsTitle: 'Cài đặt luồng chạy & Bridge',
  rightDrawerTitle: 'Thu/mở Kho nguồn & Dàn ý sống (phím ])',
  sourcesCountBtn: 'Nguồn ({count})',
  loadingNotebook: 'Đang mở Sổ tay Nghiên cứu…',
  alertBridgeOffline: 'Mất kết nối dsh-gemini-bridge. Kiểm tra máy chủ Bridge hoặc mở Cài đặt.',
  alertGuestMode:
    'Một số luồng Bridge chưa đăng nhập (Guest Mode) — bấm Mở Cài đặt để đăng nhập 1 lần hoặc Sync ngầm trực tiếp trên web.',
  alertDuplicateLanes:
    'Phát hiện {lanes} đang dùng trùng tài khoản Google — hãy mở Cài đặt và bấm Đổi acc để tách luồng độc lập.',
  alertOverConcurrency:
    'Đang đặt {max} luồng song song vượt quá {healthy} worker khỏe — có thể chờ khóa tuần tự.',
  aiRosterLabel: 'Phân công AI:',
  aiChipTitle: 'Vai trò: {name} · {acc} — Bấm để sửa tên, vai trò, model hoặc chọn acc',
  accPinned: 'Tài khoản: {acc}',
  accAuto: 'Tài khoản: Tự động',
  addAiPinAcc: 'Thêm AI / Gán acc',
  judgeLabel: 'Trọng tài:',
  judgeModelAria: 'Chọn model cho Trọng tài',
  judgeAccAria: 'Chọn tài khoản cho Trọng tài',
  accAutoOption: 'Acc: Tự động',
  model4NeonDesc: '4 Neon — Phân tích sâu hơn',
  model4CarbonDesc: '4 Carbon — Lập trình & Phức tạp',
  model4HydrogenDesc: '4 Hydrogen — Trợ giúp hằng ngày',

  // Composer
  deepResearchPlanHeader: 'Duyệt kế hoạch Deep Research (arXiv · OpenAlex · Wikipedia)',
  deepResearchPlanHint: 'Truy vấn nguồn mở miễn phí, sau đó để {count} góc nhìn phản biện có trích dẫn [S#].',
  runSourcesAndDebate: 'Chạy tìm nguồn & Thảo luận',
  btnFullPipeline: 'Chạy trọn quy trình',
  btnFullPipelineTitle: 'Chạy trọn quy trình 1 chạm: Tìm nguồn sâu + In tài liệu → Hội đồng phân tích → Phản biện → Trọng tài chốt',
  btnAutoDebate: 'Tự tranh luận vòng tiếp',
  btnRunJudge: 'Trọng tài chốt',
  btnDeepResearch: 'Deep Research',
  btnAttachUrl: 'URL / Tài liệu',
  btnModeDeep: 'Tài liệu Chuyên sâu',
  btnModeStandard: 'Chế độ Súc tích',
  btnModeTitle: 'Chuyển đổi độ sâu câu trả lời: Chuyên sâu hoặc Súc tích',
  mentionMenuTitle: 'Chọn góc nhìn hoặc cụm nhóm',
  mentionGroupSub: 'Nhóm ({count} góc nhìn)',
  composerPlaceholder: 'Nhắn tiếp cho {count} góc nhìn đang bật, hoặc gõ @tên_AI / @#nhóm để gọi riêng…',
  sendTo: 'Gửi tới:',
  activePerspectivesLabel: '{enabled}/{total} góc nhìn đang bật',
  batchesLabel: '~{batches} đợt ({max} luồng)',
  btnSend: 'Gửi',
  attachModalTitle: 'Đính kèm URL hoặc đoạn trích tài liệu',
  attachPdfLabel: 'Tải tệp PDF nghiên cứu từ máy tính (toàn văn, tối đa 15 MB)',
  attachPdfPick: 'Chọn file PDF (.pdf) trên máy…',
  attachPdfUnselect: 'Bỏ chọn file',
  attachOrUrl: 'hoặc dán đường dẫn bài viết / arXiv / DOI',
  attachUrlPlaceholder: 'https://arxiv.org/abs/... hoặc https://doi.org/...',
  attachOrNote: 'hoặc dán trực tiếp đoạn trích PDF / ghi chú',
  attachTitlePlaceholder: 'Tiêu đề tài liệu (vd: Quy chế thi 2026)',
  attachBodyPlaceholder: 'Dán đoạn trích nội dung quan trọng để các góc nhìn AI trích dẫn [S#]…',
  attachAdding: 'Đang nạp…',
  attachSubmit: 'Thêm vào Kho nguồn',
  attachEmptyErr: 'Vui lòng chọn tệp PDF, dán URL hoặc nhập đoạn trích tài liệu.',
  attachFailErr: 'Không thể nạp tài liệu.',

  // LeftDrawer
  leftAriaLabel: 'Ngăn Phòng và Đội hình AI',
  tabRooms: 'Phòng',
  tabRoster: 'AI & Vai trò ({enabled}/{total})',
  hideLeftTitle: 'Ẩn ngăn trái ([)',
  createNewRoom: 'Tạo phòng mới',
  recentRoomsCount: 'Phòng gần đây ({count})',
  aiCountSuffix: '{total} AI',
  enabledParen: ' (bật {count})',
  sourcesCountShort: '{count} nguồn',
  renameRoomTitle: 'Đổi tên phòng',
  deleteRoomTitle: 'Xóa phòng',
  roleAndModelHeading: 'Vai trò & Model của từng AI trong phòng',
  enabledSlashTotal: '{enabled}/{total} bật',
  editRoleTitle: 'Đổi tên @AI, vai trò & chỉ dẫn',
  deleteRoleTitle: 'Xóa AI này khỏi phòng',
  handlePlaceholder: 'Tên gọi @AI (vd: Nghiên_cứu, Code_Pro)',
  roleNamePlaceholder: 'Tên nhiệm vụ / vai trò',
  rolePromptPlaceholder: 'Chỉ dẫn nhiệm vụ cụ thể cho AI này...',
  saveChanges: 'Lưu thay đổi',
  roleLabelPrefix: 'Vai trò: ',
  currentModelPrefix: '[Hiện tại] ',
  accAutoBridge: 'Tài khoản: Tự động (Bridge chia tải)',
  accPrefix: 'Tài khoản: {id} — {name}',
  addAiHeading: 'Thêm 1 luồng AI vào phòng',
  quickHandlePlaceholder: 'Tên gọi (vd: Nghiên_cứu, Phản_biện)',
  quickNamePlaceholder: 'Nhiệm vụ cụ thể (vd: Đọc bài báo & trích dẫn)',
  pinPrefix: 'Ghim riêng: {id} — {name}',
  addAiSubmit: 'Thêm luồng AI',
  addAiProviderBtn: 'Nạp thêm nguồn AI (API Key / Bridge)',
  presetSaved: 'Đã lưu làm mẫu phòng!',
  savePresetBtn: 'Lưu đội hình làm mẫu',
  tplAcademic: 'Nghiên cứu học thuật',
  tplTech: 'Kiến trúc & Code',
  tplCritic: 'Phản biện rủi ro',
  tplCost: 'Kinh tế / Chi phí',

  // RightDrawer
  rightAriaLabel: 'Ngăn Kho nguồn và Dàn ý sống',
  tabSources: 'Kho nguồn ({count})',
  tabOutline: 'Dàn ý sống',
  hideRightTitle: 'Ẩn ngăn phải (])',
  noSourcesTitle: 'Chưa có nguồn trích dẫn',
  noSourcesHint: 'Dùng nút Deep Research hoặc URL / Tài liệu ở khung nhập để nạp nguồn thật từ arXiv, OpenAlex, Wikipedia.',
  injectSourcesBtn: 'In toàn bộ Kho nguồn vào Chat ({count})',
  levelFullText: 'Toàn văn',
  levelAbstractOnly: 'Chỉ Tóm tắt',
  levelExcerpt: 'Trích đoạn',
  levelFullTextTitle: 'Nguồn đã trích xuất toàn văn / bài dài để AI đối chiếu sâu',
  levelAbstractOnlyTitle: 'Nguồn hiện chỉ mới có phần tóm tắt (Abstract)',
  levelExcerptTitle: 'Nguồn trích đoạn / tổng quan',
  citationsCountTitle: 'Số trích dẫn theo OpenAlex',
  deleteSourceTitle: 'Xóa nguồn [{id}]',
  collapseExcerpt: 'Thu gọn trích đoạn',
  expandExcerpt: 'Xem toàn văn ({chars} ký tự)',
  consensusHeading: 'Điểm đồng thuận ({count})',
  consensusEmpty: 'Bấm Trọng tài chốt sau khi thảo luận để tự động gom các điểm đồng thuận.',
  supportersPrefix: 'Ủng hộ: ',
  contradictionsHeading: 'Trục mâu thuẫn chính ({count})',
  contradictionsEmpty: 'Chưa ghi nhận mâu thuẫn đáng kể.',
  askContradiction: 'Đưa thành câu hỏi phản biện',
  gapsHeading: 'Lỗ hổng cần tìm thêm ({count})',
  gapsEmpty: 'Chưa có lỗ hổng nào được đánh dấu.',
  fillGapsBtn: 'Tìm nguồn lấp {count} lỗ hổng này',
  exportSectionTitle: 'Xuất dữ liệu phiên',
  copiedBtn: 'Đã chép',
  copyMdBtn: 'Copy MD',

  // GroupFeed
  renameRoomGroupTitle: 'Đổi tên phòng nghiên cứu',
  focus1on1: 'Nghiên cứu tập trung 1-1',
  addPerspectiveBtn: 'Thêm góc nhìn',
  toggleOffTitle: 'Bấm để tạm tắt góc nhìn này cho lượt tới',
  toggleOnTitle: 'Bấm để bật lại',
  compareSideBySide: 'So sánh cạnh nhau',
  perspectivesBtnCount: 'Góc nhìn: {active}/{total}',
  compactCards: 'Thẻ gọn ({count})',
  expandAll: 'Mở tất cả',
  compare2to4: 'So sánh 2–4 AI',
  filterAllPerspectives: 'Lọc: Tất cả góc nhìn',
  searchIdeasPlaceholder: 'Tìm ý…',
  emptyRoomTitle: 'Phòng nghiên cứu đã sẵn sàng',
  emptyRoomHint: 'Đặt câu hỏi bên dưới để {count} góc nhìn đang bật cùng phân tích, hoặc bấm Deep Research để tìm nguồn học thuật thật từ arXiv và OpenAlex trước.',
  yourQuestion: 'Câu hỏi của bạn',
  dossierTitle: 'Hồ sơ Tài liệu Nghiên cứu (Toàn văn cho Phản biện & Trọng tài)',
  openDossier: 'Mở tài liệu',
  collapse: 'Thu gọn',
  dossierReadyFallback: '{count} nguồn tài liệu đã sẵn sàng cho Hội đồng AI.',
  judgeRoundTitle: 'Trọng tài · Tổng hợp vòng thảo luận',
  pinnedBadge: 'Đã ghim',
  expandDetail: 'Bung chi tiết',
  conclusionPrefix: 'Kết luận: ',
  autoVerified: 'Kiểm chứng tự động',
  directCitationsCount: '{count} trích dẫn trực tiếp',
  inferredCitationsCount: '{count} suy luận rõ nguồn',
  numericMatched: 'Số liệu khớp: {matched}/{checked}',
  unpinReport: 'Bỏ ghim Báo cáo',
  pinToReport: 'Ghim vào Báo cáo',
  askRoleDirectly: 'Hỏi riêng @{handle}',
  compareThisRole: 'Đưa vào So sánh',
  statusQueued: 'Đang xếp hàng',
  statusQueuedDesc: 'Đang chờ luồng trống theo cấu hình max_concurrency…',
  statusAnalyzing: 'Đang phân tích và tổng hợp lập luận ({label})…',
  stopBtn: 'Dừng',
  batchDone: 'Đã xong {done}/{total}',
  batchRunning: 'Đang chạy: ',
  batchWaiting: 'Chờ: {count}',

  // MarkdownText
  inferredBadge: 'Suy luận · {id}',
  inferredTooltip: 'Suy luận dựa trên nguồn {id} (không trích nguyên văn)',
  directCitTooltip: 'Xem nguồn trích dẫn trực tiếp {id}',
  invalidCitTooltip: 'Mã nguồn {id} không có trong Kho nguồn hiện tại',

  // SecondaryViews (Compare / Report / Audit)
  comparingLabel: 'Đang so sánh:',
  removeColTitle: 'Bỏ cột này',
  addCol: 'Thêm cột',
  roundN: 'Vòng {round}',
  blindModeLabel: 'Ẩn danh: {state}',
  onBadge: 'BẬT',
  offBadge: 'TẮT',
  candidatePrefix: 'Ứng viên {letter}',
  noReplyYet: 'Chưa có bài trả lời',
  roleNotInRound: 'Góc nhìn này chưa tham gia Vòng {round}.',
  askFollowUpRole: 'Hỏi tiếp vai @{handle}',
  noReportTitle: 'Chưa tạo Báo cáo tổng hợp',
  noReportDesc: 'Bấm nút bên dưới để Trọng tài tổng hợp toàn bộ lập luận, chấm bảng điểm Rubric theo từng góc nhìn và dựng báo cáo sạch mắt.',
  judgeSynthesizing: 'Trọng tài đang tổng hợp…',
  runJudgeBuildReport: 'Chạy Trọng tài dựng Báo cáo',
  tocTitle: 'Mục lục báo cáo',
  toc1: '1. Tóm tắt kết luận',
  toc2: '2. Phân tích theo góc nhìn',
  toc3: '3. Điểm còn tranh cãi',
  toc4: '4. Bảng điểm Trọng tài',
  toc5: '5. Tài liệu tham khảo',
  integrityCheckTitle: 'Kiểm chứng Toàn vẹn',
  validCitCheck: '• {valid}/{total} mã [S#] hợp lệ',
  inferredCitCheck: '• {count} trích dẫn suy luận',
  unmatchedCitCheck: '• {count} trích dẫn không khớp',
  numericMatchCheck: '• Số liệu khớp: {matched}/{checked}',
  sourcesBreakdownCheck: '• Nguồn: {full} toàn văn · {abs} tóm tắt',
  fallbackTurnsCheck: '• {count} lượt fallback model',
  sec1Title: '1. Tóm tắt kết luận',
  sec2Title: '2. Phân tích theo góc nhìn',
  sec3Title: '3. Điểm còn tranh cãi',
  sec4Title: '4. Bảng điểm Trọng tài (tự co giãn theo {count} góc nhìn)',
  sec5Title: '5. Tài liệu tham khảo ({count})',
  judgeExtractWarnings: 'Lưu ý trích xuất điểm Trọng tài',
  colPerspective: 'Góc nhìn',
  colEvidence: 'Bằng chứng',
  colLogic: 'Logic',
  colRebuttal: 'Phản biện',
  colTotal: 'Tổng',
  colSpread: 'Dao động',
  colSpreadTitle: 'Chênh lệch tổng điểm lớn nhất giữa các lần chấm khi đảo thứ tự ứng viên',
  fallbackBadge: 'Dự phòng',
  fallbackTitle: 'Trọng tài không trả về đủ điểm JSON; hiển thị điểm cơ sở 5.0',
  spreadTitleMulti: 'Tổng điểm từng lần chấm: {scores}',
  spreadTitleSingle: 'Chỉ chấm 1 lần — chưa đo được độ ổn định',
  judgeReliabilityTitle: 'Độ tin cậy của Trọng tài',
  judgeRunsValid:
    '• {parsed}/{requested} lần chấm trả JSON hợp lệ, mỗi lần một thứ tự ứng viên khác nhau (seed {seed}).',
  judgeOrderLine: '• Thứ hạng: {status}.',
  rankingInsufficient: 'chưa đủ lần chấm để so sánh',
  rankingStable: 'giữ nguyên khi đảo thứ tự',
  rankingChanged: 'THAY ĐỔI khi đảo thứ tự — đừng dựa vào bảng xếp hạng',
  judgeFamilyLabel: 'Họ model Trọng tài:',
  debaterFamiliesLabel: '; AI tranh luận:',
  sameFamilyWarn: ' — cùng họ, có nguy cơ tự ưu ái',
  claimSupportSummaryHeading: 'Kiểm chứng mức câu (nguồn có ủng hộ câu khẳng định không): {summary}',
  downgradedNoQuoteNote: ' (hạ nhãn: trích dẫn không có nguyên văn trong nguồn)',
  sourceQuotePrefix: ' — nguồn: ',
  noRetrievalInfo: 'Không có thông tin truy xuất',
  openSourceLink: 'Mở nguồn',
  downloadReportMd: 'Tải Báo cáo (.md)',
  updateSynthesis: 'Cập nhật tổng hợp',
  backToChat: 'Quay lại phòng hỏi tiếp',
  auditTitle: 'Nhật ký Kiểm chứng (Audit Trail)',
  auditSubtitle: 'Kiểm tra chính xác ngữ cảnh, nguồn [S#] và prompt thô từng góc nhìn đã nhận · Lưu bền vững tại events.jsonl.',
  downloadJsonl: 'Tải events.jsonl gốc',
  auditCallMode: 'Chế độ gọi',
  auditLoggedTurns: 'Số lượt đã ghi',
  auditTurnsUnit: '{count} lượt',
  auditFallbackWarns: 'Cảnh báo Fallback',
  auditVerifiedSources: 'Nguồn xác minh',
  auditSourcesUnit: '{count} nguồn',
  auditFallbackBanner: 'Cảnh báo đổi mô hình dự phòng (Fallback)',
  auditEmpty: 'Chưa có bản ghi kiểm chứng nào. Hãy gửi 1 câu hỏi ở Phòng chat để hệ thống ghi lại prompt thô.',
  auditSourcesPrefix: 'Nguồn: ',
  hideRawPrompt: 'Ẩn prompt thô',
  viewRawPrompt: 'Xem prompt thô',
  reportTitleTpl: 'Báo cáo tổng hợp: {roomTitle}',
  reportSubtitleTpl: 'Trọng tài ({mode}) · {runs} lần chấm · {sources} nguồn · {active}/{total} góc nhìn tham gia',
  judgeModeAnon: 'Ẩn danh',
  judgeModePublic: 'Công khai',
  execSummaryEmpty: '⚠ Trọng tài không viết phần tóm tắt (executiveSummary rỗng).',
  execSummaryNoSynthesis:
    '⚠ Trọng tài không trả về JSON hợp lệ ở mọi lần chấm nên CHƯA có bản tổng hợp. Hãy chạy lại hoặc đổi model Trọng tài trong Cài đặt.',
  breakdownFallbackTpl: 'Chưa bóc tách được đánh giá chi tiết từ Trọng tài cho @{handle} (dùng điểm dự phòng).',
  breakdownDefaultTpl: 'Đóng góp góc nhìn chuyên môn từ @{handle}.',
  warnFallbackScored: '@{handle}: Trọng tài không trả về đủ điểm số JSON hợp lệ — tạm hiển thị mức cơ sở dự phòng (5.0).',
  warnPartialScores: '@{handle}: chỉ {scored}/{total} lần chấm trả đủ điểm hợp lệ.',
  warnScoreUnstable: '@{handle}: tổng điểm dao động {spread} giữa các lần chấm (đổi thứ tự ứng viên) — điểm KHÔNG ổn định.',
  warnRankingChanged: 'Thứ hạng các góc nhìn THAY ĐỔI khi đảo thứ tự ứng viên — không nên dựa vào bảng xếp hạng.',
  warnSameFamily:
    "Trọng tài cùng họ model '{family}' với AI tranh luận — có nguy cơ tự ưu ái (self-preference). Nên chọn Trọng tài từ nhà cung cấp khác trong Cài đặt.",
  warnParseFailed: 'Trọng tài trả JSON không hợp lệ ở {failed}/{total} lần chấm.',
  warnCallFailed: '{failed}/{total} lần chấm không gọi được model: {error}',
  warnClaimUnsupported: '@{handle}: {unsupported}/{checked} câu có [S#] bị đánh giá là nguồn KHÔNG ủng hộ.',
  warnClaimDowngraded:
    "{count} nhãn 'được ủng hộ' bị hạ xuống 'không rõ' vì câu bằng chứng không có nguyên văn trong nguồn.",
  warnClaimCheckFailed: 'Không chạy được bước kiểm chứng mức câu: {error}',
  warnClaimUnchecked: '{unchecked}/{total} câu không nhận được nhãn hợp lệ từ model kiểm chứng.',
  warnInvalidCitations: 'Phát hiện mã trích dẫn không có trong Kho nguồn: {idsText}.',
  warnUnverifiedNumbers:
    'Có {count} số liệu gắn trích dẫn trực tiếp nhưng chưa tìm thấy trong văn bản nguồn: {preview}{extra}.',
  warnUnverifiedNumbersExtra: ' và {extraCount} số khác',
  roundIndependentTpl: 'Vòng {round} · Trả lời độc lập ({count})',
  roundDiscussTpl: 'Vòng {round} · Thảo luận tiếp ({count})',
  roundRebuttalTpl: 'Vòng {round} · Phản biện chéo ({count})',
  roundJudgeTpl: 'Vòng {round} · Tổng hợp Trọng tài',
  roundDeepResearchTpl: 'Vòng {round} · Deep Research ({count} nguồn mới)',
  roundDossierTpl: 'Vòng {round} · Hồ sơ Tài liệu Kho nguồn ({count})',
  httpServerError: 'Lỗi máy chủ (HTTP {status})',
  errLoadRooms: 'Không tải được dữ liệu phòng.',
  errSaveRoom: 'Không lưu được thay đổi phòng.',
  errCreateRoom: 'Không tạo được phòng mới.',
  errDeleteRoom: 'Không xóa được phòng.',
  errPerspectiveCall: 'Lỗi gọi góc nhìn AI.',
  errJudgeRun: 'Lỗi chạy Trọng tài.',
  errDeepResearch: 'Không tìm được nguồn Deep Research.',
  errExtractUrl: 'Không trích xuất được nội dung từ URL.',
  flowStageStopped: 'Đã dừng',
  flowActorUserStop: 'Người dùng dừng',
  flowAbortSummary: 'Người dùng đã chủ động dừng lượt chạy giữa chừng.',
  flowStageInput: 'Đầu vào',
  flowActorUser: 'Bạn (Prompt)',
  flowStartSummary: '"{preview}" · Gửi tới {active}/{total} AI',
  flowPromptSentTo: 'Câu hỏi gửi tới @{handle}',
  flowStageOutput: 'Trả về Bạn',
  flowActorOutput: 'Kết quả trả Bạn',
  flowOutputSummary: 'Đã hoàn tất {done}/{total} góc nhìn cho {roundLabel}.',
  flowOutputContent: 'Toàn bộ câu trả lời đã sẵn sàng đọc ở Giao diện 1.',
  flowStageJudge: 'Trọng tài',
  flowActorJudge: 'Trọng tài',
  flowRound0Debate: 'Vòng 0 · Độc lập',
  flowCouncilStage: 'Hội đồng N AI',
  flowDisabledSummary: 'Tạm tắt — không nhận prompt ở lượt này',
  flowDisabledContent: '@{handle} đang tạm tắt ở lượt chạy này nên không có đường dữ liệu nào nối vào.',
  flowStageFallback: 'Chặng {idx}',
  inspectorDrawerAria: 'Chi tiết nút hoặc luồng đang chọn',
  composerGroupPrefix: 'nhóm #{tags}',
  composerTargetsCount: '{prefix} ({count} AI)',
  composerEnabledRatio: '{enabled}/{total} góc nhìn đang bật',
  settingsLaneRenamed: 'Đã đặt tên {id} thành "{name}".',
  settingsLaneReset: 'Đã đưa tên {id} về mặc định.',
  settingsErrRename: 'Không đổi được tên tài khoản.',
  settingsAssignedLane: 'Đã bốc {id}{namePart} vào phòng với vai @{handle} ({role}).',
  settingsCreatedLane:
    'Đã tạo thêm luồng {id} (:{port}). Hãy bấm "Đăng nhập" trên thẻ {id} để nạp tài khoản Google riêng.',
  settingsErrCreateLane: 'Không tạo được luồng acc mới.',
  settingsNoLoggedInSync:
    'Chưa có profile nào đã đăng nhập để sync ngầm. Hãy bấm "Đăng nhập" trên từng acc trước.',
  settingsSyncedAll: 'Đã sync ngầm xong {synced}/{total} profile.',
  settingsErrSyncAll: 'Không sync ngầm được toàn bộ profile.',
  settingsLoginOpened:
    'Đã mở cửa sổ trình duyệt thật cho {id}. Hãy đăng nhập Google + vào Gemini rồi đóng cửa sổ (hoặc bấm "Xong & Sync").',
  settingsErrLogin: 'Không mở được trình duyệt đăng nhập cho {id}.',
  settingsCookieLoaded: 'Đã lấy & nạp xong cookie cho {id}{keyPart}.',
  settingsErrFinishLogin: 'Không hoàn tất sync cho {id}.',
  settingsSyncedOne: 'Đã sync ngầm cookie mới cho {id}{keyPart}.',
  settingsErrSyncOne: 'Sync ngầm {id} thất bại.',
  settingsProviderAdded: 'Đã thêm "{name}" ({model}).',
  settingsErrAddProvider: 'Không thêm được nguồn AI.',
  settingsTestOkFallback: 'Kết nối thành công',
  settingsErrTest: 'Kết nối thất bại.',
  settingsErrDeleteProvider: 'Không xoá được nguồn AI.',
  dossierSummaryTpl: 'Hồ sơ tài liệu {count} nguồn',
  dossierFullSummaryTpl: 'Hồ sơ đầy đủ {count} nguồn từ Kho nguồn',
  defaultResearchQuery: 'Nghiên cứu bằng chứng học thuật mới nhất cho chủ đề phòng hiện tại',
  defaultPipelineQuery: 'Nghiên cứu chuyên sâu, phản biện đa chiều và tổng hợp kết luận cho chủ đề phòng hiện tại',
  savedPresetDesc: 'Lưu từ phòng ({count} góc nhìn)',

  // SettingsDrawer
  settingsAriaLabel: 'Cài đặt AI, Model và Điều phối',
  settingsTitleHeading: 'Cài đặt AI & Model',
  settingsSubtitle: 'Nạp AI qua Bridge cục bộ hoặc API Key và chọn model cho Trọng tài.',
  connectedProvidersTitle: 'Nguồn AI đã kết nối ({count})',
  reloadProvidersTitle: 'Tải lại danh sách model và luồng Bridge',
  addAiBtn: 'Thêm AI',
  addProviderHeading: 'Nạp nguồn AI mới',
  kindBridgeLocal: 'Bridge cục bộ',
  kindGeminiApi: 'Gemini API',
  kindOpenAiCompat: 'OpenAI / Khác',
  providerNameLabel: 'Tên AI (hiển thị trong danh sách)',
  providerUrlBridge: 'URL Bridge (Gateway hoặc worker riêng)',
  providerUrlBase: 'Base URL API',
  apiKeyOptional: '(tùy chọn)',
  apiKeyOllama: '(để trống nếu dùng Ollama cục bộ)',
  apiKeyRequired: '(bắt buộc)',
  defaultModelLabel: 'Model mặc định',
  roleOnAddLabel: 'Vai trò khi thêm phòng',
  alsoAddToRoomLabel: 'Thêm luôn làm 1 luồng AI trong phòng đang mở',
  saveProviderBtn: 'Lưu nguồn AI',
  loggedInLanesSummary: '{healthy}/{total} luồng đã đăng nhập ({lanes})',
  deleteProviderTitle: 'Xóa nguồn AI này',
  perAccountBridge: 'Từng tài khoản Bridge ({mode})',
  syncAllTitle: 'Sync ngầm tất cả tài khoản đã từng đăng nhập (0 tab mở)',
  syncingText: 'Đang sync...',
  syncAllBtn: 'Sync tất cả',
  createLaneTitle: 'Tạo thêm luồng acc mới (.env.accN)',
  creatingText: 'Đang tạo...',
  addLaneBtn: 'Thêm acc',
  laneBrowserOpen: 'Đang mở trình duyệt đăng nhập...',
  laneCookieOk: 'Đã đăng nhập Cookie',
  laneOff: 'Đang TẮT',
  laneGuest: 'Chế độ Khách',
  renameLaneTitle: 'Đặt tên gợi nhớ cho tài khoản này',
  renameLaneBtn: 'Tên',
  assignRoleBtn: 'Gán vai',
  gettingCookieText: 'Đang lấy cookie...',
  finishLoginBtn: 'Xong & Sync',
  openingText: 'Đang mở...',
  switchAccBtn: 'Đổi acc',
  switchSeparateAccBtn: 'Đổi acc riêng',
  loginOnceBtn: 'Đăng nhập 1 lần',
  syncBgBtn: 'Sync ngầm',
  dupWarning: 'Đang dùng trùng tài khoản Google với {others}. Hãy bấm Đổi acc riêng để tách luồng độc lập.',
  pinAssignTitle: 'Gán riêng {id} ({name}) vào phòng {room}',
  pinAssignBtn: 'Gán {id} vào phòng',
  judgeModelLabel: 'Model cho Trọng tài (Judge tổng hợp & chấm điểm)',
  judgeLaneLabel: 'Tài khoản Bridge (acc) riêng cho Trọng tài',
  judgeLaneAuto: 'Tự động (Bridge tự chọn luồng rảnh)',
  judgeModelHint: 'Gợi ý: chọn 4 Neon (Phân tích sâu hơn) cho Trọng tài để tổng hợp lập luận và bắt lỗ hổng sắc bén hơn.',
  concurrencyLabel: 'Luồng chạy song song (max_concurrency)',
  concurrencyThreads: '{count} luồng',
  concurrencySeq: '1 (tuần tự)',
  overSubscribedWarn: 'Bạn đang đặt {max} luồng vượt quá {healthy}/{total} luồng Bridge đã đăng nhập.',
  behaviorSectionTitle: 'Hành vi nghiên cứu & Trọng tài',
  approveResearchTitle: 'Duyệt kế hoạch Deep Research',
  approveResearchDesc: 'Hiển thị từ khóa tìm nguồn arXiv/OpenAlex để bạn xác nhận trước khi chạy.',
  anonymizeJudgeTitle: 'Ẩn danh góc nhìn khi vào Trọng tài',
  anonymizeJudgeDesc: 'Che tên thật thành Ứng viên A/B/C để Trọng tài đánh giá khách quan.',
  judgeRunsTitle: 'Số lần Trọng tài chấm',
  judgeRunsDesc: 'Mỗi lần đổi thứ tự ứng viên (giữ nguyên → đảo ngược → xáo) rồi lấy trung bình và báo độ dao động.',
  nRunsOption: '{n} lần',
  claimCheckTitle: 'Kiểm chứng mức câu',
  claimCheckDesc: 'Hỏi thêm 1 lượt model xem nguồn có thật sự ủng hộ từng câu có [S#] không (tối đa 30 câu).',

  // FlowMap & Swimlane
  flowRoomAria: 'Chọn phòng để quan sát luồng',
  flowTabMap: 'Bản đồ Luồng',
  flowTabSwimlane: 'Làn thời gian',
  flowThemeTitle: 'Chuyển đổi Sáng ↔ Tối (đồng bộ cả 2 giao diện)',
  openChatBtn: 'Mở Phòng Chat',
  filterTagAria: 'Lọc theo nhóm tag',
  filterAllTags: 'Mọi #nhóm',
  onlyEnabledAi: 'Chỉ hiện AI đang bật',
  inspectorEdge: 'Luồng dữ liệu đang chọn',
  inspectorNode: 'Nút xử lý đang chọn',
  maskedAsNote: 'Đã che tên thật thành {alias} trước khi truyền sang Trọng tài để đánh giá khách quan.',
  transferredSummary: 'Tóm tắt dữ liệu đã truyền',
  transferredFallback: 'Truyền toàn bộ nội dung lập luận và trích dẫn liên quan sang chặng tiếp theo.',
  transferKind: 'Loại truyền tin',
  contextLength: 'Độ dài ngữ cảnh',
  charsUnit: '{chars} ký tự',
  attachedSources: 'Nguồn đính kèm',
  hideSentText: 'Ẩn văn bản đã gửi',
  viewSentText: 'Xem toàn văn đã gửi',
  nodeKeyPoint: 'Ý chính của nút ({stage})',
  noSummaryYet: 'Chưa có tóm tắt.',
  statusLabel: 'Trạng thái',
  statusDisabled: 'Tạm tắt (đứng ngoài)',
  statusRunning: 'Đang xử lý',
  statusCompleted: 'Đã hoàn tất',
  statusError: 'Gặp lỗi',
  workerLaneLabel: 'Worker Lane',
  elapsedLabel: 'Thời gian xử lý',
  inputsReadLabel: 'Đầu vào đã đọc',
  streamsUnit: '{count} luồng',
  inputsListTitle: 'Danh sách nguồn/AI đã nhận vào',
  hideRawJson: 'Ẩn toàn văn & JSON sự kiện',
  viewRawJson: 'Xem toàn văn & JSON sự kiện',
  pauseBtn: 'Tạm dừng',
  playBtn: 'Phát lại',
  stepBackTitle: 'Lùi 1 bước',
  stepFwdTitle: 'Tiến 1 bước',
  noEventsYet: 'Chưa có sự kiện nào trong phòng này',
  eventStepLabel: 'Sự kiện {cur}/{total}: {stage} · {name}',
  liveWatching: 'Đang theo dõi LIVE',
  backToLive: 'Về LIVE',
  speedLabel: 'Tốc độ:',
  swimlaneTitle: 'Làn thời gian theo Worker (Swimlane Timeline)',
  swimlaneDesc: 'Theo dõi chính xác các đợt chạy song song trên từng tài khoản (acc1..accN), thời điểm bắt đầu và độ trễ xử lý.',
  swimlaneTotalSpan: 'Tổng khung thời gian: 0s – {max}s',
  swimlaneEmpty: 'Chưa có dữ liệu làn chạy nào. Hãy gửi câu hỏi ở Phòng Chat để theo dõi thời gian thực từng luồng AI.',
  swimlaneWorkerCol: 'Lane / Worker',

  // Research labels & Export
  srcTypePreprint: 'Preprint (chưa bình duyệt)',
  srcTypePublished: 'Đã xuất bản',
  srcTypeOtherScholarly: 'Học thuật khác',
  srcTypeEncyclopedia: 'Bách khoa',
  srcTypeWeb: 'Trang web',
  srcTypeWebPdf: 'PDF từ web',
  srcTypeUserUpload: 'PDF tải lên',
  srcTypeUserExcerpt: 'Trích đoạn dán vào',
  srcTypeUnclassified: 'Chưa phân loại',
  retQuery: 'Tìm qua {provider} · "{query}" · hạng {rank} · {when}',
  retUrl: 'Tải từ URL · {when}',
  retUpload: 'Tải lên "{filename}" · {when}',
  claimUnchecked: 'chưa kiểm',
  claimSummary: '{supported}/{checked} được ủng hộ · {partial} một phần · {unsupported} không ủng hộ · {unclear} không rõ',

  // FlowCanvasSvg
  canvasZoomOut: 'Thu nhỏ',
  canvasZoomIn: 'Phóng to',
  canvasFitScreenTitle: 'Căn vừa màn hình',
  canvasFitScreenBtn: 'Vừa màn hình',
  canvasEmptyTitle: 'Chưa có luồng dữ liệu trong phòng này',
  canvasEmptyHint: 'Hãy gửi câu hỏi trong Phòng Chat (hoặc chọn phòng đã có hội thoại ở thanh trên) để xem sơ đồ luồng xử lý thực tế theo thời gian thực.',
  canvasStagePrefix: 'CHẶNG {idx} · {label}',
  canvasMaskedBadge: 'Ẩn danh',
  canvasStatusDisabled: 'Tạm tắt',
  canvasStatusRunning: 'Đang chạy · {time}',
  canvasStatusFailed: 'Lỗi',
  canvasStatusDone: 'Xong',
  canvasBodyRunning: 'Đang xử lý lập luận…',
  canvasBodyWaiting: 'Đang chờ đầu vào…',
  canvasLegendParticle: 'Hạt sáng đang truyền',
  canvasLegendRunning: 'Đang xử lý',
  canvasLegendDone: 'Hoàn tất',
  canvasLegendMasked: 'Ẩn danh vào Trọng tài',
} as const;

export type TranslationKey = keyof typeof VI;

const EN: Record<TranslationKey, string> = {
  save: 'Save',
  cancel: 'Cancel',
  auto: 'Auto',
  openSettings: 'Open Settings',
  testBtn: 'Test',
  testingShort: 'Testing...',
  savingText: 'Saving...',

  langSelectAria: 'Select interface language',
  langSectionTitle: 'Interface Language',
  langSectionHint: 'Switch all buttons, reports, and flow views between 5 languages (synced across tabs).',
  langAutoAiNote: 'AI debaters and the Judge automatically reply in whatever language you type.',

  toggleLeftTitle: 'Toggle Rooms & AI Roster (key [)',
  navAriaLabel: 'View mode',
  navChat: 'Chat',
  navCompare: 'Compare',
  navReport: 'Report',
  navAudit: 'Audit',
  flowMapTitle: 'Open View 2: Visual AI Flow Map',
  themeToDarkTitle: 'Switch to Dark theme',
  themeToLightTitle: 'Switch to Warm Light theme',
  themeDarkLabel: 'Dark',
  themeLightLabel: 'Light',
  settingsTitle: 'Pipeline & Bridge Settings',
  rightDrawerTitle: 'Toggle Sources & Living Outline (key ])',
  sourcesCountBtn: 'Sources ({count})',
  loadingNotebook: 'Opening Research Lab…',
  alertBridgeOffline: 'Disconnected from dsh-gemini-bridge. Check Bridge server or open Settings.',
  alertGuestMode: 'Some Bridge lanes are not signed in (Guest Mode) — open Settings to sign in once or sync.',
  alertDuplicateLanes: '{lanes} share the same Google account — open Settings and switch account to separate them.',
  alertOverConcurrency: 'Concurrency ({max}) exceeds {healthy} healthy workers — requests may wait in queue.',
  aiRosterLabel: 'AI Roster:',
  aiChipTitle: 'Role: {name} · {acc} — Click to edit handle, role, model, or account',
  accPinned: 'Account: {acc}',
  accAuto: 'Account: Auto',
  addAiPinAcc: 'Add AI / Assign acc',
  judgeLabel: 'Judge:',
  judgeModelAria: 'Select Judge model',
  judgeAccAria: 'Select Judge account',
  accAutoOption: 'Acc: Auto',
  model4NeonDesc: '4 Neon — Deeper analysis',
  model4CarbonDesc: '4 Carbon — Coding & Complex',
  model4HydrogenDesc: '4 Hydrogen — Everyday helper',

  deepResearchPlanHeader: 'Review Deep Research Plan (arXiv · OpenAlex · Wikipedia)',
  deepResearchPlanHint: 'Search free open sources, then let {count} perspectives critique with [S#] citations.',
  runSourcesAndDebate: 'Search & Discuss',
  btnFullPipeline: 'Run Full Pipeline',
  btnFullPipelineTitle: '1-click workflow: Deep Research + Dossier → Council Analysis → Critique → Judge Synthesis',
  btnAutoDebate: 'Auto Next Round',
  btnRunJudge: 'Judge Synthesize',
  btnDeepResearch: 'Deep Research',
  btnAttachUrl: 'URL / Document',
  btnModeDeep: 'Deep Dossier Mode',
  btnModeStandard: 'Concise Mode',
  btnModeTitle: 'Toggle answer depth: Deep Dossier or Concise',
  mentionMenuTitle: 'Select perspective or tag group',
  mentionGroupSub: 'Group ({count} roles)',
  composerPlaceholder: 'Ask {count} active perspectives, or type @handle / @#tag to target…',
  sendTo: 'Send to:',
  activePerspectivesLabel: '{enabled}/{total} active',
  batchesLabel: '~{batches} batches ({max} threads)',
  btnSend: 'Send',
  attachModalTitle: 'Attach URL, PDF, or Text Excerpt',
  attachPdfLabel: 'Upload research PDF from computer (full text, max 15 MB)',
  attachPdfPick: 'Choose a PDF file (.pdf)…',
  attachPdfUnselect: 'Clear file',
  attachOrUrl: 'or paste article / arXiv / DOI URL',
  attachUrlPlaceholder: 'https://arxiv.org/abs/... or https://doi.org/...',
  attachOrNote: 'or paste PDF excerpt / notes directly',
  attachTitlePlaceholder: 'Document title (e.g., 2026 Policy Spec)',
  attachBodyPlaceholder: 'Paste key excerpt for AI perspectives to cite as [S#]…',
  attachAdding: 'Importing…',
  attachSubmit: 'Add to Sources',
  attachEmptyErr: 'Please choose a PDF, paste a URL, or enter a text excerpt.',
  attachFailErr: 'Could not import document.',

  leftAriaLabel: 'Rooms and AI Roster Drawer',
  tabRooms: 'Rooms',
  tabRoster: 'AI Roster ({enabled}/{total})',
  hideLeftTitle: 'Hide left drawer ([)',
  createNewRoom: 'New Room',
  recentRoomsCount: 'Recent Rooms ({count})',
  aiCountSuffix: '{total} AIs',
  enabledParen: ' ({count} on)',
  sourcesCountShort: '{count} sources',
  renameRoomTitle: 'Rename room',
  deleteRoomTitle: 'Delete room',
  roleAndModelHeading: 'Roles & Models in this Room',
  enabledSlashTotal: '{enabled}/{total} on',
  editRoleTitle: 'Edit @handle, role & instructions',
  deleteRoleTitle: 'Remove AI from room',
  handlePlaceholder: '@Handle (e.g., Research, Code_Pro)',
  roleNamePlaceholder: 'Role / responsibility title',
  rolePromptPlaceholder: 'Specific instructions for this AI…',
  saveChanges: 'Save Changes',
  roleLabelPrefix: 'Role: ',
  currentModelPrefix: '[Current] ',
  accAutoBridge: 'Account: Auto (Load-balanced)',
  accPrefix: 'Account: {id} — {name}',
  addAiHeading: 'Add AI perspective to room',
  quickHandlePlaceholder: 'Handle (e.g., Research, Critic)',
  quickNamePlaceholder: 'Specific role (e.g., Paper reader & fact-checker)',
  pinPrefix: 'Pin: {id} — {name}',
  addAiSubmit: 'Add AI',
  addAiProviderBtn: 'Add AI Provider (API Key / Bridge)',
  presetSaved: 'Saved as room preset!',
  savePresetBtn: 'Save Roster as Preset',
  tplAcademic: 'Academic Research',
  tplTech: 'Architecture & Code',
  tplCritic: 'Risk Critic',
  tplCost: 'Cost & Feasibility',

  rightAriaLabel: 'Sources and Living Outline Drawer',
  tabSources: 'Sources ({count})',
  tabOutline: 'Outline',
  hideRightTitle: 'Hide right drawer (])',
  noSourcesTitle: 'No cited sources yet',
  noSourcesHint: 'Use Deep Research or URL / Document below to import real papers from arXiv, OpenAlex, Wikipedia.',
  injectSourcesBtn: 'Print Full Sources into Chat ({count})',
  levelFullText: 'Full text',
  levelAbstractOnly: 'Abstract only',
  levelExcerpt: 'Excerpt',
  levelFullTextTitle: 'Full paper text extracted for deep verification',
  levelAbstractOnlyTitle: 'Only abstract is currently available',
  levelExcerptTitle: 'Excerpt / overview',
  citationsCountTitle: 'Citation count from OpenAlex',
  deleteSourceTitle: 'Delete source [{id}]',
  collapseExcerpt: 'Collapse excerpt',
  expandExcerpt: 'Show full text ({chars} chars)',
  consensusHeading: 'Consensus Points ({count})',
  consensusEmpty: 'Click Judge Synthesize after discussion to collect consensus points.',
  supportersPrefix: 'Supported by: ',
  contradictionsHeading: 'Key Contradictions ({count})',
  contradictionsEmpty: 'No major contradictions recorded yet.',
  askContradiction: 'Turn into follow-up question',
  gapsHeading: 'Knowledge Gaps ({count})',
  gapsEmpty: 'No knowledge gaps flagged.',
  fillGapsBtn: 'Search sources to fill {count} gaps',
  exportSectionTitle: 'Export Session',
  copiedBtn: 'Copied',
  copyMdBtn: 'Copy MD',

  renameRoomGroupTitle: 'Rename research room',
  focus1on1: '1-on-1 Focused Research',
  addPerspectiveBtn: 'Add role',
  toggleOffTitle: 'Click to pause this role for next turn',
  toggleOnTitle: 'Click to re-enable',
  compareSideBySide: 'Compare side-by-side',
  perspectivesBtnCount: 'Roles: {active}/{total}',
  compactCards: 'Compact ({count})',
  expandAll: 'Expand all',
  compare2to4: 'Compare 2–4 AIs',
  filterAllPerspectives: 'Filter: All roles',
  searchIdeasPlaceholder: 'Search…',
  emptyRoomTitle: 'Research room is ready',
  emptyRoomHint: 'Ask a question below for {count} active roles to analyze, or click Deep Research to fetch arXiv & OpenAlex papers first.',
  yourQuestion: 'Your Prompt',
  dossierTitle: 'Research Evidence Dossier (Full Context for Critics & Judge)',
  openDossier: 'Expand dossier',
  collapse: 'Collapse',
  dossierReadyFallback: '{count} sources ready for the AI council.',
  judgeRoundTitle: 'Judge · Round Synthesis',
  pinnedBadge: 'Pinned',
  expandDetail: 'Expand',
  conclusionPrefix: 'Conclusion: ',
  autoVerified: 'Auto-Verified',
  directCitationsCount: '{count} direct citations',
  inferredCitationsCount: '{count} inferred links',
  numericMatched: 'Numbers matched: {matched}/{checked}',
  unpinReport: 'Unpin from Report',
  pinToReport: 'Pin to Report',
  askRoleDirectly: 'Ask @{handle} directly',
  compareThisRole: 'Compare',
  statusQueued: 'Queued',
  statusQueuedDesc: 'Waiting for available slot under max_concurrency…',
  statusAnalyzing: 'Analyzing & synthesizing ({label})…',
  stopBtn: 'Stop',
  batchDone: 'Done {done}/{total}',
  batchRunning: 'Running: ',
  batchWaiting: 'Queued: {count}',

  inferredBadge: 'Inferred · {id}',
  inferredTooltip: 'Inferred from source {id} (not directly quoted)',
  directCitTooltip: 'Inspect direct citation source {id}',
  invalidCitTooltip: 'Source {id} does not exist in current Sources',

  comparingLabel: 'Comparing:',
  removeColTitle: 'Remove column',
  addCol: 'Add column',
  roundN: 'Round {round}',
  blindModeLabel: 'Blind: {state}',
  onBadge: 'ON',
  offBadge: 'OFF',
  candidatePrefix: 'Candidate {letter}',
  noReplyYet: 'No reply yet',
  roleNotInRound: 'This role did not participate in Round {round}.',
  askFollowUpRole: 'Follow up with @{handle}',
  noReportTitle: 'No Synthesis Report Yet',
  noReportDesc: 'Click below to have the Judge synthesize all arguments, score the Rubric per perspective, and build the final report.',
  judgeSynthesizing: 'Judge is synthesizing…',
  runJudgeBuildReport: 'Run Judge & Build Report',
  tocTitle: 'Report Contents',
  toc1: '1. Executive Summary',
  toc2: '2. Perspective Breakdown',
  toc3: '3. Open Debates',
  toc4: '4. Judge Rubric Scores',
  toc5: '5. References',
  integrityCheckTitle: 'Integrity Verification',
  validCitCheck: '• {valid}/{total} valid [S#] citations',
  inferredCitCheck: '• {count} inferred citations',
  unmatchedCitCheck: '• {count} unmatched citations',
  numericMatchCheck: '• Numbers matched: {matched}/{checked}',
  sourcesBreakdownCheck: '• Sources: {full} full-text · {abs} abstract',
  fallbackTurnsCheck: '• {count} model fallback turns',
  sec1Title: '1. Executive Summary',
  sec2Title: '2. Analysis by Perspective',
  sec3Title: '3. Open Debates',
  sec4Title: '4. Judge Rubric (across {count} perspectives)',
  sec5Title: '5. References ({count})',
  judgeExtractWarnings: 'Judge Scoring & Reliability Notes',
  colPerspective: 'Perspective',
  colEvidence: 'Evidence',
  colLogic: 'Logic',
  colRebuttal: 'Rebuttal',
  colTotal: 'Total',
  colSpread: 'Spread',
  colSpreadTitle: 'Maximum total score difference across order-swapped runs',
  fallbackBadge: 'Fallback',
  fallbackTitle: 'Judge did not return valid JSON scores; baseline 5.0 shown',
  spreadTitleMulti: 'Totals per run: {scores}',
  spreadTitleSingle: 'Single run only — stability not measured',
  judgeReliabilityTitle: 'Judge Reliability',
  judgeRunsValid: '• {parsed}/{requested} scoring runs returned valid JSON across swapped candidate orders (seed {seed}).',
  judgeOrderLine: '• Ranking: {status}.',
  rankingInsufficient: 'not enough runs to compare',
  rankingStable: 'preserved when candidate order is swapped',
  rankingChanged: 'CHANGED on order swap — do not rely on ranking',
  judgeFamilyLabel: 'Judge model family:',
  debaterFamiliesLabel: '; Debaters:',
  sameFamilyWarn: ' — same family, self-preference risk',
  claimSupportSummaryHeading: 'Sentence-level Claim Verification: {summary}',
  downgradedNoQuoteNote: ' (downgraded: quote not found verbatim in source)',
  sourceQuotePrefix: ' — source: ',
  noRetrievalInfo: 'No retrieval metadata',
  openSourceLink: 'Open source',
  downloadReportMd: 'Download Report (.md)',
  updateSynthesis: 'Re-run Judge',
  backToChat: 'Back to Chat',
  auditTitle: 'Verification Audit Trail',
  auditSubtitle: 'Inspect exact context, [S#] sources, and raw prompts sent to each role · Persisted in events.jsonl.',
  downloadJsonl: 'Download events.jsonl',
  auditCallMode: 'Call Mode',
  auditLoggedTurns: 'Logged Turns',
  auditTurnsUnit: '{count} turns',
  auditFallbackWarns: 'Fallback Warnings',
  auditVerifiedSources: 'Verified Sources',
  auditSourcesUnit: '{count} sources',
  auditFallbackBanner: 'Model Fallback Warnings',
  auditEmpty: 'No audit records yet. Send a prompt in Chat to inspect raw prompts.',
  auditSourcesPrefix: 'Sources: ',
  hideRawPrompt: 'Hide raw prompt',
  viewRawPrompt: 'View raw prompt',
  reportTitleTpl: 'Synthesis Report: {roomTitle}',
  reportSubtitleTpl: 'Judge ({mode}) · {runs} runs · {sources} sources · {active}/{total} active perspectives',
  judgeModeAnon: 'Anonymized',
  judgeModePublic: 'Public',
  execSummaryEmpty: '⚠ Judge returned an empty executive summary.',
  execSummaryNoSynthesis:
    '⚠ Judge did not return valid JSON in any run, so synthesis is unavailable. Re-run or switch the Judge model in Settings.',
  breakdownFallbackTpl: 'Could not extract detailed review from Judge for @{handle} (using fallback score).',
  breakdownDefaultTpl: 'Specialist perspective contribution from @{handle}.',
  warnFallbackScored: '@{handle}: Judge did not return valid JSON scores — showing fallback baseline (5.0).',
  warnPartialScores: '@{handle}: only {scored}/{total} judge runs returned valid scores.',
  warnScoreUnstable: '@{handle}: total score varied by {spread} across swapped candidate orders — UNSTABLE.',
  warnRankingChanged: 'Perspective ranking CHANGED when candidate order was swapped — do not rely on ranking.',
  warnSameFamily:
    "Judge shares model family '{family}' with debating AIs — self-preference risk. Consider picking a Judge from another provider in Settings.",
  warnParseFailed: 'Judge returned invalid JSON in {failed}/{total} runs.',
  warnCallFailed: '{failed}/{total} judge runs failed to call model: {error}',
  warnClaimUnsupported: '@{handle}: {unsupported}/{checked} cited claims were judged UNSUPPORTED by sources.',
  warnClaimDowngraded:
    "{count} 'supported' label(s) downgraded to 'unclear' because quoted evidence was not found verbatim in source.",
  warnClaimCheckFailed: 'Could not run sentence-level claim verification: {error}',
  warnClaimUnchecked: '{unchecked}/{total} claims did not receive a valid label from verification model.',
  warnInvalidCitations: 'Detected citation IDs missing from Source Library: {idsText}.',
  warnUnverifiedNumbers:
    '{count} cited figure(s) were not found verbatim in the cited source text: {preview}{extra}.',
  warnUnverifiedNumbersExtra: ' and {extraCount} more',
  roundIndependentTpl: 'Round {round} · Independent ({count})',
  roundDiscussTpl: 'Round {round} · Follow-up ({count})',
  roundRebuttalTpl: 'Round {round} · Cross-rebuttal ({count})',
  roundJudgeTpl: 'Round {round} · Judge Synthesis',
  roundDeepResearchTpl: 'Round {round} · Deep Research ({count} new sources)',
  roundDossierTpl: 'Round {round} · Source Library Dossier ({count})',
  httpServerError: 'Server error (HTTP {status})',
  errLoadRooms: 'Could not load rooms.',
  errSaveRoom: 'Could not save room changes.',
  errCreateRoom: 'Could not create new room.',
  errDeleteRoom: 'Could not delete room.',
  errPerspectiveCall: 'Failed to call AI perspective.',
  errJudgeRun: 'Failed to run Judge.',
  errDeepResearch: 'Could not fetch Deep Research sources.',
  errExtractUrl: 'Could not extract content from URL.',
  flowStageStopped: 'Stopped',
  flowActorUserStop: 'Stopped by user',
  flowAbortSummary: 'User manually aborted the running turn.',
  flowStageInput: 'Input',
  flowActorUser: 'You (Prompt)',
  flowStartSummary: '"{preview}" · Sent to {active}/{total} AIs',
  flowPromptSentTo: 'Prompt sent to @{handle}',
  flowStageOutput: 'Delivered',
  flowActorOutput: 'Result for You',
  flowOutputSummary: 'Completed {done}/{total} perspectives for {roundLabel}.',
  flowOutputContent: 'All responses are ready to read in Chat view.',
  flowStageJudge: 'Judge',
  flowActorJudge: 'Judge',
  flowRound0Debate: 'Round 0 · Independent',
  flowCouncilStage: 'N-AI Council',
  flowDisabledSummary: 'Paused — did not receive prompt this turn',
  flowDisabledContent: '@{handle} is paused for this run, so no data edges connect into it.',
  flowStageFallback: 'Stage {idx}',
  inspectorDrawerAria: 'Selected node or edge details',
  composerGroupPrefix: 'group #{tags}',
  composerTargetsCount: '{prefix} ({count} AIs)',
  composerEnabledRatio: '{enabled}/{total} perspectives enabled',
  settingsLaneRenamed: 'Renamed {id} to "{name}".',
  settingsLaneReset: 'Reset {id} display name to default.',
  settingsErrRename: 'Could not rename account.',
  settingsAssignedLane: 'Assigned {id}{namePart} to room as @{handle} ({role}).',
  settingsCreatedLane: 'Created lane {id} (:{port}). Click "Sign in" on {id} card to add its Google account.',
  settingsErrCreateLane: 'Could not create new account lane.',
  settingsNoLoggedInSync: 'No signed-in profiles available for silent sync. Sign in on each account first.',
  settingsSyncedAll: 'Silent synced {synced}/{total} profiles.',
  settingsErrSyncAll: 'Could not silent sync all profiles.',
  settingsLoginOpened:
    'Opened real browser window for {id}. Sign in to Google + Gemini then close the window (or click "Done & Sync").',
  settingsErrLogin: 'Could not open login browser for {id}.',
  settingsCookieLoaded: 'Extracted & loaded cookies for {id}{keyPart}.',
  settingsErrFinishLogin: 'Could not finish sync for {id}.',
  settingsSyncedOne: 'Silent synced refreshed cookies for {id}{keyPart}.',
  settingsErrSyncOne: 'Silent sync failed for {id}.',
  settingsProviderAdded: 'Added "{name}" ({model}).',
  settingsErrAddProvider: 'Could not add AI provider.',
  settingsTestOkFallback: 'Connection OK',
  settingsErrTest: 'Connection failed.',
  settingsErrDeleteProvider: 'Could not delete AI provider.',
  dossierSummaryTpl: 'Research dossier ({count} sources)',
  dossierFullSummaryTpl: 'Full dossier of {count} sources from Source Library',
  defaultResearchQuery: 'Find latest scholarly evidence for the current room topic',
  defaultPipelineQuery: 'Deep research, multi-perspective critique, and synthesis for the current room topic',
  savedPresetDesc: 'Saved from room ({count} perspectives)',

  settingsAriaLabel: 'AI, Model, and Orchestration Settings',
  settingsTitleHeading: 'AI & Model Settings',
  settingsSubtitle: 'Configure Bridge lanes, API keys, language, and Judge behavior.',
  connectedProvidersTitle: 'Connected AI Providers ({count})',
  reloadProvidersTitle: 'Refresh models and Bridge lanes',
  addAiBtn: 'Add AI',
  addProviderHeading: 'Add AI Provider',
  kindBridgeLocal: 'Local Bridge',
  kindGeminiApi: 'Gemini API',
  kindOpenAiCompat: 'OpenAI / Other',
  providerNameLabel: 'Display Name',
  providerUrlBridge: 'Bridge URL (Gateway or worker)',
  providerUrlBase: 'API Base URL',
  apiKeyOptional: '(optional)',
  apiKeyOllama: '(leave blank for local Ollama)',
  apiKeyRequired: '(required)',
  defaultModelLabel: 'Default Model',
  roleOnAddLabel: 'Default Role when added',
  alsoAddToRoomLabel: 'Also add as an active role in the current room',
  saveProviderBtn: 'Save Provider',
  loggedInLanesSummary: '{healthy}/{total} lanes signed in ({lanes})',
  deleteProviderTitle: 'Remove this provider',
  perAccountBridge: 'Bridge Accounts ({mode})',
  syncAllTitle: 'Background sync all signed-in accounts',
  syncingText: 'Syncing...',
  syncAllBtn: 'Sync All',
  createLaneTitle: 'Create new Bridge lane (.env.accN)',
  creatingText: 'Creating...',
  addLaneBtn: 'Add Lane',
  laneBrowserOpen: 'Browser login window open...',
  laneCookieOk: 'Cookie signed in',
  laneOff: 'OFF',
  laneGuest: 'Guest Mode',
  renameLaneTitle: 'Set friendly name for this account',
  renameLaneBtn: 'Name',
  assignRoleBtn: 'Assign Role',
  gettingCookieText: 'Extracting cookies...',
  finishLoginBtn: 'Done & Sync',
  openingText: 'Opening...',
  switchAccBtn: 'Switch acc',
  switchSeparateAccBtn: 'Switch separate acc',
  loginOnceBtn: 'Sign in once',
  syncBgBtn: 'Sync',
  dupWarning: 'Sharing the same Google account as {others}. Click Switch separate acc to isolate.',
  pinAssignTitle: 'Pin {id} ({name}) to room {room}',
  pinAssignBtn: 'Pin {id} to room',
  judgeModelLabel: 'Judge Model (Synthesizes & scores Rubric)',
  judgeLaneLabel: 'Dedicated Bridge Lane (acc) for Judge',
  judgeLaneAuto: 'Auto (Bridge chooses idle lane)',
  judgeModelHint: 'Tip: Pick a strong reasoning model (or non-Gemini provider) for more objective judging.',
  concurrencyLabel: 'Max Concurrency (max_concurrency)',
  concurrencyThreads: '{count} threads',
  concurrencySeq: '1 (sequential)',
  overSubscribedWarn: 'Concurrency ({max}) exceeds {healthy}/{total} signed-in Bridge lanes.',
  behaviorSectionTitle: 'Research & Judge Behavior',
  approveResearchTitle: 'Approve Deep Research Query',
  approveResearchDesc: 'Preview and edit the search query before querying arXiv/OpenAlex.',
  anonymizeJudgeTitle: 'Anonymize Perspectives for Judge',
  anonymizeJudgeDesc: 'Mask handles as Candidate A/B/C for blind scoring.',
  judgeRunsTitle: 'Judge Scoring Runs',
  judgeRunsDesc: 'Swaps candidate order on each run to measure position bias and score spread.',
  nRunsOption: '{n} runs',
  claimCheckTitle: 'Sentence-Level Claim Verification',
  claimCheckDesc: 'Verify up to 30 cited [S#] sentences against verbatim quotes in sources.',

  flowRoomAria: 'Select room to inspect flow',
  flowTabMap: 'Flow Map',
  flowTabSwimlane: 'Swimlane Timeline',
  flowThemeTitle: 'Toggle Light / Dark theme (synced)',
  openChatBtn: 'Open Chat Lab',
  filterTagAria: 'Filter by tag',
  filterAllTags: 'All #tags',
  onlyEnabledAi: 'Active AIs only',
  inspectorEdge: 'Selected Data Flow',
  inspectorNode: 'Selected Stage Node',
  maskedAsNote: 'Masked as {alias} before passing to the Judge for blind evaluation.',
  transferredSummary: 'Transferred Content Summary',
  transferredFallback: 'Full argument text and citations forwarded to the next stage.',
  transferKind: 'Transfer Kind',
  contextLength: 'Context Length',
  charsUnit: '{chars} chars',
  attachedSources: 'Attached Sources',
  hideSentText: 'Hide sent text',
  viewSentText: 'View full sent text',
  nodeKeyPoint: 'Node Key Point ({stage})',
  noSummaryYet: 'No summary yet.',
  statusLabel: 'Status',
  statusDisabled: 'Disabled',
  statusRunning: 'Running',
  statusCompleted: 'Completed',
  statusError: 'Error',
  workerLaneLabel: 'Worker Lane',
  elapsedLabel: 'Elapsed Time',
  inputsReadLabel: 'Inputs Read',
  streamsUnit: '{count} streams',
  inputsListTitle: 'Received Inputs',
  hideRawJson: 'Hide full text & JSON',
  viewRawJson: 'View full text & JSON',
  pauseBtn: 'Pause',
  playBtn: 'Replay',
  stepBackTitle: 'Step back',
  stepFwdTitle: 'Step forward',
  noEventsYet: 'No flow events in this room yet',
  eventStepLabel: 'Event {cur}/{total}: {stage} · {name}',
  liveWatching: 'Watching LIVE',
  backToLive: 'Go LIVE',
  speedLabel: 'Speed:',
  swimlaneTitle: 'Worker Swimlane Timeline',
  swimlaneDesc: 'Inspect parallel execution timing and latency across acc1..accN workers. Click any bar for details.',
  swimlaneTotalSpan: 'Timeline span: 0s – {max}s',
  swimlaneEmpty: 'No worker runs recorded yet. Send a prompt in Chat Lab to watch real-time lanes.',
  swimlaneWorkerCol: 'Lane / Worker',

  srcTypePreprint: 'Preprint (non-peer-reviewed)',
  srcTypePublished: 'Published Venue',
  srcTypeOtherScholarly: 'Other Scholarly',
  srcTypeEncyclopedia: 'Encyclopedia',
  srcTypeWeb: 'Web Page',
  srcTypeWebPdf: 'Web PDF',
  srcTypeUserUpload: 'Uploaded PDF',
  srcTypeUserExcerpt: 'Pasted Excerpt',
  srcTypeUnclassified: 'Unclassified',
  retQuery: 'Searched via {provider} · "{query}" · rank {rank} · {when}',
  retUrl: 'Fetched URL · {when}',
  retUpload: 'Uploaded "{filename}" · {when}',
  claimUnchecked: 'unchecked',
  claimSummary: '{supported}/{checked} supported · {partial} partial · {unsupported} unsupported · {unclear} unclear',

  canvasZoomOut: 'Zoom out',
  canvasZoomIn: 'Zoom in',
  canvasFitScreenTitle: 'Fit to screen',
  canvasFitScreenBtn: 'Fit screen',
  canvasEmptyTitle: 'No data flow in this room yet',
  canvasEmptyHint: 'Send a prompt in Chat Lab (or pick a room with existing messages above) to inspect the live execution graph.',
  canvasStagePrefix: 'STAGE {idx} · {label}',
  canvasMaskedBadge: 'Masked',
  canvasStatusDisabled: 'Disabled',
  canvasStatusRunning: 'Running · {time}',
  canvasStatusFailed: 'Error',
  canvasStatusDone: 'Done',
  canvasBodyRunning: 'Analyzing arguments…',
  canvasBodyWaiting: 'Waiting for input…',
  canvasLegendParticle: 'Live data particle',
  canvasLegendRunning: 'Running',
  canvasLegendDone: 'Completed',
  canvasLegendMasked: 'Masked for Judge',
};

type CjkLang = 'zh' | 'ja' | 'ko';

const BASE_TRANSLATIONS: Record<'vi' | 'en', Record<TranslationKey, string>> = {
  vi: VI,
  en: EN,
};

const cjkCache: Partial<Record<CjkLang, Record<TranslationKey, string>>> = {};
let cjkPromise: Promise<void> | null = null;

export function isCjkLanguage(lang: UiLanguage): lang is CjkLang {
  return lang === 'zh' || lang === 'ja' || lang === 'ko';
}

export function ensureCjkLocaleLoaded(lang: UiLanguage): Promise<void> {
  if (!isCjkLanguage(lang) || cjkCache[lang]) return Promise.resolve();
  if (!cjkPromise) {
    cjkPromise = import('./localesCjk.ts')
      .then((mod) => {
        Object.assign(cjkCache, mod.CJK_LOCALES);
      })
      .catch(() => {
        cjkPromise = null;
      });
  }
  return cjkPromise;
}

const SUPPORTED_LANG_SET = new Set<UiLanguage>(['vi', 'en', 'zh', 'ja', 'ko']);

export function loadUiLanguage(): UiLanguage {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved && SUPPORTED_LANG_SET.has(saved as UiLanguage)) return saved as UiLanguage;
  } catch {
    // ignore
  }
  return 'vi';
}

export function getLocaleForLanguage(lang: UiLanguage): string {
  return UI_LANGUAGES.find((l) => l.code === lang)?.locale ?? 'vi-VN';
}

export function translate(
  lang: UiLanguage,
  key: TranslationKey,
  vars?: Record<string, string | number>
): string {
  const table = isCjkLanguage(lang) ? (cjkCache[lang] ?? EN) : BASE_TRANSLATIONS[lang] ?? VI;
  let template: string = table[key] ?? VI[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      template = template.replaceAll(`{${k}}`, String(v));
    }
  }
  return template;
}

interface I18nContextValue {
  lang: UiLanguage;
  locale: string;
  setLang: (next: UiLanguage) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'vi',
  locale: 'vi-VN',
  setLang: () => {},
  t: (key, vars) => translate('vi', key, vars),
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<UiLanguage>(() => loadUiLanguage());
  const [cjkRevision, setCjkRevision] = useState(0);

  const setLang = useCallback((next: UiLanguage) => {
    setLangState(next);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    if (isCjkLanguage(lang) && !cjkCache[lang]) {
      let alive = true;
      void ensureCjkLocaleLoaded(lang).then(() => {
        if (alive) setCjkRevision((n) => n + 1);
      });
      return () => {
        alive = false;
      };
    }
  }, [lang]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LANG_STORAGE_KEY && e.newValue && SUPPORTED_LANG_SET.has(e.newValue as UiLanguage)) {
        setLangState(e.newValue as UiLanguage);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      locale: getLocaleForLanguage(lang),
      setLang,
      t: (key, vars) => translate(lang, key, vars),
    }),
    // cjkRevision ép re-render ngay khi chunk localesCjk.ts nạp xong
    [lang, setLang, cjkRevision]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div
      className={`inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)] transition-colors ${
        compact ? 'px-2 py-1' : 'px-2.5 py-1.5 w-full justify-between'
      }`}
      title={t('langSelectAria')}
    >
      <div className="inline-flex items-center gap-1.5 min-w-0">
        <Globe className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
        {!compact && (
          <span className="text-xs font-medium text-[var(--ink)] truncate">
            {UI_LANGUAGES.find((l) => l.code === lang)?.label}
          </span>
        )}
      </div>
      <select
        aria-label={t('langSelectAria')}
        value={lang}
        onChange={(e) => setLang(e.target.value as UiLanguage)}
        className="bg-transparent text-xs font-medium text-[var(--ink)] focus:outline-none cursor-pointer"
      >
        {UI_LANGUAGES.map((item) => (
          <option key={item.code} value={item.code}>
            {compact ? `${item.shortLabel} · ${item.label}` : item.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ============================================================================
   Dynamic Content Localization Helpers (AI Handles, Role Names, Models, Rooms)
============================================================================ */

const HANDLE_LABELS: Record<string, Record<UiLanguage, string>> = {
  'nghiên_cứu': {
    vi: 'Nghiên_cứu',
    en: 'Research',
    zh: '研究',
    ja: '研究',
    ko: '연구',
  },
  'phản_biện': {
    vi: 'Phản_biện',
    en: 'Critic',
    zh: '反驳',
    ja: '反論',
    ko: '반박',
  },
  'kỹ_thuật': {
    vi: 'Kỹ_thuật',
    en: 'Tech',
    zh: '技术',
    ja: '技術',
    ko: '기술',
  },
  'chi_phí': {
    vi: 'Chi_phí',
    en: 'Cost',
    zh: '成本',
    ja: 'コスト',
    ko: '비용',
  },
};

export function localizeHandle(handle: string, lang: UiLanguage): string {
  const key = handle.trim().toLowerCase();
  return HANDLE_LABELS[key]?.[lang] ?? handle;
}

export function getHandleAliases(handle: string): string[] {
  const clean = handle.trim().toLowerCase();
  const entry = HANDLE_LABELS[clean];
  if (!entry) return [clean];
  return Array.from(new Set([clean, ...Object.values(entry).map((v) => v.toLowerCase())]));
}

const ROLE_NAME_LABELS: Record<string, Record<UiLanguage, string>> = {
  'Chuyên gia Nghiên cứu (Đọc nguồn & Phân tích)': {
    vi: 'Chuyên gia Nghiên cứu (Đọc nguồn & Phân tích)',
    en: 'Research Specialist (Sources & Analysis)',
    zh: '研究专家（文献阅读与分析）',
    ja: 'リサーチ専門家（文献読解・分析）',
    ko: '연구 전문가 (자료 검토 및 분석)',
  },
  'Nghiên cứu & Đề xuất giải pháp': {
    vi: 'Nghiên cứu & Đề xuất giải pháp',
    en: 'Research & Solution Design',
    zh: '研究与方案设计',
    ja: '研究・ソリューション提案',
    ko: '연구 및 솔루션 제안',
  },
  'Phản biện & Soi rủi ro': {
    vi: 'Phản biện & Soi rủi ro',
    en: 'Critique & Risk Audit',
    zh: '反驳与风险排查',
    ja: '反論・リスク検証',
    ko: '반박 및 리스크 검증',
  },
  'Nghiên cứu & Tổng hợp nguồn': {
    vi: 'Nghiên cứu & Tổng hợp nguồn',
    en: 'Research & Evidence Synthesis',
    zh: '研究与证据综合',
    ja: '研究・根拠統合',
    ko: '연구 및 근거 종합',
  },
  'Nghiên cứu & Tổng hợp bằng chứng': {
    vi: 'Nghiên cứu & Tổng hợp bằng chứng',
    en: 'Research & Evidence Synthesis',
    zh: '研究与证据综合',
    ja: '研究・根拠統合',
    ko: '연구 및 근거 종합',
  },
  'Kiến trúc Kỹ thuật & Hiệu năng': {
    vi: 'Kiến trúc Kỹ thuật & Hiệu năng',
    en: 'System Architecture & Performance',
    zh: '技术架构与性能',
    ja: '技術設計・パフォーマンス',
    ko: '시스템 아키텍처 및 성능',
  },
  'Kiến trúc Kỹ thuật & Code': {
    vi: 'Kiến trúc Kỹ thuật & Code',
    en: 'Technical Architecture & Code',
    zh: '技术架构与代码',
    ja: '技術設計・コード',
    ko: '기술 아키텍처 및 코드',
  },
  'Phản biện & Soi điểm mù': {
    vi: 'Phản biện & Soi điểm mù',
    en: 'Critique & Blind-Spot Detection',
    zh: '批判与盲点排查',
    ja: '批判・盲点検出',
    ko: '비판 및 사각지대 점검',
  },
  'Đánh giá Chi phí & Thực tế triển khai': {
    vi: 'Đánh giá Chi phí & Thực tế triển khai',
    en: 'Cost & Rollout Feasibility',
    zh: '成本与落地可行性',
    ja: 'コスト・実装可能性評価',
    ko: '비용 및 구현 타당성 평가',
  },
  'Đánh giá Chi phí & Khả thi': {
    vi: 'Đánh giá Chi phí & Khả thi',
    en: 'Cost & Feasibility Analysis',
    zh: '成本与可行性分析',
    ja: 'コスト・実現性評価',
    ko: '비용 및 타당성 평가',
  },
};

export function localizeRoleName(name: string, lang: UiLanguage): string {
  const entry = ROLE_NAME_LABELS[name.trim()];
  return entry ? entry[lang] : name;
}

const MODEL_DESC_BY_ID: Record<string, Record<UiLanguage, string>> = {
  'gemini-neon': {
    vi: '4 Neon — Phân tích sâu hơn',
    en: '4 Neon — Deeper analysis',
    zh: '4 Neon — 深度分析',
    ja: '4 Neon — 深い分析',
    ko: '4 Neon — 심층 분석',
  },
  'gemini-carbon': {
    vi: '4 Carbon — Lập trình & Phức tạp',
    en: '4 Carbon — Coding & Complex',
    zh: '4 Carbon — 编程与复杂任务',
    ja: '4 Carbon — 開発・複雑タスク',
    ko: '4 Carbon — 코딩 및 복합 추론',
  },
  'gemini-4-hydrogen': {
    vi: '4 Hydrogen — Trợ giúp hằng ngày',
    en: '4 Hydrogen — Everyday helper',
    zh: '4 Hydrogen — 日常助手',
    ja: '4 Hydrogen — 日常アシスタント',
    ko: '4 Hydrogen — 일상 도우미',
  },
  'gemini-tự-động': {
    vi: 'Tự động (Gemini Auto)',
    en: 'Auto (Gemini Auto)',
    zh: '自动 (Gemini Auto)',
    ja: '自動 (Gemini Auto)',
    ko: '자동 (Gemini Auto)',
  },
  'gemini-auto': {
    vi: 'Tự động (Gemini Auto)',
    en: 'Auto (Gemini Auto)',
    zh: '自动 (Gemini Auto)',
    ja: '自動 (Gemini Auto)',
    ko: '자동 (Gemini Auto)',
  },
};

export function localizeModelLabel(model: { id: string; label: string }, lang: UiLanguage): string {
  const key = model.id.trim().toLowerCase();
  return MODEL_DESC_BY_ID[key]?.[lang] ?? model.label;
}

const ROOM_TITLE_EXACT: Record<string, Record<UiLanguage, string>> = {
  'Phòng nghiên cứu mới': {
    vi: 'Phòng nghiên cứu mới',
    en: 'New Research Room',
    zh: '新研究房间',
    ja: '新規リサーチルーム',
    ko: '새 연구방',
  },
  'Phòng mới · Đề xuất & Phản biện': {
    vi: 'Phòng mới · Đề xuất & Phản biện',
    en: 'New Room · Proposal & Critique',
    zh: '新房间 · 提案与反驳',
    ja: '新規ルーム · 提案と反論',
    ko: '새 방 · 제안 및 반박',
  },
  'Phòng mới · Nghiên cứu độc lập': {
    vi: 'Phòng mới · Nghiên cứu độc lập',
    en: 'New Room · Solo Research',
    zh: '新房间 · 独立研究',
    ja: '新規ルーム · 単独リサーチ',
    ko: '새 방 · 단독 연구',
  },
};

const NEW_ROOM_PREFIX: Record<UiLanguage, string> = {
  vi: 'Phòng mới · ',
  en: 'New Room · ',
  zh: '新房间 · ',
  ja: '新規ルーム · ',
  ko: '새 방 · ',
};

export function isDefaultRoomTitle(title: string): boolean {
  const trimmed = title.trim();
  return (
    trimmed in ROOM_TITLE_EXACT ||
    Object.values(NEW_ROOM_PREFIX).some((prefix) => trimmed.startsWith(prefix))
  );
}

export function localizeRoomTitle(title: string, lang: UiLanguage): string {
  const trimmed = title.trim();
  if (trimmed in ROOM_TITLE_EXACT) {
    return ROOM_TITLE_EXACT[trimmed][lang];
  }
  if (trimmed.startsWith('Phòng mới · ')) {
    return `${NEW_ROOM_PREFIX[lang]}${trimmed.slice('Phòng mới · '.length)}`;
  }
  return title;
}

const PRESET_LABELS: Record<string, Record<UiLanguage, { name: string; description: string }>> = {
  'preset-1ai': {
    vi: {
      name: '1 AI · Nghiên cứu độc lập',
      description: 'Bắt đầu với 1 AI nghiên cứu chính; khi cần thêm góc nhìn mới bấm + Thêm AI.',
    },
    en: {
      name: '1 AI · Solo Research',
      description: 'Start with 1 primary researcher AI; click + Add AI whenever you want more roles.',
    },
    zh: {
      name: '1 AI · 独立研究',
      description: '从 1 位主研究 AI 开始；需要更多视角时点击 + 添加 AI。',
    },
    ja: {
      name: '1 AI · 単独リサーチ',
      description: 'まず主研究AI 1名で開始し、必要になったら「+ AI追加」で視点を増やせます。',
    },
    ko: {
      name: '1 AI · 단독 연구',
      description: '핵심 연구 AI 1개로 시작하고, 필요할 때 + AI 추가로 관점을 늘리세요.',
    },
  },
  'preset-2ai': {
    vi: {
      name: '2 AI · Đề xuất & Phản biện',
      description: '1 AI đề xuất giải pháp kỹ thuật + 1 AI phản biện chỉ ra điểm mù và rủi ro.',
    },
    en: {
      name: '2 AIs · Proposal & Critique',
      description: '1 AI proposes technical solutions + 1 critic AI exposes blind spots and risks.',
    },
    zh: {
      name: '2 AI · 提案与反驳',
      description: '1 位 AI 提出技术方案 + 1 位反驳 AI 指出盲点与风险。',
    },
    ja: {
      name: '2 AI · 提案と反論',
      description: '1名が解決策を提案し、もう1名が盲点やリスクを徹底検証します。',
    },
    ko: {
      name: '2 AI · 제안 및 반박',
      description: 'AI 1명이 해결책을 제안하고, 다른 1명이 사각지대와 리스크를 반박합니다.',
    },
  },
};

export function localizePreset(
  preset: { id: string; name: string; description: string },
  lang: UiLanguage
): { name: string; description: string } {
  return PRESET_LABELS[preset.id]?.[lang] ?? { name: preset.name, description: preset.description };
}

export function formatStructuredWarning(
  item: { code: string; params?: Record<string, unknown>; text: string },
  lang: UiLanguage
): string {
  const p = item.params ?? {};
  const handle = p.handle ? localizeHandle(String(p.handle), lang) : '';
  switch (item.code) {
    case 'fallback_scored':
      return translate(lang, 'warnFallbackScored', { handle });
    case 'partial_scores':
      return translate(lang, 'warnPartialScores', {
        handle,
        scored: Number(p.scored ?? 0),
        total: Number(p.total ?? 0),
      });
    case 'score_unstable':
      return translate(lang, 'warnScoreUnstable', { handle, spread: String(p.spread ?? '') });
    case 'ranking_changed':
      return translate(lang, 'warnRankingChanged');
    case 'same_family':
      return translate(lang, 'warnSameFamily', { family: String(p.family ?? '') });
    case 'parse_failed':
      return translate(lang, 'warnParseFailed', {
        failed: Number(p.failed ?? 0),
        total: Number(p.total ?? 0),
      });
    case 'call_failed':
      return translate(lang, 'warnCallFailed', {
        failed: Number(p.failed ?? 0),
        total: Number(p.total ?? 0),
        error: String(p.error ?? ''),
      });
    case 'claim_unsupported':
      return translate(lang, 'warnClaimUnsupported', {
        handle,
        unsupported: Number(p.unsupported ?? 0),
        checked: Number(p.checked ?? 0),
      });
    case 'claim_downgraded':
      return translate(lang, 'warnClaimDowngraded', { count: Number(p.count ?? 0) });
    case 'claim_check_failed':
      return translate(lang, 'warnClaimCheckFailed', { error: String(p.error ?? '') });
    case 'claim_unchecked':
      return translate(lang, 'warnClaimUnchecked', {
        unchecked: Number(p.unchecked ?? 0),
        total: Number(p.total ?? 0),
      });
    case 'invalid_citations':
      return translate(lang, 'warnInvalidCitations', { idsText: String(p.idsText ?? '') });
    case 'unverified_numbers': {
      const extraCount = Number(p.extraCount ?? 0);
      const extra =
        extraCount > 0 ? translate(lang, 'warnUnverifiedNumbersExtra', { extraCount }) : '';
      return translate(lang, 'warnUnverifiedNumbers', {
        count: Number(p.count ?? 0),
        preview: String(p.preview ?? ''),
        extra,
      });
    }
    default:
      return item.text;
  }
}

export function formatReportTitle(
  report: { title: string; titleParams?: { roomTitle: string } },
  lang: UiLanguage
): string {
  if (report.titleParams?.roomTitle !== undefined) {
    return translate(lang, 'reportTitleTpl', {
      roomTitle: localizeRoomTitle(report.titleParams.roomTitle, lang),
    });
  }
  return report.title;
}

export function formatReportSubtitle(
  report: {
    subtitle: string;
    metaParams?: {
      anonymize: boolean;
      runsCompleted: number;
      sourceCount: number;
      activeCount: number;
      totalCount: number;
    };
  },
  lang: UiLanguage
): string {
  if (report.metaParams) {
    const m = report.metaParams;
    return translate(lang, 'reportSubtitleTpl', {
      mode: translate(lang, m.anonymize ? 'judgeModeAnon' : 'judgeModePublic'),
      runs: m.runsCompleted,
      sources: m.sourceCount,
      active: m.activeCount,
      total: m.totalCount,
    });
  }
  return report.subtitle;
}

export function formatExecutiveSummary(
  report: { executiveSummary: string; executiveSummaryCode?: 'empty_summary' | 'no_synthesis' | null },
  lang: UiLanguage
): string {
  if (report.executiveSummaryCode === 'empty_summary') return translate(lang, 'execSummaryEmpty');
  if (report.executiveSummaryCode === 'no_synthesis') return translate(lang, 'execSummaryNoSynthesis');
  return report.executiveSummary;
}

export function formatBreakdownSummary(
  item: { handle: string; summary: string; summaryCode?: 'breakdown_fallback' | 'breakdown_default' | null },
  lang: UiLanguage
): string {
  const handle = localizeHandle(item.handle, lang);
  if (item.summaryCode === 'breakdown_fallback') return translate(lang, 'breakdownFallbackTpl', { handle });
  if (item.summaryCode === 'breakdown_default') return translate(lang, 'breakdownDefaultTpl', { handle });
  return item.summary;
}

export function getStoredUiLanguage(): UiLanguage {
  if (typeof window === 'undefined') return 'vi';
  try {
    const raw = localStorage.getItem(LANG_STORAGE_KEY);
    if (raw === 'vi' || raw === 'en' || raw === 'zh' || raw === 'ja' || raw === 'ko') {
      return raw;
    }
  } catch {
    // ignore
  }
  return 'vi';
}

export function formatRoundLabel(
  msg: { round: number; roundLabel: string; roundKind?: string; roundCount?: number },
  lang: UiLanguage
): string {
  const count = msg.roundCount ?? 0;
  switch (msg.roundKind) {
    case 'independent':
      return translate(lang, 'roundIndependentTpl', { round: msg.round, count });
    case 'discuss':
      return translate(lang, 'roundDiscussTpl', { round: msg.round, count });
    case 'rebuttal':
      return translate(lang, 'roundRebuttalTpl', { round: msg.round, count });
    case 'judge':
      return translate(lang, 'roundJudgeTpl', { round: msg.round });
    case 'deep_research':
      return translate(lang, 'roundDeepResearchTpl', { round: msg.round, count });
    case 'dossier':
      return translate(lang, 'roundDossierTpl', { round: msg.round, count });
    default:
      return msg.roundLabel;
  }
}

export function localizeFlowStageLabel(stageLabel: string, lang: UiLanguage): string {
  switch (stageLabel) {
    case 'Đầu vào':
      return translate(lang, 'flowStageInput');
    case 'Trả về Bạn':
      return translate(lang, 'flowStageOutput');
    case 'Trọng tài':
      return translate(lang, 'flowStageJudge');
    case 'Đã dừng':
      return translate(lang, 'flowStageStopped');
    case 'Vòng 0 · Độc lập':
      return translate(lang, 'flowRound0Debate');
    case 'Hội đồng N AI':
      return translate(lang, 'flowCouncilStage');
    default: {
      const m = stageLabel.match(/^Chặng\s+(\d+)$/);
      if (m) return translate(lang, 'flowStageFallback', { idx: m[1] });
      return stageLabel;
    }
  }
}

export function localizeFlowActorName(
  actor: { id?: string; name: string; handle?: string },
  lang: UiLanguage
): string {
  if (actor.handle) return localizeRoleName(actor.name, lang);
  switch (actor.name) {
    case 'Bạn (Prompt)':
      return translate(lang, 'flowActorUser');
    case 'Kết quả trả Bạn':
      return translate(lang, 'flowActorOutput');
    case 'Trọng tài':
      return translate(lang, 'flowActorJudge');
    case 'Người dùng dừng':
      return translate(lang, 'flowActorUserStop');
    default:
      return actor.name;
  }
}
