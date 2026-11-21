import type { PerspectivePreset } from './types.ts';

export const DEFAULT_PRESETS: PerspectivePreset[] = [
  {
    id: 'preset-1ai',
    name: '1 AI · Nghiên cứu độc lập',
    description: 'Bắt đầu với 1 AI nghiên cứu chính; khi cần thêm góc nhìn mới bấm + Thêm AI.',
    perspectives: [
      {
        handle: 'Nghiên_cứu',
        name: 'Chuyên gia Nghiên cứu (Đọc nguồn & Phân tích)',
        rolePrompt:
          'Bạn là chuyên gia nghiên cứu học thuật. Đọc kỹ nguồn tài liệu, phân tích sâu, cấu trúc rõ ràng, trích dẫn [S#] khi có dữ liệu và mở đầu bằng dòng "Kết luận: ...".',
        tags: ['Nghiên_cứu'],
        modelLabel: 'gemini-neon',
        providerId: 'bridge-local',
        colorIndex: 0,
        enabled: true,
      },
    ],
  },
  {
    id: 'preset-2ai',
    name: '2 AI · Đề xuất & Phản biện',
    description: '1 AI đề xuất giải pháp kỹ thuật + 1 AI phản biện chỉ ra điểm mù và rủi ro.',
    perspectives: [
      {
        handle: 'Nghiên_cứu',
        name: 'Nghiên cứu & Đề xuất giải pháp',
        rolePrompt:
          'Bạn phụ trách nghiên cứu và đề xuất phương án khả thi nhất về kỹ thuật, hiệu năng và bảo trì. Mở đầu bằng "Kết luận: ...".',
        tags: ['Nghiên_cứu'],
        modelLabel: 'gemini-carbon',
        providerId: 'bridge-local',
        colorIndex: 0,
        enabled: true,
      },
      {
        handle: 'Phản_biện',
        name: 'Phản biện & Soi rủi ro',
        rolePrompt:
          'Bạn là người phản biện độc lập. Chỉ ra điểm mù, rủi ro vận hành, chi phí ẩn và giả định yếu của giải pháp. Mở đầu bằng "Kết luận: ...".',
        tags: ['Phản_biện'],
        modelLabel: 'gemini-neon',
        providerId: 'bridge-local',
        colorIndex: 2,
        enabled: true,
      },
    ],
  },
];
