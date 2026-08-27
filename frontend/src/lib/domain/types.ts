export type UserRole =
  | "purchasing"
  | "purchasing_manager"
  | "legal"
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
  /** Legal đã duyệt — chờ người tạo kéo-thả vị trí chữ ký rồi đẩy eContract. */
  | "pending_markers"
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

/** Kênh gửi thông báo FPT.eContract (`notifyTypes` trong API). */
export type EcontractNotifyType = "email_econtract" | "sms_econtract";

/**
 * Vai trò trên UI wizard (ánh xạ eContract):
 * - coordinator / reviewer / cc: không marker (API role reviewer)
 * - signer / clerk (văn thư): có marker (API role signer)
 */
export type EcontractUiRole =
  | "coordinator"
  | "reviewer"
  | "signer"
  | "clerk"
  | "cc";

/** Kết quả đẩy FPT.eContract (lưu trên ticket). */
export interface EcontractPushResult {
  envelopeId?: string;
  envStatus?: string;
  code?: string | number;
  message?: string;
  urlIndividual?: string;
  fileMode?: "pdf" | "docx";
  pushedAt?: string;
  raw?: unknown;
  error?: string;
}

/**
 * Danh bạ tối thiểu — `GET /api/v1/users/directory`.
 *
 * Tách khỏi `AppUser` vì hai API khác nhau về quyền: `AppUser` là màn quản trị
 * của IT, còn danh bạ này mở cho cả `contract_config` để bảng Phân quyền ký
 * chọn được người ký.
 */
export interface UserDirectoryEntry {
  id: string;
  username: string;
  fullName: string;
  email: string;
  phone: string;
  active: boolean;
}

/** Tài khoản hệ thống (IT quản trị). */
export interface AppUser {
  id: string;
  username: string;
  /** Họ tên hiển thị (Task, người yêu cầu, header…). */
  fullName: string;
  /** Chỉ dùng khi IT tạo/đổi mật khẩu; backend hash trước khi lưu. */
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
  /** Trần tuyệt đối của phiên (ISO). Gia hạn quá mốc này thì phải đăng nhập lại. */
  sessionExpiresAt?: string;
}

export interface DocumentCategory {
  id: string;
  label: string;
  code: string;
  /** archived = ẩn khỏi form tạo HĐ; vẫn giữ để HĐ cũ tham chiếu. */
  status?: "active" | "archived";
}

export interface ContractTypeConfig {
  id: string;
  label: string;
  group: ContractGroup;
  requireTemplateMatch: boolean;
  hasChecklist: boolean;
  /**
   * Backend chỉ phân biệt còn dùng (`active`) hay đã lưu trữ (`archived`) —
   * workflow Draft/Publish đã bỏ khỏi Sprint 1.
   */
  status: "active" | "archived";
}

export type DiscountFlag = "yes" | "no";

/** Metadata nhập ở bước "Tạo tài liệu" (intake). */
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

/**
 * Vị trí ô ký trong tài liệu.
 *
 * NEO LÀ `paraId`, KHÔNG PHẢI TOẠ ĐỘ. Toạ độ trang chỉ tồn tại sau khi phân
 * trang, mà FPT nhận thẳng `.docx` (base64) nên không có bước render nào để
 * dịch ngược. `paraId` là `w14:paraId` của đoạn văn — ổn định qua round-trip
 * Word, và backend định vị được để chèn marker.
 *
 * Người dùng vẫn kéo-thả như cũ; chỉ khác ở chỗ thả xong thì lấy `paraId` của
 * đoạn gần nhất trong `GET /api/v1/reviews/{id}/marker-anchors`.
 */
export interface SignMarker {
  /** id duy nhất trong toàn file, ví dụ `ds_p_001_r_001` */
  id: string;
  type: MarkerType;
  /** h: chiều cao ô ký (chiều rộng = khoảng cách #...#) */
  height: number;
  /** Chiều rộng ô ký (px UI / khoảng trắng giữa #…#) — mặc định 164. */
  width?: number;
  /** Mặc định | Lớn (UI thiết kế). */
  sizePreset?: "default" | "large";
  positionLabel: string;

  /** ★ Neo thật: `w14:paraId` của đoạn văn. Bắt buộc khi gửi lên BE. */
  paraId?: string;
  align?: "left" | "center" | "right";
  position?: "after" | "before";
  /** Số thứ tự đoạn neo — BE trả về để UI cuộn tới đúng chỗ. */
  anchorOrdinal?: number;
  anchorPreview?: string;
  /**
   * BE bật cờ này khi phải SUY RA neo từ `yPct` vì FE không gửi `paraId`.
   * Vị trí lúc đó chỉ là xấp xỉ — UI phải cảnh báo, không được im lặng.
   */
  approximated?: boolean;

  /** Gợi ý hiển thị của UI cũ. KHÔNG quyết định vị trí ghi vào tài liệu. */
  page?: number;
  xPct?: number;
  yPct?: number;
}

/** Một vị trí neo hợp lệ do backend đọc ra từ chính tài liệu. */
export interface MarkerAnchor {
  paraId: string;
  ordinal: number;
  preview: string;
  inTable: boolean;
  isOpen: boolean;
  /** Đoạn trống — thường là chỗ đẹp nhất để đặt ô ký (khoảng trên dòng kẻ). */
  blank: boolean;
  /** Số điều khoản do Word sinh (`Điều 5.`) — không có trong luồng text. */
  clause?: string | null;
  /** Nằm trong khối chữ ký — UI nên ưu tiên làm điểm hít. */
  recommended: boolean;
}

/** Payload của sự kiện SSE `status` trên `/reviews/{id}/events`. */
export interface ReviewStatusEvent {
  id: string;
  status: ReviewStatus;
  version: number;
  queuePosition: number | null;
  confidence: number;
  failureReason: string | null;
  allowedActions: string[];
  updatedAt: string;
}

/** Một lượt trong thread bình luận. Append-only ở backend. */
export interface CommentReply {
  id: string;
  content: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
}

/**
 * Thread bình luận neo vào một đoạn / vùng của tài liệu (TH1).
 *
 * Neo là `permId` (vùng mở) hoặc `paraId` (đoạn bất kỳ, kể cả vùng KHOÁ).
 * Comment vào vùng khoá là hợp lệ và cần thiết: hệ thống không ghi được vào đó,
 * nhưng người duyệt vẫn phải nói được là muốn sửa gì.
 *
 * `orphaned` = tài liệu đã đổi và bình luận mất chỗ dựa. Backend nói ra thay vì
 * gắn sang đoạn "gần giống" — đọc bình luận bên cạnh một câu chưa từng thấy còn
 * tệ hơn.
 */
export interface CommentThread {
  id: string;
  anchorKind: "field" | "paragraph";
  permId: string | null;
  paraId: string | null;
  ordinal: number;
  citation: string;
  quotedText: string;
  status: "open" | "resolved" | "orphaned";
  orphanReason: string | null;
  versionNo: number;
  authorName: string;
  authorRole: string;
  createdAt: string;
  resolvedAt: string | null;
  replies: CommentReply[];
}

/**
 * Đề xuất chỉnh sửa của người duyệt, dạng track changes (TH2).
 *
 * Tách hẳn khỏi `AiProposal`: đề xuất của AI truy vết về một lần chạy model,
 * còn đề xuất ở đây là ý chí của một người có thẩm quyền — phải giữ danh tính.
 * Blueprint yêu cầu hai lớp diff này không được trộn.
 *
 * `target: "locked"` KHÔNG phải lỗi. Đó là kết luận của server rằng đề xuất
 * chạm vào phần Legal khoá: vẫn ghi nhận, vẫn hiện ra, nhưng không áp được và
 * phải escalate cho Legal sửa template.
 */
export interface LegalEdit {
  id: string;
  paraId: string;
  permId: string | null;
  target: "open" | "locked";
  kind: "insert" | "delete" | "replace" | "format";
  /** Số điều khoản do Word sinh ("Điều 4.") — không có trong luồng text. */
  citation: string;
  ordinal: number;
  /** Toàn văn đoạn, trước và sau khi áp đề xuất. */
  originalText: string;
  proposedText: string;
  /** Chỉ mẩu đã đổi — server tự cắt tiền tố/hậu tố chung. */
  removedText: string;
  addedText: string;
  offset: number;
  status: "pending" | "applied" | "rejected" | "orphaned";
  blockedReason: string | null;
  versionNo: number;
  authorName: string;
  authorRole: string;
  createdAt: string;
  decidedAt: string | null;
  decideNote: string | null;
}

/**
 * Tệp đính kèm của một lượt duyệt (TH3) — **nội dung thật**, tải về được.
 *
 * Đừng nhầm với `ContractReview.attachments`: khoá đó là danh sách **tab tài
 * liệu** của khung Word. Trộn hai thứ thì tệp PDF đính kèm sẽ hiện ra thành một
 * tab tài liệu và khung Word cố mở nó như `.docx`.
 */
export interface AttachedFile {
  id: string;
  name: string;
  size: number;
  contentType: string;
  sha256: string;
  uploadedAt: string;
  /** Đi qua endpoint kiểm quyền, không phải link trần. */
  url: string;
}

/** Một vùng mở của template, kèm tên nghiệp vụ Legal đặt. */
export interface TemplateRegion {
  permId: string;
  ordinal: number;
  /** atomic_field | block_region | cross_table | empty */
  regionKind: string;
  paraCount: number;
  label?: string | null;
}

/**
 * Template `.docx` Legal ban hành — bản chuẩn để đối chiếu mọi file upload.
 *
 * Đăng ký lại là sinh **version mới**; bản cũ bị tắt `isActive` nhưng KHÔNG xoá
 * vì review đang chạy vẫn trỏ vào version của nó.
 */
export interface ContractTemplateInfo {
  id: string;
  contractNameId: string;
  version: number;
  fileName: string;
  sha256: string;
  mechanism: string;
  /** Restrict Editing có hiệu lực không — `false` là template không dùng được. */
  protectionEffective: boolean;
  openRegionCount: number;
  lockedFingerprint: string;
  structureFingerprint: string;
  isActive: boolean;
  registeredAt: string;
  fieldLabels: Record<string, string>;
  regions: TemplateRegion[];
  lockedParagraphCount: number;
  downloadUrl: string;
}

/** Một điểm không đạt khi kiểm định template. */
export interface TemplateIssue {
  type: string;
  location: string;
  field_id?: string | null;
  diff_preview?: string | null;
}

/** Kết quả `POST /templates/lint` — soi thử, KHÔNG lưu gì. */
export interface TemplateLintResult {
  fileName: string;
  mechanism: string;
  protectionEffective: boolean;
  openRegionCount: number;
  writableRegionCount: number;
  paragraphCount: number;
  lockedParagraphCount: number;
  countsByKind: Record<string, number>;
  commentCount: number;
  hasTrackedChanges: boolean;
  regions: {
    permId: string;
    ordinal: number;
    regionKind: string;
    writable: boolean;
    paraCount: number;
    charLen: number;
    inTable: boolean;
    preview: string;
  }[];
  issues: TemplateIssue[];
  acceptable: boolean;
}

export interface MarkerIssue {
  /** Mã lỗi của FPT, ví dụ `wrongFieldWithRole`. */
  code: string;
  message: string;
  recipientId?: string;
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
  /**
   * Loại bên đối tác (bắt buộc chọn trên UI):
   * organization = Tổ chức · individual = Cá nhân.
   * Bên mua luôn là organization.
   */
  partyKind?: "organization" | "individual";
  /** Thứ tự ký trong luồng */
  order?: number;
  /** Email nhận thông báo ký — eContract bắt buộc với recipient */
  email?: string;
  phone?: string;
  /**
   * Mã liên hệ eContract (contactId).
   * Ưu tiên: nhập tay → username user hệ thống → local-part email → recipientId.
   */
  contactId?: string;
  /** User hệ thống (nếu sinh từ ma trận Phân quyền ký). */
  userId?: string;
  /**
   * Kênh thông báo eContract — mặc định cả email + SMS.
   * UI: multi-select «Gửi bằng email/SMS FPT.eContract».
   */
  notifyTypes?: EcontractNotifyType[];
  /**
   * Vai trò UI wizard. Tương thích cũ: `"signer" | "reviewer"`.
   * clerk = Văn thư (cần marker); coordinator/cc không marker.
   */
  ecRole?: EcontractUiRole;
  /** Hình thức ký — quyết định loại marker (is/ds) */
  signType?: EcontractSignType;
  /**
   * Với marker `st` (text cần điền): trỏ tới recipientId thật trong luồng ký
   * (marker st không phải một người ký riêng).
   */
  refRecipientId?: string;
  markerType: MarkerType;
  marker?: SignMarker;
  /** Nhãn bậc ma trận ký nếu recipient sinh từ Signing Flow Matrix. */
  signingMatrixBandLabel?: string;
}

export interface StructuredFeedbackItem {
  id: string;
  fieldId?: string;
  clauseLabel: string;
  comment: string;
  done: boolean;
  /** File Legal đính kèm khi reject. */
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
  /** Tệp đính kèm của các lượt duyệt (TH3). KHÔNG phải tab Word — xem `AttachedFile`. */
  attachedFiles?: AttachedFile[];
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
  /** @deprecated dùng contractInsight — giữ để payload cũ không vỡ */
  confidenceDetail: ConfidenceDetail;
  /** Phân tích 4 nhóm + AI confidence / Fairness tách biệt */
  contractInsight: ContractInsight;
  disclaimerAcknowledged: boolean;
  /** Thông tin tài liệu từ form tạo mới */
  intake?: DocumentIntakeMeta;
  /** Kết quả tích hợp FPT.eContract gần nhất */
  econtract?: EcontractPushResult;
  /**
   * Số phiên bản bản ghi — dùng cho optimistic locking.
   *
   * Gửi lại bằng header `If-Match` ở mọi lệnh ghi; backend trả 409 nếu bản ghi
   * đã đổi từ lúc đọc. Thiếu nó thì hai tab cùng mở một ticket sẽ âm thầm ghi
   * đè nhau (CLAUDE.md mục 5.6).
   */
  rowVersion?: number;
}
