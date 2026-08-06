import type {
  ContractReview,
  ContractTypeConfig,
  ContractVersionEntry,
  DocumentCategory,
  ReviewAttachment,
  UserSession,
} from "@/lib/types";
import {
  buildDefaultContractInsight,
  emptyContractInsight,
} from "@/lib/contract-insight";
import { syncDocSeqFromReviews } from "@/lib/document-number";
import { defaultPermissionsForRole } from "@/lib/permissions";

const SAMPLE_DOCX = "/samples/Template_HDDV_chung_2026.docx";

/** LOG HDVT template chính dùng cho seed / resolve template. */
export const SAMPLE_HDVT_FILES = [
  "1. Template_HDVT-OceanFreight_2026.docx",
] as const;

export function sampleUrl(fileName: string): string {
  return `/samples/${encodeURIComponent(fileName)}`;
}

/** Legal canonical template URL for a contract type (Mục 6 — mock mapping). */
export function resolveTemplateUrlForContractType(contractTypeId: string): string {
  if (
    contractTypeId.startsWith("framework") ||
    contractTypeId.includes("purchase") ||
    contractTypeId.includes("hdvt")
  ) {
    return sampleUrl(SAMPLE_HDVT_FILES[0]);
  }
  if (contractTypeId.startsWith("vendor")) {
    return SAMPLE_DOCX;
  }
  return SAMPLE_DOCX;
}

/** Chuẩn hoá danh sách file → attachments (1 tab / file). */
export function buildAttachments(input: {
  fileName?: string;
  fileNames?: string[];
  attachments?: ReviewAttachment[];
  originalDocxUrl?: string;
  reviewedDocxUrl?: string;
  originalText?: string;
  reviewedText?: string;
}): ReviewAttachment[] {
  if (input.attachments?.length) {
    return input.attachments.map((a, i) => ({
      ...a,
      id: a.id || `att_${i}`,
      originalDocxUrl:
        a.originalDocxUrl ||
        input.originalDocxUrl ||
        (a.fileName ? sampleUrl(a.fileName) : SAMPLE_DOCX),
      reviewedDocxUrl:
        a.reviewedDocxUrl ||
        a.originalDocxUrl ||
        input.reviewedDocxUrl ||
        input.originalDocxUrl ||
        (a.fileName ? sampleUrl(a.fileName) : SAMPLE_DOCX),
    }));
  }
  const names =
    input.fileNames?.length
      ? input.fileNames
      : input.fileName
        ? [input.fileName]
        : ["document.docx"];
  return names.map((name, i) => {
    const url =
      i === 0
        ? input.originalDocxUrl || sampleUrl(name)
        : sampleUrl(name);
    const reviewed =
      i === 0
        ? input.reviewedDocxUrl || input.originalDocxUrl || sampleUrl(name)
        : sampleUrl(name);
    return {
      id: `att_${i}_${name}`,
      fileName: name,
      originalDocxUrl: url,
      reviewedDocxUrl: reviewed,
      originalText: i === 0 ? input.originalText : undefined,
      reviewedText: i === 0 ? input.reviewedText : undefined,
    };
  });
}

/** Loại hợp đồng (Contract category) — HQP / RAW / MRO / CAP / LOG. */
export const DOCUMENT_CATEGORIES: DocumentCategory[] = [
  { id: "hqp", label: "HQP", code: "HQP" },
  { id: "raw", label: "RAW", code: "RAW" },
  { id: "mro", label: "MRO", code: "MRO" },
  { id: "cap", label: "CAPEX (CAP)", code: "CAP" },
  { id: "log", label: "LOG", code: "LOG" },
];

export const CONTRACT_TYPES: ContractTypeConfig[] = [
  {
    id: "framework_goods",
    label: "Hợp đồng khung mua hàng",
    group: "framework",
    requireTemplateMatch: true,
    hasChecklist: true,
    status: "published",
  },
  {
    id: "framework_service",
    label: "Hợp đồng khung dịch vụ",
    group: "framework",
    requireTemplateMatch: true,
    hasChecklist: true,
    status: "published",
  },
  {
    id: "vendor_po",
    label: "Hợp đồng NCC / PO",
    group: "vendor",
    requireTemplateMatch: false,
    hasChecklist: true,
    status: "published",
  },
  {
    id: "vendor_other",
    label: "Hợp đồng NCC khác (chưa có checklist chi tiết)",
    group: "vendor",
    requireTemplateMatch: false,
    hasChecklist: false,
    status: "published",
  },
];

const SAMPLE_ORIGINAL = `ĐIỀU 1. ĐỐI TƯỢNG HỢP ĐỒNG
Bên B cung cấp dịch vụ theo phạm vi nêu tại Phụ lục 01 đính kèm Hợp đồng này.

ĐIỀU 2. GIÁ TRỊ HỢP ĐỒNG VÀ PHÍ DỊCH VỤ
Tổng giá trị hợp đồng: 2.500.000.000 VND (chưa bao gồm VAT).

ĐIỀU 3. THANH TOÁN
Bên A thanh toán 100% trong vòng 90 ngày kể từ ngày nhận hóa đơn hợp lệ.

ĐIỀU 4. BẢO MẬT
Hai bên cam kết bảo mật thông tin trong thời hạn 2 năm.

ĐIỀU 5. CHẤM DỨT HỢP ĐỒNG
Mỗi bên được đơn phương chấm dứt với thông báo trước 15 ngày.`;

const SAMPLE_REVIEWED = `ĐIỀU 1. ĐỐI TƯỢNG HỢP ĐỒNG
Bên B cung cấp dịch vụ theo phạm vi nêu tại Phụ lục 01 đính kèm Hợp đồng này và tiêu chuẩn kỹ thuật của Bên A.

ĐIỀU 2. GIÁ TRỊ HỢP ĐỒNG VÀ PHÍ DỊCH VỤ
Tổng giá trị hợp đồng: 2.500.000.000 VND (chưa bao gồm VAT).

ĐIỀU 3. THANH TOÁN
Bên A thanh toán trong vòng 60 ngày kể từ ngày nhận hóa đơn hợp lệ và biên bản nghiệm thu.

ĐIỀU 4. BẢO MẬT
Hai bên cam kết bảo mật thông tin trong thời hạn 5 năm sau khi chấm dứt hợp đồng.

ĐIỀU 5. CHẤM DỨT HỢP ĐỒNG
Mỗi bên được đơn phương chấm dứt với thông báo trước 30 ngày bằng văn bản.`;

export function formatDocumentId(n: number): string {
  return String(Math.max(1, Math.floor(n))).padStart(6, "0");
}

export function parseDocumentId(id?: string | null): number {
  if (!id) return 0;
  const n = parseInt(id, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function nextDocumentId(reviews: ContractReview[]): string {
  const max = reviews.reduce(
    (m, r) => Math.max(m, parseDocumentId(r.documentId)),
    0
  );
  return formatDocumentId(max + 1);
}

/** Gán ID tuần tự 000001… cho bản ghi thiếu documentId (theo createdAt). */
export function ensureDocumentIds(reviews: ContractReview[]): ContractReview[] {
  let max = reviews.reduce(
    (m, r) => Math.max(m, parseDocumentId(r.documentId)),
    0
  );
  const missing = reviews
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => !parseDocumentId(r.documentId))
    .sort(
      (a, b) =>
        new Date(a.r.createdAt).getTime() - new Date(b.r.createdAt).getTime()
    );
  if (!missing.length) return reviews;
  const assigned = new Map<number, string>();
  for (const { index } of missing) {
    max += 1;
    assigned.set(index, formatDocumentId(max));
  }
  return reviews.map((r, i) =>
    assigned.has(i) ? { ...r, documentId: assigned.get(i)! } : r
  );
}

export function createMockReview(partial?: Partial<ContractReview>): ContractReview {
  const now = new Date().toISOString();
  const id = partial?.id || `rev_${Date.now()}`;
  const fileName = partial?.fileName || "HD_Khung_VatTu_Q3.docx";
  const fileNames = partial?.fileNames?.length ? partial.fileNames : [fileName];
  const originalText = partial?.originalText || SAMPLE_ORIGINAL;
  const reviewedText =
    partial?.reviewedText !== undefined ? partial.reviewedText : SAMPLE_REVIEWED;
  const attachments = buildAttachments({
    fileName,
    fileNames,
    attachments: partial?.attachments,
    originalDocxUrl: partial?.originalDocxUrl,
    reviewedDocxUrl: partial?.reviewedDocxUrl,
    originalText,
    reviewedText: reviewedText || originalText,
  });
  return {
    id,
    documentId: partial?.documentId || "",
    code:
      partial?.code !== undefined
        ? partial.code
        : `PR-2026-${String(Math.floor(Math.random() * 900) + 100)}`,
    title: partial?.title || "Hợp đồng mua vật tư Q3",
    contractTypeId: partial?.contractTypeId || "framework_goods",
    contractTypeLabel: partial?.contractTypeLabel || "Hợp đồng khung mua hàng",
    group: partial?.group || "framework",
    status: partial?.status || "reviewed",
    ownerName: partial?.ownerName || "van.a (Purchasing)",
    ownerId: partial?.ownerId ?? "usr_purchasing_a",
    originalDocxUrl: partial?.originalDocxUrl || attachments[0]?.originalDocxUrl,
    reviewedDocxUrl: partial?.reviewedDocxUrl || attachments[0]?.reviewedDocxUrl,
    prompt: partial?.prompt || "Ưu tiên bảo vệ bên mua, kiểm tra thanh toán và chấm dứt.",
    version: partial?.version || 1,
    versionHistory: partial?.versionHistory || [],
    confidence: partial?.confidence ?? 72,
    createdAt: partial?.createdAt || now,
    updatedAt: partial?.updatedAt || now,
    queuePosition: partial?.queuePosition,
    originalText,
    reviewedText,
    fields: partial?.fields || [
      {
        id: "contract_value",
        label: "Giá trị hợp đồng (VND)",
        type: "number",
        value: "2500000000",
        locked: false,
      },
      {
        id: "payment_days",
        label: "Thời hạn thanh toán (ngày)",
        type: "number",
        value: "60",
        locked: false,
      },
      {
        id: "effective_date",
        label: "Ngày hiệu lực",
        type: "date",
        value: "2026-08-01",
        locked: false,
      },
      {
        id: "governing_law",
        label: "Luật áp dụng",
        type: "select",
        value: "Việt Nam",
        options: ["Việt Nam", "Singapore", "Khác"],
        locked: false,
      },
    ],
    proposals: partial?.proposals || [
      {
        id: "p1",
        kind: "A",
        fieldId: "payment_days",
        title: "Rút ngắn thời hạn thanh toán",
        reason: "Checklist bắt buộc: thanh toán ≤ 60 ngày đối với HĐ khung mua hàng.",
        originalText: "90 ngày",
        proposedText: "60 ngày",
        status: "pending",
        confidence: 0.91,
      },
      {
        id: "p2",
        kind: "A",
        fieldId: undefined,
        title: "Bổ sung biên bản nghiệm thu",
        reason: "Thiếu điều kiện nghiệm thu trước thanh toán — rủi ro cho bên mua.",
        originalText: "nhận hóa đơn hợp lệ",
        proposedText: "nhận hóa đơn hợp lệ và biên bản nghiệm thu",
        status: "pending",
        confidence: 0.86,
      },
      {
        id: "p3",
        kind: "B",
        title: "Điều khoản bảo mật (vùng khoá)",
        reason: "Template khoá điều này. Đề xuất kéo dài lên 5 năm — cần Legal xem xét template.",
        originalText: "2 năm",
        proposedText: "5 năm sau khi chấm dứt hợp đồng",
        status: "annotation",
        confidence: 0.78,
      },
    ],
    messages: partial?.messages || [
      {
        id: "m1",
        role: "assistant",
        content:
          "Đã hoàn tất review theo checklist HĐ khung mua hàng. Có 2 đề xuất Loại A (có thể accept) và 1 cảnh báo Loại B trên vùng khoá.",
        createdAt: now,
      },
    ],
    recipients: partial?.recipients || [
      {
        id: "p_001_r_001",
        name: "Đại diện Công ty (SGVN)",
        role: "company",
        partyId: "p_001",
        orgName: "Công ty SGVN",
        isMyOrg: true,
        order: 2,
        email: "daidien@sgvn.example.com",
        phone: "0900000001",
        ecRole: "signer",
        signType: "sign_fca.passcode",
        markerType: "ds",
      },
      {
        id: "p_002_r_001",
        name: "Đại diện NCC",
        role: "counterparty",
        partyId: "p_002",
        orgName: "Công ty NCC",
        isMyOrg: false,
        order: 1,
        email: "daidien@ncc.example.com",
        phone: "0900000002",
        ecRole: "signer",
        signType: "sign_ekyc",
        markerType: "ds",
      },
      {
        id: "st_ho_ten_ncc",
        name: "Họ tên người ký NCC (text điền)",
        role: "counterparty",
        partyId: "p_002",
        orgName: "Công ty NCC",
        refRecipientId: "p_002_r_001",
        markerType: "st",
      },
    ],
    feedback: partial?.feedback || [],
    confidenceDetail: partial?.confidenceDetail || {
      score: partial?.confidence ?? 72,
      pros: [
        "Đã có điều khoản bảo mật và chấm dứt bằng văn bản",
        "Giá trị hợp đồng nằm trong hạn mức Director theo Approval Matrix",
      ],
      cons: [
        "Thời hạn thanh toán gốc (90 ngày) vượt checklist chuẩn",
        "Điều khoản bảo mật trên vùng khoá chưa khớp khuyến nghị 5 năm",
      ],
      clauseSummaries: [
        {
          title: "Điều 2 — Giá trị",
          summary: "2,5 tỷ VND chưa VAT; thuộc cấp Director theo ma trận phê duyệt.",
        },
        {
          title: "Điều 3 — Thanh toán",
          summary: "AI đề xuất 60 ngày + nghiệm thu để giảm rủi ro thanh toán sớm.",
        },
        {
          title: "Điều 5 — Chấm dứt",
          summary: "Thông báo trước 30 ngày bằng văn bản, phù hợp playbook bên mua.",
        },
      ],
      recentFieldChanges: [],
      approvalMatrixWarning: undefined,
    },
    contractInsight:
      partial?.contractInsight ||
      (partial?.status === "draft" || (partial?.confidence ?? 72) === 0
        ? emptyContractInsight(
            id,
            partial?.title || "Hợp đồng mua vật tư Q3"
          )
        : buildDefaultContractInsight({
            contractId: id,
            contractName: partial?.title || "Hợp đồng mua vật tư Q3",
            aiConfidenceScore: partial?.confidence ?? 72,
            lastUpdatedAt: partial?.updatedAt || now,
          })),
    disclaimerAcknowledged: partial?.disclaimerAcknowledged ?? false,
    ...partial,
    // Giữ đồng bộ attachments sau khi merge partial
    fileName: partial?.fileName || fileName,
    fileNames: partial?.fileNames?.length ? partial.fileNames : fileNames,
    attachments: buildAttachments({
      ...partial,
      fileName: partial?.fileName || fileName,
      fileNames: partial?.fileNames?.length ? partial.fileNames : fileNames,
      originalText: partial?.originalText ?? originalText,
      reviewedText:
        partial?.reviewedText !== undefined
          ? partial.reviewedText
          : reviewedText,
    }),
  };
}

export const MOCK_USERS = {
  purchasing: {
    token: "mock-purchasing-token",
    userId: "usr_purchasing_a",
    username: "van.a",
    name: "van.a",
    email: "purchasing@saint-gobain.com",
    role: "purchasing",
    department: "Purchasing",
    permissions: defaultPermissionsForRole("purchasing"),
  },
  purchasing_manager: {
    token: "mock-pm-token",
    userId: "usr_manager_pur",
    username: "manager.pur",
    name: "manager.pur",
    email: "manager.pur@saint-gobain.com",
    role: "purchasing_manager",
    department: "Purchasing",
    permissions: defaultPermissionsForRole("purchasing_manager"),
  },
  legal: {
    token: "mock-legal-token",
    userId: "usr_legal",
    username: "legal",
    name: "legal",
    email: "legal@saint-gobain.com",
    role: "legal",
    department: "Legal",
    permissions: defaultPermissionsForRole("legal"),
  },
  legal_lead: {
    token: "mock-legal-lead-token",
    userId: "usr_legal_lead",
    username: "legal.lead",
    name: "legal.lead",
    email: "legal.lead@saint-gobain.com",
    role: "legal_lead",
    department: "Legal",
    permissions: defaultPermissionsForRole("legal_lead"),
  },
  it: {
    token: "mock-it-token",
    userId: "usr_admin",
    username: "admin",
    name: "admin",
    email: "admin@saint-gobain.com",
    role: "it",
    department: "IT",
    permissions: defaultPermissionsForRole("it"),
  },
} satisfies Record<string, UserSession>;

const seedReviews: ContractReview[] = [
  createMockReview({
    id: "rev_demo_1",
    code: "SGVN.RAW.260001",
    title: "HĐ khung vật tư Q3 — Demo",
    status: "reviewed",
    fileName: "HD_Khung_VatTu_Q3.docx",
    fileNames: ["HD_Khung_VatTu_Q3.docx"],
    originalDocxUrl: SAMPLE_DOCX,
    reviewedDocxUrl: SAMPLE_DOCX,
    intake: {
      documentCategoryId: "raw",
      documentCategoryLabel: "RAW",
      documentName: "HĐ khung vật tư Q3 — Demo",
      documentNumber: "SGVN.RAW.260001",
      signingDate: "2026-08-01",
      contractNameId: "cn_raw_raw_nvl",
      contractNameLabel: "Nguyên vật liệu",
      businessEntityId: "be_sgvn",
      businessEntityLabel: "Saint-Gobain Vietnam",
      contractBaseId: "cb_framework",
      contractBaseLabel: "Framework agreement",
      hasDiscount: "no",
      discountDetails: "",
      contractValue: "2.500.000.000",
    },
  }),
  createMockReview({
    id: "rev_demo_2",
    code: "VTS.LOG.260001",
    title: "HĐ NCC thiết bị IT / Template HDDV chung 2026",
    contractTypeId: "vendor_po",
    contractTypeLabel: "Hợp đồng NCC / PO",
    group: "vendor",
    status: "pending_legal",
    confidence: 81,
    fileName: "Template_HDDV_chung_2026.docx",
    fileNames: ["Template_HDDV_chung_2026.docx"],
    originalDocxUrl: "/samples/Template_HDDV_chung_2026.docx",
    reviewedDocxUrl: "/samples/Template_HDDV_chung_2026.docx",
    createdAt: "2026-07-15T09:00:00.000Z",
    updatedAt: "2026-08-01T10:15:00.000Z",
    version: 3,
    versionHistory: [
      {
        version: 1,
        action: "submit_legal",
        actorRole: "purchasing",
        actorName: "Nguyễn Văn A (Purchasing)",
        label: "Purchasing submit Legal duyệt",
        createdAt: "2026-07-15T09:00:00.000Z",
        fileName: "Template_HDDV_chung_2026.docx",
        reviewedText:
          SAMPLE_ORIGINAL +
          "\n\n[v1 — Bản Purchasing submit Legal duyệt lần đầu: thời hạn thanh toán 90 ngày, chưa có điều khoản phạt chậm giao.]",
      },
      {
        version: 2,
        action: "legal_reject",
        actorRole: "legal",
        actorName: "Trần Thị Legal",
        label: "Legal sửa & trả về Purchasing",
        createdAt: "2026-07-20T14:30:00.000Z",
        fileName: "Template_HDDV_chung_2026.docx",
        reviewedText:
          SAMPLE_REVIEWED +
          "\n\n[v2 — Legal đã sửa: rút thanh toán về 60 ngày, thêm điều khoản phạt chậm giao 0,1%/ngày; trả về Purchasing bổ sung phụ lục giá.]",
        feedback: [
          {
            id: "fb_demo2_1",
            clauseLabel: "Điều 3 — Thanh toán",
            comment:
              "Rút thời hạn thanh toán từ 90 ngày về 60 ngày theo policy mua hàng.",
            done: true,
          },
          {
            id: "fb_demo2_2",
            clauseLabel: "Phụ lục giá",
            comment: "Bổ sung phụ lục đơn giá chi tiết trước khi resubmit.",
            done: true,
          },
        ],
      },
      {
        version: 3,
        action: "resubmit",
        actorRole: "purchasing",
        actorName: "Nguyễn Văn A (Purchasing)",
        label: "Purchasing sửa lại & resubmit",
        createdAt: "2026-08-01T10:15:00.000Z",
        fileName: "Template_HDDV_chung_2026.docx",
        reviewedDocxUrl: "/samples/Template_HDDV_chung_2026.docx",
        reviewedText:
          SAMPLE_REVIEWED +
          "\n\n[v3 — Purchasing đã bổ sung phụ lục giá và xác nhận thanh toán 60 ngày; resubmit chờ Legal duyệt.]",
      },
    ],
    intake: {
      documentCategoryId: "log",
      documentCategoryLabel: "LOG",
      documentName: "HĐ NCC thiết bị IT / Template HDDV chung 2026",
      documentNumber: "VTS.LOG.260001",
      signingDate: "2026-07-15",
      contractNameId: "cn_log_log_trans",
      contractNameLabel: "Vận chuyển",
      businessEntityId: "be_vts",
      businessEntityLabel: "Vinh Tuong Saint-Gobain",
      contractBaseId: "cb_po",
      contractBaseLabel: "Purchase order",
      hasDiscount: "yes",
      discountDetails: "5% sớm hạn thanh toán",
      contractValue: "850.000.000",
    },
  }),
  createMockReview({
    id: "rev_demo_3",
    code: "SGVN.HQP.260001",
    title: "HĐ khung dịch vụ bảo trì",
    contractTypeId: "framework_service",
    contractTypeLabel: "Hợp đồng khung dịch vụ",
    status: "rejected",
    confidence: 64,
    fileNames: ["HD_Khung_DichVu_BaoTri.docx"],
    intake: {
      documentCategoryId: "hqp",
      documentCategoryLabel: "HQP",
      documentName: "HĐ khung dịch vụ bảo trì",
      documentNumber: "SGVN.HQP.260001",
      signingDate: "2026-06-20",
      contractNameId: "cn_hqp_hqp_sw",
      contractNameLabel: "Phần Mềm & Hệ thống",
      businessEntityId: "be_sgvn",
      businessEntityLabel: "Saint-Gobain Vietnam",
      contractBaseId: "cb_framework",
      contractBaseLabel: "Framework agreement",
      hasDiscount: "no",
      discountDetails: "",
      contractValue: "1.200.000.000",
    },
    feedback: [
      {
        id: "fb1",
        fieldId: "payment_days",
        clauseLabel: "Điều 3 — Thanh toán",
        comment: "Cần làm rõ điều kiện nghiệm thu trước khi thanh toán đợt cuối.",
        done: false,
      },
      {
        id: "fb2",
        clauseLabel: "Điều 5 — Chấm dứt",
        comment: "Bổ sung quyền chấm dứt khi vi phạm nghiêm trọng không khắc phục trong 15 ngày.",
        done: false,
      },
    ],
  }),
  /** Demo Task — Legal (login: legal / demo123) → Start */
  createMockReview({
    id: "rev_task_legal_1",
    code: "SGVN.RAW.260002",
    title: "HĐ khung vật tư Q4",
    ownerId: "usr_purchasing_a",
    ownerName: "van.a (Purchasing)",
    status: "pending_legal",
    confidence: 78,
    fileName: "HD_Khung_VatTu_Q4.docx",
    fileNames: ["HD_Khung_VatTu_Q4.docx"],
    originalDocxUrl: SAMPLE_DOCX,
    reviewedDocxUrl: SAMPLE_DOCX,
    intake: {
      documentCategoryId: "raw",
      documentCategoryLabel: "RAW",
      documentName: "HĐ khung vật tư Q4",
      documentNumber: "SGVN.RAW.260002",
      signingDate: "2026-10-01",
      contractNameId: "cn_raw_raw_trading",
      contractNameLabel: "Hàng trading",
      businessEntityId: "be_sgvn",
      businessEntityLabel: "Saint-Gobain Vietnam",
      contractBaseId: "cb_framework",
      contractBaseLabel: "Framework agreement",
      hasDiscount: "no",
      discountDetails: "",
      contractValue: "3.200.000.000",
    },
  }),
  /** Demo Task — Purchasing Manager (login: manager.pur / demo123) → Start */
  createMockReview({
    id: "rev_task_manager_1",
    code: "VTS.LOG.260002",
    title: "HĐ NCC linh kiện điện",
    ownerId: "usr_purchasing_a",
    ownerName: "van.a (Purchasing)",
    contractTypeId: "vendor_po",
    contractTypeLabel: "Hợp đồng NCC / PO",
    group: "vendor",
    status: "pending_manager",
    confidence: 72,
    fileName: "HD_NCC_LinhKien_Dien.docx",
    fileNames: ["HD_NCC_LinhKien_Dien.docx"],
    originalDocxUrl: SAMPLE_DOCX,
    reviewedDocxUrl: SAMPLE_DOCX,
    intake: {
      documentCategoryId: "log",
      documentCategoryLabel: "LOG",
      documentName: "HĐ NCC linh kiện điện",
      documentNumber: "VTS.LOG.260002",
      signingDate: "2026-09-20",
      contractNameId: "cn_log_log_trans",
      contractNameLabel: "Vận chuyển",
      businessEntityId: "be_vts",
      businessEntityLabel: "Vinh Tuong Saint-Gobain",
      contractBaseId: "cb_po",
      contractBaseLabel: "Purchase order",
      hasDiscount: "yes",
      discountDetails: "2% thanh toán trong 45 ngày",
      contractValue: "980.000.000",
    },
  }),
  /** Demo Task — Purchasing bị trả về (login: van.a / demo123) → Start */
  createMockReview({
    id: "rev_task_purchasing_1",
    code: "SGVN.HQP.260002",
    title: "HĐ dịch vụ IT — Legal trả về",
    ownerId: "usr_purchasing_a",
    ownerName: "van.a (Purchasing)",
    contractTypeId: "vendor_po",
    contractTypeLabel: "Hợp đồng NCC / PO",
    group: "vendor",
    status: "rejected",
    confidence: 68,
    fileName: "HD_DichVu_IT_Rev.docx",
    fileNames: ["HD_DichVu_IT_Rev.docx"],
    originalDocxUrl: SAMPLE_DOCX,
    reviewedDocxUrl: SAMPLE_DOCX,
    intake: {
      documentCategoryId: "hqp",
      documentCategoryLabel: "HQP",
      documentName: "HĐ dịch vụ IT — Legal trả về",
      documentNumber: "SGVN.HQP.260002",
      signingDate: "2026-08-15",
      contractNameId: "cn_hqp_hqp_sw",
      contractNameLabel: "Phần Mềm & Hệ thống",
      businessEntityId: "be_sgvn",
      businessEntityLabel: "Saint-Gobain Vietnam",
      contractBaseId: "cb_framework",
      contractBaseLabel: "Framework agreement",
      hasDiscount: "no",
      discountDetails: "",
      contractValue: "450.000.000",
    },
    feedback: [
      {
        id: "fb_task_pur_1",
        clauseLabel: "Điều 3 — Thanh toán",
        comment:
          "Cần rút thời hạn thanh toán về ≤ 60 ngày và bổ sung phụ lục đơn giá trước khi gửi lại.",
        done: false,
      },
    ],
  }),
  createMockReview({
    id: "rev_demo_draft_hddv",
    code: "",
    title: "HĐVT LOG — OceanFreight",
    contractTypeId: "framework_service",
    contractTypeLabel: "Hợp đồng khung dịch vụ",
    group: "framework",
    status: "reviewed",
    confidence: 81,
    fileName: SAMPLE_HDVT_FILES[0],
    fileNames: [SAMPLE_HDVT_FILES[0]],
    originalDocxUrl: sampleUrl(SAMPLE_HDVT_FILES[0]),
    reviewedDocxUrl: sampleUrl(SAMPLE_HDVT_FILES[0]),
    prompt:
      "Ưu tiên bảo vệ bên mua; rà soát thanh toán, nghiệm thu và chấm dứt khi gửi AI.",
    fields: [
      {
        id: "payment_days",
        label: "Thời hạn thanh toán (ngày)",
        type: "number",
        value: "30",
        locked: false,
      },
      {
        id: "termination_notice_days",
        label: "Thông báo chấm dứt (ngày)",
        type: "number",
        value: "30",
        locked: true,
      },
      {
        id: "governing_law",
        label: "Luật áp dụng",
        type: "select",
        value: "Việt Nam",
        options: ["Việt Nam", "Singapore", "Khác"],
        locked: false,
      },
    ],
    proposals: [
      {
        id: "p_hddv_1",
        kind: "A",
        fieldId: "payment_days",
        title: "Rút ngắn thời hạn thanh toán Phí Dịch Vụ",
        reason:
          "Checklist LOG: thanh toán ≤ 30 ngày kể từ ngày xuất hóa đơn để giảm rủi ro công nợ với freight forwarder.",
        originalText: "45 (bốn mươi lăm)",
        proposedText: "30 (ba mươi)",
        status: "pending",
        confidence: 0.92,
      },
      {
        id: "p_hddv_2",
        kind: "A",
        fieldId: undefined,
        title: "Gắn điều kiện thanh toán với D/O & Arrival Notice",
        reason:
          "Thiếu điều kiện giải phóng D/O trước thanh toán — Bên Mua có thể trả phí khi chưa nhận hàng.",
        originalText: "và thực hiện theo nguyên tắc sau",
        proposedText:
          "sau khi Nhà Cung Cấp đã gửi Arrival Notice và giải phóng D/O cho Bên Mua, và thực hiện theo nguyên tắc sau",
        status: "pending",
        confidence: 0.87,
      },
      {
        id: "p_hddv_3",
        kind: "B",
        fieldId: "termination_notice_days",
        title: "Thông báo chấm dứt đơn phương (vùng khóa)",
        reason:
          "Vùng Restrict Editing khóa điều khoản chấm dứt. Đề xuất rút còn 15 ngày — cần Legal mở template hoặc duyệt ngoại lệ.",
        originalText: "thông báo bằng văn bản trước 30 ngày",
        proposedText: "thông báo bằng văn bản trước 15 ngày",
        status: "annotation",
        confidence: 0.74,
      },
      {
        id: "p_hddv_4",
        kind: "A",
        fieldId: undefined,
        title: "Làm rõ tỷ giá Vietcombank trên hóa đơn VAT",
        reason:
          "Công thức tỷ giá đã có nhưng chưa gắn mốc giờ chốt — tránh tranh chấp khi biến động tỷ giá ngày xuất HĐ.",
        originalText:
          "transfer rate of Vietcombank on the date of issuing VAT invoice",
        proposedText:
          "Vietcombank transfer selling rate at 11:00 (Vietnam time) on the date of issuing the VAT invoice",
        status: "pending",
        confidence: 0.8,
      },
    ],
    messages: [
      {
        id: "m_draft_1",
        role: "assistant",
        content:
          "Đã nhận file OceanFreight. Hệ thống quét vùng Restrict Editing (w:permStart) trên template LOG HDVT.",
        createdAt: new Date(Date.now() - 180_000).toISOString(),
      },
      {
        id: "m_draft_2",
        role: "assistant",
        content:
          "Đã hoàn tất AI review OceanFreight theo checklist HĐ khung dịch vụ LOG. Có 3 đề xuất Loại A và 1 cảnh báo Loại B — chi tiết từng đề xuất bên dưới. Accept/Undo ngay trên file preview (dưới dòng xanh).",
        createdAt: new Date(Date.now() - 90_000).toISOString(),
      },
      {
        id: "m_prop_1",
        role: "assistant",
        content:
          "📌 Rút ngắn thời hạn thanh toán Phí Dịch Vụ · Loại A · 92%\nChecklist LOG: thanh toán ≤ 30 ngày kể từ ngày xuất hóa đơn để giảm rủi ro công nợ với freight forwarder.\nĐổi: «45 (bốn mươi lăm)» → «30 (ba mươi)»",
        createdAt: new Date(Date.now() - 80_000).toISOString(),
      },
      {
        id: "m_prop_2",
        role: "assistant",
        content:
          "📌 Gắn điều kiện thanh toán với D/O & Arrival Notice · Loại A · 87%\nThiếu điều kiện giải phóng D/O trước thanh toán — Bên Mua có thể trả phí khi chưa nhận hàng.\nBổ sung điều kiện Arrival Notice / D/O trước khi áp dụng nguyên tắc thanh toán.",
        createdAt: new Date(Date.now() - 70_000).toISOString(),
      },
      {
        id: "m_prop_3",
        role: "assistant",
        content:
          "📌 Thông báo chấm dứt đơn phương (vùng khóa) · Loại B · 74%\nVùng Restrict Editing khóa điều khoản chấm dứt. Đề xuất rút còn 15 ngày — cần Legal mở template hoặc duyệt ngoại lệ.\nĐổi: «trước 30 ngày» → «trước 15 ngày» (chỉ annotation).",
        createdAt: new Date(Date.now() - 60_000).toISOString(),
      },
      {
        id: "m_prop_4",
        role: "assistant",
        content:
          "📌 Làm rõ tỷ giá Vietcombank trên hóa đơn VAT · Loại A · 80%\nCông thức tỷ giá đã có nhưng chưa gắn mốc giờ chốt — tránh tranh chấp khi biến động tỷ giá ngày xuất HĐ.\nChốt selling rate Vietcombank lúc 11:00 (giờ VN) ngày xuất hóa đơn VAT.",
        createdAt: new Date(Date.now() - 50_000).toISOString(),
      },
    ],
    confidenceDetail: {
      score: 81,
      pros: [
        "Có điều khoản P&I / ISM và phân cấp tàu theo Institute Classification Clause",
        "Đã nêu rõ Phí Dịch Vụ và nguyên tắc thanh toán qua chuyển khoản",
        "Bên Mua được quyền đơn phương chấm dứt khi NCC vi phạm",
      ],
      cons: [
        "Thời hạn thanh toán 45 ngày dài hơn chuẩn checklist LOG (≤ 30 ngày)",
        "Chưa gắn thanh toán với Arrival Notice / giải phóng D/O",
        "Điều khoản thông báo chấm dứt 30 ngày nằm trên vùng khóa template",
      ],
      clauseSummaries: [
        {
          title: "Điều 3 — Phí Dịch Vụ và thanh toán",
          summary:
            "AI đề xuất rút 45→30 ngày và bổ sung điều kiện D/O trước khi thanh toán.",
        },
        {
          title: "Điều 5 — Phạt & bồi thường",
          summary:
            "Giữ nguyên khung phạt vi phạm với hãng tàu; không phát sinh đề xuất Loại A.",
        },
        {
          title: "Chấm dứt hợp đồng",
          summary:
            "Thông báo 30 ngày bị khóa Restrict Editing — ghi chú Loại B cho Legal.",
        },
      ],
      recentFieldChanges: [
        {
          fieldId: "payment_days",
          label: "Thời hạn thanh toán (ngày)",
          oldValue: "45",
          newValue: "30",
        },
      ],
    },
    intake: {
      documentCategoryId: "log",
      documentCategoryLabel: "LOG",
      documentName: "HĐVT LOG — OceanFreight",
      documentNumber: "",
      signingDate: "2026-09-15",
      contractNameId: "cn_log_log_warehouse",
      contractNameLabel: "Thuê kho",
      businessEntityId: "be_vts",
      businessEntityLabel: "Vinh Tuong Saint-Gobain",
      contractBaseId: "cb_spot",
      contractBaseLabel: "Spot contract",
      hasDiscount: "yes",
      discountDetails: "3% nếu thanh toán trong 30 ngày",
      contractValue: "1.850.000.000",
    },
  }),
];

const STORAGE_KEY = "ai_econtract_reviews_v26";

const seededReviews: ContractReview[] = seedReviews.map((r, i) =>
  ensureVersionHistory({
    ...r,
    documentId: parseDocumentId(r.documentId)
      ? r.documentId
      : formatDocumentId(i + 1),
  })
);

/**
 * Migration: dựng lại versionHistory từ status khi dữ liệu cũ chưa có.
 * Quy tắc: v1 = Purchasing submit Legal; v2 = Legal sửa/từ chối.
 */
function ensureVersionHistory(r: ContractReview): ContractReview {
  if (r.versionHistory?.length) return r;
  const submittedStatuses = [
    "pending_legal",
    "rejected",
    "syncing_econtract",
    "signed",
  ];
  if (!submittedStatuses.includes(r.status)) {
    return { ...r, versionHistory: [] };
  }
  const entries: ContractVersionEntry[] = [
    {
      version: 1,
      action: "submit_legal",
      actorRole: "purchasing",
      actorName: r.ownerName,
      label: "Purchasing submit Legal duyệt",
      createdAt: r.createdAt,
      fileName: r.fileName,
      reviewedDocxUrl: r.reviewedDocxUrl || r.originalDocxUrl,
      reviewedText: r.reviewedText || r.originalText,
    },
  ];
  if (r.status === "rejected") {
    entries.push({
      version: 2,
      action: "legal_reject",
      actorRole: "legal",
      actorName: "Trần Thị Legal",
      label: "Legal sửa & trả về Purchasing",
      createdAt: r.updatedAt,
      fileName: r.fileName,
      reviewedDocxUrl: r.reviewedDocxUrl || r.originalDocxUrl,
      reviewedText: r.reviewedText || r.originalText,
      feedback: r.feedback,
    });
  }
  return {
    ...r,
    versionHistory: entries,
    version: Math.max(r.version || 1, entries[entries.length - 1].version),
  };
}

function ensureInsight(r: ContractReview): ContractReview {
  const withFiles: ContractReview = ensureVersionHistory({
    ...r,
    fileNames:
      (r.fileNames?.length ?? 0) > 0
        ? r.fileNames!
        : r.fileName
          ? [r.fileName]
          : [],
    attachments: buildAttachments(r),
  });
  if (withFiles.contractInsight) return withFiles;
  const insight =
    withFiles.status === "draft" || !withFiles.confidence
      ? emptyContractInsight(r.id, r.title)
      : buildDefaultContractInsight({
          contractId: r.id,
          contractName: r.title,
          aiConfidenceScore: r.confidence,
          lastUpdatedAt: r.updatedAt,
        });
  return { ...withFiles, contractInsight: insight };
}

export function loadReviews(): ContractReview[] {
  if (typeof window === "undefined") return seededReviews;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seededReviews));
    syncDocSeqFromReviews(seededReviews);
    return seededReviews;
  }
  try {
    const parsed = JSON.parse(raw) as ContractReview[];
    const neededIds = parsed.some((r) => !parseDocumentId(r.documentId));
    const list = ensureDocumentIds(parsed.map(ensureInsight));
    if (neededIds) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }
    syncDocSeqFromReviews(list);
    return list;
  } catch {
    return seededReviews;
  }
}

export function saveReviews(reviews: ContractReview[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews));
}

export function upsertReview(review: ContractReview) {
  const list = loadReviews();
  const idx = list.findIndex((r) => r.id === review.id);
  let withId = review;
  if (!parseDocumentId(review.documentId)) {
    const kept = idx >= 0 ? list[idx].documentId : undefined;
    withId = {
      ...review,
      documentId: parseDocumentId(kept) ? kept! : nextDocumentId(list),
    };
  }
  if (idx >= 0) list[idx] = withId;
  else list.unshift(withId);
  saveReviews(list);
  return withId;
}

export function getReview(id: string) {
  return loadReviews().find((r) => r.id === id);
}
