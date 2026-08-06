export type UserRole =
  | "purchasing"
  | "purchasing_manager"
  | "legal"
  | "legal_lead"
  | "it";

export type UserDepartment = "Purchasing" | "IT" | "Legal";

/** Quyền theo hạng mục — catalog & UI tick ở `lib/permissions.ts`. */
export type PermissionKey =
  | "task"
  | "contracts"
  | "contracts_create"
  | "contract_config"
  | "form_lists"
  | "system_prompts"
  | "users";

export type ContractGroup = "framework" | "vendor";

export type ReviewStatus =
  | "draft"
  | "queued"
  | "processing"
  | "reviewed"
  | "awaiting_markers"
  | "pending_manager"
  | "pending_legal"
  | "rejected"
  | "approved"
  | "syncing_econtract"
  | "signed";

export type ProposalKind = "A" | "B";

export type MarkerType = "ds" | "is" | "st";

/**
 * Hình thức ký theo FPT.eContract (tài liệu "Hướng dẫn cấu trúc đánh dấu marker"):
 * - review: người xem xét — KHÔNG có marker
 * - sign_img: ký điện tử (ký ảnh) → marker `is`
 * - sign_fca.passcode: chữ ký số dài hạn pháp nhân (passcode) → marker `ds`
 * - sign_ekyc: ký chữ ký số cấp 1 lần xác thực eKYC/OTP → marker `ds`
 */
export type EcontractSignType =
  | "review"
  | "sign_img"
  | "sign_fca.passcode"
  | "sign_ekyc";

/** Tài khoản hệ thống (IT quản trị). */
export interface AppUser {
  id: string;
  username: string;
  /** Họ tên hiển thị (Task, người yêu cầu, header…). */
  fullName: string;
  /** Mật khẩu mock — bản thật sẽ hash phía backend. */
  password: string;
  email: string;
  phone: string;
  department: UserDepartment;
  role: UserRole;
  /** Line Manager — user id (tuỳ chọn). */
  lineManagerId?: string;
  /**
   * Quyền theo hạng mục (IT tick trên Users).
   * Thiếu / rỗng → suy ra từ Role mặc định.
   */
  permissions: PermissionKey[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserSession {
  token: string;
  userId: string;
  username: string;
  name: string;
  email: string;
  role: UserRole;
  department: UserDepartment;
  permissions: PermissionKey[];
}

export interface DocumentCategory {
  id: string;
  label: string;
  code: string;
}

export interface ContractTypeConfig {
  id: string;
  label: string;
  group: ContractGroup;
  requireTemplateMatch: boolean;
  hasChecklist: boolean;
  status: "draft" | "published" | "archived";
}

export type DiscountFlag = "yes" | "no";

/** Metadata nhập ở bước "Tạo tài liệu" (mockup Econtract / intake). */
export interface DocumentIntakeMeta {
  /** Loại hợp đồng / Contract category (HQP / RAW / MRO / CAP / LOG). */
  documentCategoryId: string;
  documentCategoryLabel: string;
  documentName: string;
  documentNumber: string;
  signingDate: string;
  /** Tên hợp đồng (Contract name) — chọn từ list cấu hình */
  contractNameId?: string;
  contractNameLabel?: string;
  businessEntityId?: string;
  businessEntityLabel?: string;
  contractBaseId?: string;
  contractBaseLabel?: string;
  hasDiscount: DiscountFlag | "";
  discountDetails: string;
  contractValue: string;
}

export interface EditableField {
  id: string;
  label: string;
  type: "text" | "number" | "date" | "select";
  value: string;
  options?: string[];
  locked: boolean;
}

export interface AiProposal {
  id: string;
  kind: ProposalKind;
  fieldId?: string;
  title: string;
  reason: string;
  originalText: string;
  proposedText: string;
  status: "pending" | "accepted" | "undone" | "annotation";
  confidence: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface SignRecipient {
  /** recipientId theo chuẩn eContract, ví dụ `p_001_r_001` */
  id: string;
  /** personalName trên eContract */
  name: string;
  role: "company" | "counterparty" | "witness";
  /** Mã bên tham gia luồng ký (party), ví dụ `p_001` */
  partyId?: string;
  /** Tên tổ chức của bên — eContract bắt buộc (lỗi isNotExistsIndividual) */
  orgName?: string;
  /** Bên thuộc tổ chức mình (Công ty) hay đối tác */
  isMyOrg?: boolean;
  /** Thứ tự ký trong luồng */
  order?: number;
  /** Email nhận thông báo ký — eContract bắt buộc với recipient */
  email?: string;
  phone?: string;
  /** Vai trò trên eContract: signer có marker, reviewer không marker */
  ecRole?: "signer" | "reviewer";
  /** Hình thức ký — quyết định loại marker (is/ds) */
  signType?: EcontractSignType;
  /**
   * Với marker `st` (text cần điền): trỏ tới recipientId thật trong luồng ký
   * (marker st không phải một người ký riêng).
   */
  refRecipientId?: string;
  markerType: MarkerType;
  marker?: {
    /** id duy nhất trong toàn file, ví dụ `ds_p_001_r_001` */
    id: string;
    type: MarkerType;
    /** h: chiều cao ô ký (chiều rộng = khoảng cách #...#) */
    height: number;
    positionLabel: string;
  };
}

export interface StructuredFeedbackItem {
  id: string;
  fieldId?: string;
  clauseLabel: string;
  comment: string;
  done: boolean;
  /** File Legal đính kèm khi reject (mock — chỉ lưu tên). */
  attachments?: { name: string; size: number }[];
}

export interface ConfidenceDetail {
  score: number;
  pros: string[];
  cons: string[];
  clauseSummaries: { title: string; summary: string }[];
  recentFieldChanges: {
    fieldId: string;
    label: string;
    oldValue: string;
    newValue: string;
  }[];
  approvalMatrixWarning?: string;
}

/** Severity cho finding checklist (ContractGuard-style). */
export type InsightSeverity = "block" | "high" | "low";

export interface ChecklistFinding {
  id: string;
  title: string;
  description: string;
  severity?: InsightSeverity;
  /** Loại A (Content Control mở) nếu set; null = Loại B vùng khoá */
  relatedFieldId?: string | null;
}

/** Phân tích AI theo 4 nhóm + 2 điểm số tách biệt. */
export interface ContractInsight {
  contractId: string;
  contractName: string;
  aiConfidenceScore: number;
  fairnessScore: number;
  aiSummary: string;
  lastUpdatedAt: string;
  groups: {
    redFlags: ChecklistFinding[];
    warnings: ChecklistFinding[];
    protections: ChecklistFinding[];
    missingProtections: ChecklistFinding[];
  };
}

/** Hành động tạo ra một version file mới trong vòng đời review. */
export type ContractVersionAction =
  | "submit_legal"
  | "legal_reject"
  | "resubmit"
  | "reupload";

/** Snapshot 1 version file — lưu lại mỗi lần submit / Legal sửa / Purchasing sửa lại. */
export interface ContractVersionEntry {
  version: number;
  action: ContractVersionAction;
  actorRole: "purchasing" | "legal";
  actorName: string;
  /** Mô tả ngắn hiển thị trong dropdown chọn version */
  label: string;
  createdAt: string;
  fileName: string;
  reviewedDocxUrl?: string;
  /** Snapshot nội dung tại thời điểm tạo version — dùng để xem lại */
  reviewedText: string;
  /** Feedback Legal đính kèm khi tạo version (nếu là legal_reject) */
  feedback?: StructuredFeedbackItem[];
}

/** Một file đính kèm trong review (tab Word). */
export interface ReviewAttachment {
  id: string;
  fileName: string;
  /** URL .docx gốc */
  originalDocxUrl?: string;
  /** URL .docx AI-reviewed (nếu có) */
  reviewedDocxUrl?: string;
  /** Nội dung text fallback khi không có docx */
  originalText?: string;
  reviewedText?: string;
}

export interface ContractReview {
  id: string;
  /** Số thứ tự hiển thị (000001, 000002, …) */
  documentId: string;
  code: string;
  title: string;
  contractTypeId: string;
  contractTypeLabel: string;
  group: ContractGroup;
  status: ReviewStatus;
  ownerName: string;
  /** User id chủ sở hữu — dùng lọc scope Purchasing / Line Manager. */
  ownerId?: string;
  fileName: string;
  /** Nhiều file đính kèm khi tạo (file chính = fileName) */
  fileNames?: string[];
  /** Chi tiết từng file — dùng cho tab Word (1 tab / file) */
  attachments?: ReviewAttachment[];
  /** URL public tới .docx gốc để nhúng preview (docx-preview) */
  originalDocxUrl?: string;
  /** URL public tới .docx AI-reviewed (nếu có) */
  reviewedDocxUrl?: string;
  prompt: string;
  version: number;
  /** Lịch sử toàn bộ version file: v1 = submit Legal, v2 = Legal sửa, v3 = Purchasing sửa lại… */
  versionHistory?: ContractVersionEntry[];
  confidence: number;
  createdAt: string;
  updatedAt: string;
  queuePosition?: number;
  originalText: string;
  reviewedText: string;
  fields: EditableField[];
  proposals: AiProposal[];
  messages: ChatMessage[];
  recipients: SignRecipient[];
  feedback: StructuredFeedbackItem[];
  /** @deprecated dùng contractInsight — giữ tương thích mock cũ */
  confidenceDetail: ConfidenceDetail;
  /** Phân tích 4 nhóm + AI confidence / Fairness tách biệt */
  contractInsight: ContractInsight;
  disclaimerAcknowledged: boolean;
  /** Thông tin tài liệu từ form tạo mới */
  intake?: DocumentIntakeMeta;
}
