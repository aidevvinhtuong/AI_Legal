import { api, ApiError, fetchBinary } from "@/lib/api";
import { assertSigningMatrixReady } from "@/lib/services/config";
import { clearSession, setSession } from "@/lib/auth/session";
import type {
  CodeLabelOption,
  ContractNameOption,
  DiscountOption,
} from "@/lib/domain/form-lists";
import type {
  ContractReview,
  ContractTypeConfig,
  ContractVersionAction,
  ContractVersionEntry,
  DocumentCategory,
  DocumentIntakeMeta,
  EcontractSignType,
  EditableField,
  AttachedFile,
  CommentThread,
  LegalEdit,
  ContractTemplateInfo,
  MarkerAnchor,
  MarkerIssue,
  ReviewStatusEvent,
  SignRecipient,
  StructuredFeedbackItem,
  TemplateLintResult,
  UserSession,
} from "@/lib/domain/types";

import {
  ReuploadValidationError,
  formatIssueMessage,
  type FieldStructureIssue,
  type ReuploadValidationResult,
} from "@/lib/docx/reupload-validation";

/**
 * Tái xuất cho tương thích ngược — nguồn thật là `@/lib/session`.
 *
 * Nơi gọi mới nên import thẳng từ `@/lib/session`; giữ ở đây để việc tách
 * module không kéo theo một lượt sửa 14 file không liên quan.
 */
export { clearSession, getSession, setSession } from "@/lib/auth/session";

export async function loginWithCredentials(
  username: string,
  password: string
): Promise<UserSession> {
  const user = (await api.post(
    "/api/v1/auth/login",
    { username, password },
    { skipAuthRedirect: true }
  )) as UserSession;
  setSession(user);
  return user;
}

export async function changeOwnPassword(
  username: string,
  oldPassword: string,
  newPassword: string
): Promise<void> {
  await api.post("/api/v1/auth/change-password", {
    username,
    oldPassword,
    newPassword,
  });
}

/** Options cho field "Loại giá trị hợp đồng (Contract value type)" — Form lists cùng tên. */
export async function listContractTypes(): Promise<ContractTypeConfig[]> {
  return api.get("/api/v1/contract-types");
}

export async function listDocumentCategories(): Promise<DocumentCategory[]> {
  return api.get("/api/v1/document-categories");
}

export async function listDiscountOptions(): Promise<DiscountOption[]> {
  return api.get("/api/v1/discount-options");
}

export async function listBusinessEntities(): Promise<CodeLabelOption[]> {
  return api.get("/api/v1/business-entities");
}

export async function listContractBases(): Promise<CodeLabelOption[]> {
  return api.get("/api/v1/contract-bases");
}

export async function listContractNames(): Promise<ContractNameOption[]> {
  return api.get("/api/v1/contract-names");
}

export async function listReviews(): Promise<ContractReview[]> {
  return api.get("/api/v1/reviews");
}

export async function getReviewById(id: string): Promise<ContractReview> {
  return api.get(`/api/v1/reviews/${id}`);
}

export async function createReview(input: {
  contractTypeId: string;
  title: string;
  prompt?: string;
  /** Hợp đồng review — đúng 1 file .docx. Bỏ trống khi `fromTemplate`. */
  files: File[];
  /** Hợp đồng tham khảo — nhiều file (tuỳ chọn) */
  referenceFiles?: File[];
  intake: DocumentIntakeMeta;
  /**
   * **Đường chính**: hệ thống sinh tài liệu từ template Legal đã đăng ký, KHÔNG
   * nhận file từ người dùng. Khi đó kiểm kê vùng mở/khoá tin cậy tuyệt đối vì
   * file do chính hệ thống sinh ra (CLAUDE.md 5.1).
   *
   * Đường upload bên dưới là đường phụ và bắt buộc qua ràng buộc cấu trúc.
   */
  fromTemplate?: boolean;
  /**
   * `full` = luồng «Tạo tài liệu» đầy đủ; `quick` = «Review hợp đồng» nhanh.
   *
   * Backend dùng cờ này để chặn ticket quick ở mọi bước sau `reviewed`
   * (Blueprint §1.3.7). Không gửi thì backend mặc định `full` và cổng chặn đó
   * không bao giờ có hiệu lực.
   */
  kind?: "full" | "quick";
}): Promise<ContractReview> {
  if (input.fromTemplate) {
    const form = new FormData();
    form.append("contract_type_id", input.contractTypeId);
    form.append("title", input.title);
    form.append("prompt", input.prompt || "");
    form.append("intake", JSON.stringify(input.intake));
    form.append("kind", input.kind || "full");
    form.append("from_template", "true");
    return api.post("/api/v1/reviews", form);
  }
  if (!input.files.length) {
    throw new Error("Cần tải lên một file .docx (Hợp đồng review)");
  }
  if (input.files.length > 1) {
    throw new Error("Hợp đồng review chỉ được upload 1 file");
  }
  const primary = input.files[0];
  const references = input.referenceFiles || [];

  const form = new FormData();
  form.append("contract_type_id", input.contractTypeId);
  form.append("title", input.title);
  form.append("prompt", input.prompt || "");
  form.append("intake", JSON.stringify(input.intake));
  form.append("kind", input.kind || "full");
  form.append("files", primary);
  // Backend Sprint 1 nhận đúng một tệp và TỪ CHỐI nếu có `reference_files`
  // (mã lỗi `reference_files_unsupported`). Chỉ gửi khi thật sự có file, để
  // không biến một form không đính kèm gì thành lỗi 400.
  references.forEach((f) => form.append("reference_files", f));
  return api.post("/api/v1/reviews", form);
}

/**
 * Review nhanh: file .docx + Loại hợp đồng + Tên hợp đồng (bắt buộc).
 * Các trường intake khác điền mặc định từ cấu hình.
 */
export async function createQuickReview(input: {
  file: File;
  documentCategoryId: string;
  contractNameId: string;
  /** Loại giá trị HĐ cho checklist — mặc định loại đầu có checklist */
  contractTypeId?: string;
  prompt?: string;
}): Promise<ContractReview> {
  const file = input.file;
  if (!file?.name.toLowerCase().endsWith(".docx")) {
    throw new Error("Chỉ nhận file .docx");
  }
  if (!input.documentCategoryId?.trim()) {
    throw new Error("Chọn Loại hợp đồng");
  }
  if (!input.contractNameId?.trim()) {
    throw new Error("Chọn Tên hợp đồng");
  }

  const [categories, types, entities, bases, names] = await Promise.all([
    listDocumentCategories(),
    listContractTypes(),
    listBusinessEntities(),
    listContractBases(),
    listContractNames(),
  ]);

  const category = categories.find((c) => c.id === input.documentCategoryId);
  const nameOpt = names.find((n) => n.id === input.contractNameId);
  if (!category) throw new Error("Loại hợp đồng không hợp lệ");
  if (!nameOpt || nameOpt.documentCategoryId !== category.id) {
    throw new Error("Tên hợp đồng không hợp lệ với Loại hợp đồng đã chọn");
  }

  const entity = entities[0];
  const base = bases[0];
  const type =
    types.find((t) => t.id === input.contractTypeId) ||
    // `!== "archived"` chứ không phải `=== "published"`: backend trả `active`,
    // nên so bằng "published" luôn trượt và rơi xuống `types[0]` — tức là chọn
    // đại loại giá trị HĐ đầu bảng thay vì loại thật sự có checklist.
    types.find((t) => t.hasChecklist && t.status !== "archived") ||
    types[0];
  if (!entity || !type) {
    throw new Error("Thiếu cấu hình công ty / loại giá trị HĐ");
  }

  const title =
    nameOpt.label || file.name.replace(/\.docx$/i, "");
  const today = new Date().toISOString().slice(0, 10);

  const intake: DocumentIntakeMeta = {
    documentCategoryId: category.id,
    documentCategoryLabel: category.label,
    documentName: title,
    documentNumber: "",
    signingDate: today,
    contractNameId: nameOpt.id,
    contractNameLabel: nameOpt.label,
    businessEntityId: entity.id,
    businessEntityLabel: entity.label,
    contractBaseId: base?.id,
    contractBaseLabel: base?.label,
    hasDiscount: "no",
    discountDetails: "",
    contractValue: "0",
  };

  return createReview({
    contractTypeId: type.id,
    title,
    prompt: input.prompt || "",
    files: [file],
    intake,
    kind: "quick",
  });
}


/** Cập nhật thông tin hợp đồng (intake) — dùng khi nháp / trước khi gửi Legal. */
export async function updateReviewIntake(
  id: string,
  input: {
    intake: DocumentIntakeMeta;
    contractTypeId: string;
    prompt?: string;
  },
  /** `review.rowVersion` đọc được lúc mở màn — chặn ghi đè khi có tab khác. */
  rowVersion?: number
): Promise<ContractReview> {
  return api.patch(`/api/v1/reviews/${id}/intake`, input, {
    ifMatch: rowVersion,
  });
}

/** Nháp → đưa vào Processing Queue để AI review. */
export async function submitDraftToQueue(id: string): Promise<ContractReview> {
  return api.post(`/api/v1/reviews/${id}/retry-ai`);
}

/**
 * Một lượt chat. Trả về **ticket đầy đủ** đã cập nhật (kể cả `proposals` mới).
 *
 * Backend trả nguyên `ContractReview` chứ không trả `{review, reply}` — FE thay
 * hẳn state bằng object này sau mỗi mutation, nên endpoint nào sửa ticket cũng
 * trả bản đầy đủ.
 */
export async function sendChat(
  id: string,
  content: string
): Promise<ContractReview> {
  return api.post(`/api/v1/reviews/${id}/chat`, { content });
}

export async function updateProposalStatus(
  id: string,
  proposalId: string,
  status: "accepted" | "undone" | "rejected"
): Promise<ContractReview> {
  return api.post(`/api/v1/reviews/${id}/proposals/${proposalId}`, { status });
}

export async function acceptAllProposals(id: string): Promise<ContractReview> {
  return api.post(`/api/v1/reviews/${id}/proposals/accept-all`);
}

export async function undoAllProposals(id: string): Promise<ContractReview> {
  return api.post(`/api/v1/reviews/${id}/proposals/undo-all`);
}

/** Cập nhật toàn bộ nội dung reviewed sau khi user sửa trực tiếp trên Word embed. */
export async function updateReviewedDocument(
  id: string,
  plainText: string
): Promise<ContractReview> {
  // Backend KHÔNG có endpoint ghi toàn văn bản: nhận cả tài liệu làm payload thì
  // không thể biết phần nào người dùng được phép sửa — phá vỡ mô hình vùng khoá.
  // Ghi phải đi qua saveFields(), định vị bằng permId.
  void plainText;
  throw new Error(
    "Không còn ghi toàn văn bản. Dùng saveFields(id, fields) để ghi theo vùng mở."
  );
}

/** Cập nhật nội dung một section (vùng mở) sau khi user gõ trực tiếp trên Word pane. */
export async function updateReviewedSection(
  id: string,
  sectionIndex: number,
  nextBody: string
): Promise<ContractReview> {
  // Định vị bằng số thứ tự đoạn không sống sót qua các vòng sửa.
  // Backend định vị bằng permId của vùng mở.
  void sectionIndex;
  void nextBody;
  throw new Error(
    "Không còn ghi theo số thứ tự đoạn. Dùng saveFields(id, fields) với permId."
  );
}

export async function saveFields(
  id: string,
  fields: EditableField[],
  /** `review.rowVersion` đọc được lúc mở màn — chặn ghi đè khi có tab khác. */
  rowVersion?: number
): Promise<ContractReview> {
  return api.put(`/api/v1/reviews/${id}/fields`, { fields }, { ifMatch: rowVersion });
}

import {
  buildEcontractPayload as buildEcontractPayloadFromFlow,
  markerTypeForSignType,
  normalizeSigningFlow,
  recipientNeedsMarker,
  validateIdentifySigners,
  validateMarkers,
} from "@/lib/domain/econtract-flow";

export {
  buildMarkerSyntax,
  markerTypeForSignType,
  normalizeSigningFlow,
  recipientNeedsMarker,
  validateIdentifySigners,
  validateMarkers,
} from "@/lib/domain/econtract-flow";

/** Cập nhật thông tin người ký (email, orgName, hình thức ký...) trước khi đẩy eContract. */
export async function updateRecipient(
  id: string,
  recipientId: string,
  patch: Partial<SignRecipient>
): Promise<ContractReview> {
  return api.patch(`/api/v1/reviews/${id}/recipients/${recipientId}`, patch);
}

const VERSION_ACTION_LABEL: Record<ContractVersionAction, string> = {
  submit_legal: "Purchasing submit Legal duyệt",
  legal_reject: "Legal sửa & trả về Purchasing",
  resubmit: "Purchasing sửa lại & resubmit",
  reupload: "Purchasing upload lại file",
};

/**
 * Chốt 1 version file mới (snapshot nội dung hiện tại) và bump review.version.
 * v1 = submit Legal lần đầu, v2 = Legal sửa, v3 = Purchasing sửa lại, …
 */
function pushVersionEntry(
  review: ContractReview,
  action: ContractVersionAction,
  actor: { role: "purchasing" | "legal"; name: string },
  extra?: { feedback?: StructuredFeedbackItem[] }
): ContractVersionEntry {
  const history = review.versionHistory ? [...review.versionHistory] : [];
  const version = (history[history.length - 1]?.version || 0) + 1;
  const entry: ContractVersionEntry = {
    version,
    action,
    actorRole: actor.role,
    actorName: actor.name,
    label: VERSION_ACTION_LABEL[action],
    createdAt: new Date().toISOString(),
    fileName: review.fileName,
    reviewedDocxUrl: review.reviewedDocxUrl || review.originalDocxUrl,
    reviewedText: review.reviewedText || review.originalText,
    feedback: extra?.feedback,
  };
  history.push(entry);
  review.versionHistory = history;
  review.version = version;
  return entry;
}

export async function submitToLegal(id: string): Promise<ContractReview> {
  return api.post(`/api/v1/reviews/${id}/submit`);
}

/** Purchasing Manager approve / reject (lane 4 swimlane). */
export async function managerDecide(
  id: string,
  decision: "approve" | "reject",
  comment = ""
): Promise<ContractReview> {
  return api.post(`/api/v1/reviews/${id}/manager-decide`, { decision, comment });
}

export async function legalDecide(
  id: string,
  decision: "approve" | "reject",
  feedback: StructuredFeedbackItem[] = []
): Promise<ContractReview> {
  return api.post(`/api/v1/reviews/${id}/legal-decision`, { decision, feedback });
}

/**
 * Lưu danh sách người ký (bước 1 wizard) — chuẩn hoá thứ tự mua trước, trên→dưới.
 */
export async function saveSigningRecipients(
  id: string,
  recipients: SignRecipient[]
): Promise<ContractReview> {
  return api.put(`/api/v1/reviews/${id}/recipients`, { recipients });
}

/**
 * Người tạo hoàn tất kéo-thả marker → đẩy eContract.
 *
 * KHÔNG gửi username/password lên server nữa. Credentials tích hợp FPT thuộc
 * về server, đọc từ `.env`, và không bao giờ được đi qua trình duyệt — bản
 * demo cũ lấy mật khẩu đăng nhập của người dùng rồi POST kèm mỗi lần Submit.
 *
 * Server chỉ ghi outbox rồi trả ngay; worker mới gọi FPT. Nên response về là
 * `syncing_econtract`, chưa phải `signed`.
 */
export async function completeMarkersAndPushEcontract(
  id: string
): Promise<ContractReview> {
  const review = await getReviewById(id);
  if (!review) throw new Error("Not found");
  if (review.status !== "pending_markers") {
    throw new Error("Ticket không ở trạng thái chờ gán chữ ký");
  }
  const errors = validateMarkers(review.recipients);
  if (errors.length) throw new Error(errors[0]);
  await assertSigningMatrixReady(review);

  const data = (await api.post(
    `/api/v1/reviews/${id}/econtract/push`
  )) as ContractReview & { econtractQueued?: boolean; isMock?: boolean };


  return data;
}

/** Huỷ hợp đồng đang trình ký. FPT bắt buộc có lý do, người ký sẽ nhìn thấy. */
export async function cancelEcontract(
  id: string,
  reason: string
): Promise<ContractReview> {
  return api.post(`/api/v1/reviews/${id}/econtract/cancel`, { reason });
}

/** Trạng thái đẩy: envelope, số lần thử, lỗi cuối. Dùng cho màn theo dõi. */
export async function getEcontractStatus(id: string): Promise<{
  status: string;
  econtract: ContractReview["econtract"];
  isMock: boolean;
  outbox: {
    status: string;
    attempts: number;
    envelopeId: string | null;
    lastError: string | null;
    lastErrorCode: string | null;
    nextAttemptAt: string | null;
  } | null;
}> {
  return api.get(`/api/v1/reviews/${id}/econtract`);
}

/**
 * Danh sách vị trí neo marker, đọc từ chính tài liệu.
 *
 * Đây là thứ thay cho "trang + toạ độ": người dùng kéo-thả rồi UI hít vào một
 * anchor trong danh sách này, và gửi `paraId` của nó lên BE.
 */
// ─────────────────────────────────────────────────────────────────────────────
// Template hợp đồng (Legal)
// ─────────────────────────────────────────────────────────────────────────────

export async function listTemplates(
  contractNameId?: string
): Promise<ContractTemplateInfo[]> {
  const q = contractNameId ? `?contract_name_id=${encodeURIComponent(contractNameId)}` : "";
  return api.get(`/api/v1/templates${q}`);
}

/**
 * Soi thử một `.docx` mà **không lưu gì**.
 *
 * Cho Legal thấy trước: vùng mở nào hệ thống ghi được, vùng nào chỉ chú thích,
 * Restrict Editing có hiệu lực không. Nhận vào rồi mới phát hiện thì mọi file
 * sinh từ template đó đều coi cả tài liệu là vùng mở.
 */
export async function lintTemplate(file: File): Promise<TemplateLintResult> {
  const form = new FormData();
  form.append("file", file);
  return api.post("/api/v1/templates/lint", form);
}

export async function registerTemplate(
  contractNameId: string,
  file: File,
  fieldLabels: Record<string, string> = {}
): Promise<ContractTemplateInfo> {
  const form = new FormData();
  form.append("contract_name_id", contractNameId);
  form.append("field_labels", JSON.stringify(fieldLabels));
  form.append("file", file);
  return api.post("/api/v1/templates", form);
}

/**
 * Đặt tên nghiệp vụ cho từng vùng mở.
 *
 * Bắt buộc phải có: `permId` của Range Permission là **số nguyên ngẫu nhiên
 * không tên** (`1808140627`…). Không có bảng này thì UI chỉ hiện "Vùng mở #7"
 * và AI không biết vùng đó là điều khoản gì.
 */
export async function setTemplateFieldLabels(
  templateId: string,
  labels: Record<string, string>
): Promise<ContractTemplateInfo> {
  return api.put(`/api/v1/templates/${templateId}/field-labels`, { labels });
}

export async function getActiveTemplate(contractNameId: string): Promise<{
  contractNameId: string;
  requireTemplateMatch: boolean;
  template: ContractTemplateInfo | null;
}> {
  return api.get(`/api/v1/templates/active/${encodeURIComponent(contractNameId)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Comment 2 chiều (TH1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thread bình luận của một ticket.
 *
 * Backend tái neo ngay trong lần đọc này: tài liệu đổi được từ nhiều đường
 * (ghi trường, chat, reupload PT3), nên thread mất neo sẽ trả về `orphaned`
 * kèm lý do chứ không im lặng.
 */
export async function listComments(id: string): Promise<CommentThread[]> {
  return api.get(`/api/v1/reviews/${id}/comments`);
}

/** Mở thread mới. Neo bằng `permId` (vùng mở) HOẶC `paraId` (đoạn bất kỳ). */
export async function createComment(
  id: string,
  anchor: { permId?: string; paraId?: string },
  content: string
): Promise<CommentThread> {
  return api.post(`/api/v1/reviews/${id}/comments`, { ...anchor, content });
}

export async function replyComment(
  id: string,
  threadId: string,
  content: string
): Promise<CommentThread> {
  return api.post(`/api/v1/reviews/${id}/comments/${threadId}/replies`, {
    content,
  });
}

/**
 * Đóng thread. **Không** đổi trạng thái ticket — quy tắc A4b: yêu cầu chỉnh sửa
 * phải kết thúc bằng Từ chối, không phải bằng việc đóng bình luận.
 */
export async function resolveComment(
  id: string,
  threadId: string
): Promise<CommentThread> {
  return api.post(`/api/v1/reviews/${id}/comments/${threadId}/resolve`);
}

/**
 * Theo dõi trạng thái ticket bằng SSE thay cho polling.
 *
 * Dùng `fetch` + `ReadableStream` chứ KHÔNG dùng `EventSource`: `EventSource`
 * không gửi được header nên token phải nhét vào query string, và token trong URL
 * thì rơi vào access log của proxy, vào history trình duyệt, vào Referer. Với hệ
 * thống pháp chế thì đó là cái giá quá đắt cho một tiện lợi nhỏ.
 *
 * Trả về hàm dừng. Stream tự đóng khi ticket sang trạng thái chờ người dùng
 * thao tác (`reviewed`, `rejected`, `pending_markers`, `signed`, …).
 */
export function watchReviewStatus(
  id: string,
  handlers: {
    onStatus?: (s: ReviewStatusEvent) => void;
    onDone?: () => void;
    onError?: (message: string) => void;
  }
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const controller = new AbortController();

  (async () => {
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/v1/reviews/${id}/events`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`SSE ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Khung SSE kết thúc bằng dòng trống; giữ phần dở dang lại cho lần sau
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const event =
            frame.match(/^event:\s*(.+)$/m)?.[1]?.trim() || "message";
          const data = frame.match(/^data:\s*(.*)$/m)?.[1] ?? "";
          if (event === "done") {
            handlers.onDone?.();
            controller.abort();
            return;
          }
          if (event === "status" && data) {
            try {
              handlers.onStatus?.(JSON.parse(data) as ReviewStatusEvent);
            } catch {
              /* payload lỗi — bỏ qua, nhịp sau sẽ có bản mới */
            }
          }
        }
      }
      handlers.onDone?.();
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      handlers.onError?.(
        e instanceof Error ? e.message : "Mất kết nối theo dõi trạng thái"
      );
    }
  })();

  return () => controller.abort();
}

export async function getMarkerAnchors(
  id: string,
  opts?: { recommendedOnly?: boolean }
): Promise<MarkerAnchor[]> {
  const query = opts?.recommendedOnly ? "?recommended_only=true" : "";
  const body = (await api.get(
    `/api/v1/reviews/${id}/marker-anchors${query}`
  )) as { anchors: MarkerAnchor[] };
  return body.anchors ?? [];
}

/**
 * Đặt ô ký cho một người nhận.
 *
 * `anchor.paraId` là trường quan trọng nhất — nó quyết định marker được ghi vào
 * đâu trong `.docx`. `page`/`xPct`/`yPct` chỉ để UI vẽ lại ô ký lên preview;
 * gửi mà thiếu `paraId` thì BE phải suy ra và trả `marker.approximated = true`.
 */
export async function placeMarkerOnDocument(
  id: string,
  recipientId: string,
  placement: {
    anchor: {
      paraId: string;
      align?: "left" | "center" | "right";
      position?: "after" | "before";
      page?: number;
      xPct?: number;
      yPct?: number;
    };
    height?: number;
    width?: number;
    sizePreset?: "default" | "large";
    signType?: EcontractSignType;
  }
): Promise<ContractReview> {
  return api.post(`/api/v1/reviews/${id}/markers/place`, {
    recipientId,
    ...placement,
  });
}

/** Gỡ ô ký của một người nhận. */
export async function removeMarker(
  id: string,
  recipientId: string
): Promise<ContractReview> {
  return api.delete(`/api/v1/reviews/${id}/markers/${recipientId}`);
}

/** Xem trước lỗi marker bằng ĐÚNG bộ luật server sẽ dùng để chặn Submit. */
export async function validateMarkersOnServer(
  id: string
): Promise<MarkerIssue[]> {
  const body = (await api.get(`/api/v1/reviews/${id}/markers/validate`)) as {
    ok: boolean;
    issues: MarkerIssue[];
  };
  return body.issues ?? [];
}

/**
 * Áp dụng ma trận ký eContract (Loại HĐ cha + Giá trị) → thay recipients phía công ty.
 * Giữ nguyên bên đối tác và marker `st`.
 */
export async function applySigningMatrix(
  id: string
): Promise<{ review: ContractReview; bandLabel: string }> {
  // BE trả review PHẲNG kèm `bandLabel` (`{...review, bandLabel}`), không phải
  // `{review, bandLabel}`. Không tách ra ở đây thì nơi gọi destructure
  // `{ review }` sẽ nhận undefined và vỡ ở dòng ngay sau.
  const body = (await api.post(
    `/api/v1/reviews/${id}/apply-signing-matrix`,
    {}
  )) as ContractReview & { bandLabel?: string };
  const { bandLabel = "", ...review } = body;
  return { review: review as ContractReview, bandLabel };
}

async function fetchDocxBytes(url: string): Promise<ArrayBuffer> {
  // Cùng lý do với `docx-embed`: endpoint file của backend kiểm quyền, nên
  // fetch trần sẽ nhận 401.
  return fetchBinary(url);
}

/**
 * Phương thức 2 — upload lại .docx sau khi chỉnh sửa offline.
 * Chạy validateReupload trước; nếu OK → NEW review cycle (bump version, clear proposals/chat, queue AI).
 */
export async function reuploadSubmit(
  contractId: string,
  file: File,
  note = ""
): Promise<ContractReview> {
  if (!file.name.toLowerCase().endsWith(".docx")) {
    throw new ReuploadValidationError([
      {
        type: "unexpected_new_field",
        location: "File phải là .docx",
      },
    ]);
  }

  // Backend kiểm hai lớp và CHẶN CỨNG nếu lệch (ràng buộc C-4). Không gửi kèm
  // kết quả validate phía FE: nếu backend tin client thì mọi lớp kiểm ở đây chỉ
  // là trang trí. FE validate chỉ để báo sớm cho người dùng, không phải để
  // backend dựa vào.
  const form = new FormData();
  form.append("file", file, file.name);
  if (note) form.append("note", note);

  try {
    return await api.post(`/api/v1/reviews/${contractId}/reupload`, form);
  } catch (e) {
    // 422 kèm `issues[]` → dựng lại thành lỗi mà UI đã biết hiển thị
    const body = e instanceof ApiError ? (e.body as Record<string, unknown>) : null;
    const issues = body?.issues;
    if (Array.isArray(issues) && issues.length) {
      throw new ReuploadValidationError(issues as FieldStructureIssue[]);
    }
    throw e;
  }
}

export { ReuploadValidationError, formatIssueMessage };
export type { FieldStructureIssue, ReuploadValidationResult };

export function buildEcontractPayload(review: ContractReview) {
  return buildEcontractPayloadFromFlow(review, "<base64 file PDF đã chèn marker mực trắng>");
}


// ─────────────────────────────────────────────────────────────────────────────
// Track changes của người duyệt (TH2)
// ─────────────────────────────────────────────────────────────────────────────

/** Một đề xuất đọc từ SuperDoc. Không có `permId`: vùng đích do server giải. */
export interface LegalEditDraft {
  paraId: string;
  kind: "insert" | "delete" | "replace" | "format";
  before: string;
  after: string;
}

export async function listLegalEdits(id: string): Promise<LegalEdit[]> {
  return api.get(`/api/v1/reviews/${id}/legal-edits`);
}

/**
 * Gửi đề xuất đọc từ track changes.
 *
 * Gửi lại cùng một đoạn thì backend **ghi đè** đề xuất còn treo của chính người
 * này — người duyệt chỉnh lại góp ý là chuyện thường, không nên đẻ ra bản thứ
 * hai. Đề xuất đã áp hoặc đã bỏ thì giữ nguyên làm lịch sử.
 */
export async function submitLegalEdits(
  id: string,
  edits: LegalEditDraft[]
): Promise<LegalEdit[]> {
  return api.post(`/api/v1/reviews/${id}/legal-edits`, { edits });
}

/**
 * Áp hoặc bỏ một đề xuất.
 *
 * `apply` sinh version mới ở backend nên trả về cả ticket — state của FE cũ
 * ngay lúc đó.
 */
export async function decideLegalEdit(
  id: string,
  editId: string,
  action: "apply" | "reject",
  note = ""
): Promise<{ edits: LegalEdit[]; review: ContractReview }> {
  return api.post(`/api/v1/reviews/${id}/legal-edits/${editId}/decide`, {
    action,
    note,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tệp đính kèm của lượt duyệt (TH3)
// ─────────────────────────────────────────────────────────────────────────────

export async function listAttachments(id: string): Promise<AttachedFile[]> {
  return api.get(`/api/v1/reviews/${id}/attachments`);
}

/**
 * Đính kèm một tệp — lưu **nội dung thật** vào object storage.
 *
 * Khác `reuploadSubmit`: KHÔNG thay tài liệu, không bump version, không chạy lại
 * AI, và không bị đối chiếu cấu trúc. Đây là vật chứng đi kèm một ý kiến.
 */
export async function addAttachment(
  id: string,
  file: File,
  note = ""
): Promise<AttachedFile> {
  const form = new FormData();
  form.append("file", file, file.name);
  if (note) form.append("note", note);
  return api.post(`/api/v1/reviews/${id}/attachments`, form);
}
