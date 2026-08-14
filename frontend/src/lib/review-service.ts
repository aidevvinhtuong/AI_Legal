import { api, ECONTRACT_LIVE, USE_MOCK } from "@/lib/api";
import {
  loadFormLists,
  type CodeLabelOption,
  type ContractNameOption,
  type DiscountOption,
} from "@/lib/form-lists-store";
import {
  allocateDocumentNumber,
  parseDocumentNumber,
  syncDocSeqFromReviews,
} from "@/lib/document-number";
import {
  CONTRACT_TYPES,
  MOCK_USERS,
  buildAttachments,
  createMockReview,
  getReview,
  loadReviews,
  nextDocumentId,
  resolveTemplateUrlForContractType,
  upsertReview,
} from "@/lib/mock-data";
import { defaultPermissionsForRole } from "@/lib/permissions";
import type {
  ChatMessage,
  ContractReview,
  ContractTypeConfig,
  ContractVersionAction,
  ContractVersionEntry,
  DocumentCategory,
  DocumentIntakeMeta,
  EcontractSignType,
  EditableField,
  MarkerType,
  SignRecipient,
  StructuredFeedbackItem,
  UserRole,
  UserSession,
} from "@/lib/types";

function resolveContractType(id: string): ContractTypeConfig | undefined {
  const fromStore = loadFormLists().contractTypes.find((t) => t.id === id);
  return fromStore || CONTRACT_TYPES.find((t) => t.id === id);
}
import {
  buildDefaultContractInsight,
  bumpContractInsight,
  computeFairnessScore,
  emptyContractInsight,
} from "@/lib/contract-insight";
import {
  ReuploadValidationError,
  formatIssueMessage,
  validateReuploadFromBuffers,
  type FieldStructureIssue,
  type ReuploadValidationResult,
} from "@/lib/reupload-validation";

function delay(ms = 400) {
  return new Promise((r) => setTimeout(r, ms));
}

export function getSession(): UserSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as UserSession;
    // Session cũ chưa có permissions → suy từ role
    if (!parsed.permissions?.length && parsed.role) {
      parsed.permissions = defaultPermissionsForRole(parsed.role);
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setSession(user: UserSession) {
  localStorage.setItem("token", user.token);
  localStorage.setItem("user", JSON.stringify(user));
}

/** Lưu / lấy TK+MK đăng nhập AI Legal để gọi FPT.eContract login (username/password API). */
const ECONTRACT_LOGIN_KEY = "econtract_user_login";

export function setEcontractUserLogin(username: string, password: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(
    ECONTRACT_LOGIN_KEY,
    JSON.stringify({ username, password })
  );
}

export function getEcontractUserLogin(): {
  username: string;
  password: string;
} | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(ECONTRACT_LOGIN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { username?: string; password?: string };
    if (!parsed.username || !parsed.password) return null;
    return { username: parsed.username, password: parsed.password };
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(ECONTRACT_LOGIN_KEY);
  }
}

export async function loginAs(role: UserRole): Promise<UserSession> {
  if (USE_MOCK) {
    await delay(200);
    const user = MOCK_USERS[role];
    setSession(user);
    const { getUserByUsername } = await import("@/lib/user-store");
    const account = getUserByUsername(user.username);
    if (account) {
      setEcontractUserLogin(account.username, account.password);
    }
    return user;
  }
  const user = (await api.post("/api/v1/auth/login", { role }, {
    skipAuthRedirect: true,
  })) as UserSession;
  setSession(user);
  return user;
}

export async function loginWithCredentials(
  username: string,
  password: string
): Promise<UserSession> {
  if (USE_MOCK) {
    await delay(300);
    const { getUserByUsername, toSession } = await import("@/lib/user-store");
    const account = getUserByUsername(username);
    if (!account || account.password !== password) {
      throw new Error("Sai tài khoản hoặc mật khẩu");
    }
    if (!account.active) {
      throw new Error("Tài khoản đang bị khoá. Liên hệ IT.");
    }
    const session = toSession(account);
    setSession(session);
    setEcontractUserLogin(account.username, password);
    return session;
  }
  const user = (await api.post(
    "/api/v1/auth/login",
    { username, password },
    { skipAuthRedirect: true }
  )) as UserSession;
  setSession(user);
  setEcontractUserLogin(username, password);
  return user;
}

export async function changeOwnPassword(
  username: string,
  oldPassword: string,
  newPassword: string
): Promise<void> {
  if (USE_MOCK) {
    await delay(200);
    const { changePassword } = await import("@/lib/user-store");
    changePassword(username, oldPassword, newPassword);
    setEcontractUserLogin(username, newPassword);
    return;
  }
  await api.post("/api/v1/auth/change-password", {
    username,
    oldPassword,
    newPassword,
  });
  setEcontractUserLogin(username, newPassword);
}

/** Options cho field "Loại giá trị hợp đồng (Contract value type)" — Form lists cùng tên. */
export async function listContractTypes(): Promise<ContractTypeConfig[]> {
  if (USE_MOCK) {
    await delay(150);
    return loadFormLists().contractTypes.filter(
      (t) => t.label.trim() && t.id.trim() && t.status !== "archived"
    );
  }
  return api.get("/api/v1/contract-types");
}

export async function listDocumentCategories(): Promise<DocumentCategory[]> {
  if (USE_MOCK) {
    await delay(100);
    return loadFormLists().documentCategories.filter(
      (c) => c.status !== "archived"
    );
  }
  return api.get("/api/v1/document-categories");
}

export async function listDiscountOptions(): Promise<DiscountOption[]> {
  if (USE_MOCK) {
    await delay(50);
    return loadFormLists().discountOptions;
  }
  return api.get("/api/v1/discount-options");
}

export async function listBusinessEntities(): Promise<CodeLabelOption[]> {
  if (USE_MOCK) {
    await delay(50);
    return loadFormLists().businessEntities.filter(
      (e) => e.status !== "archived"
    );
  }
  return api.get("/api/v1/business-entities");
}

export async function listContractBases(): Promise<CodeLabelOption[]> {
  if (USE_MOCK) {
    await delay(50);
    return loadFormLists().contractBases.filter(
      (b) => b.status !== "archived"
    );
  }
  return api.get("/api/v1/contract-bases");
}

export async function listContractNames(): Promise<ContractNameOption[]> {
  if (USE_MOCK) {
    await delay(50);
    return loadFormLists().contractNames.filter(
      (n) => n.status !== "archived"
    );
  }
  return api.get("/api/v1/contract-names");
}

export async function listReviews(): Promise<ContractReview[]> {
  if (USE_MOCK) {
    await delay(200);
    const session = getSession();
    const all = loadReviews();
    if (!session) return all;
    if (session.role === "purchasing") {
      return all.filter(
        (r) =>
          r.ownerId === session.userId ||
          (!r.ownerId &&
            (r.ownerName.includes(session.name) ||
              r.ownerName.includes(session.username)))
      );
    }
    if (session.role === "purchasing_manager") {
      const { subordinateIds } = await import("@/lib/user-store");
      const subs = new Set(subordinateIds(session.userId));
      return all.filter(
        (r) =>
          r.ownerId === session.userId ||
          (r.ownerId && subs.has(r.ownerId)) ||
          (!r.ownerId &&
            (r.ownerName.includes(session.name) ||
              r.ownerName.includes(session.username)))
      );
    }
    return all;
  }
  return api.get("/api/v1/reviews");
}

export async function getReviewById(id: string): Promise<ContractReview> {
  if (USE_MOCK) {
    await delay(150);
    const review = getReview(id);
    if (!review) throw new Error("Không tìm thấy yêu cầu review");
    return review;
  }
  return api.get(`/api/v1/reviews/${id}`);
}

export async function createReview(input: {
  contractTypeId: string;
  title: string;
  prompt?: string;
  /** Hợp đồng review — đúng 1 file .docx */
  files: File[];
  /** Hợp đồng tham khảo — nhiều file (tuỳ chọn) */
  referenceFiles?: File[];
  intake: DocumentIntakeMeta;
}): Promise<ContractReview> {
  if (!input.files.length) {
    throw new Error("Cần tải lên một file .docx (Hợp đồng review)");
  }
  if (input.files.length > 1) {
    throw new Error("Hợp đồng review chỉ được upload 1 file");
  }
  const primary = input.files[0];
  const references = input.referenceFiles || [];
  const allNames = [primary.name, ...references.map((f) => f.name)];

  if (USE_MOCK) {
    await delay(500);
    const type = resolveContractType(input.contractTypeId);
    if (!type) throw new Error("Loại hợp đồng không hợp lệ");

    // Không so khớp nội dung file review với template loại HĐ khi tạo / upload.

    const session = getSession();
    const valueNum = Number(String(input.intake.contractValue).replace(/\D/g, "")) || 0;
    const refNote =
      references.length > 0
        ? ` · ${references.length} file tham khảo`
        : "";
    const existing = loadReviews();
    syncDocSeqFromReviews(existing);

    const lists = loadFormLists();
    const entity = lists.businessEntities.find(
      (e) => e.id === input.intake.businessEntityId
    );
    const category = lists.documentCategories.find(
      (c) => c.id === input.intake.documentCategoryId
    );
    if (!entity?.code || !category?.code) {
      throw new Error("Thiếu Công ty hoặc Loại hợp đồng để sinh Số tài liệu");
    }
    const documentNumber = allocateDocumentNumber(entity.code, category.code);
    const intake: DocumentIntakeMeta = {
      ...input.intake,
      documentNumber,
    };

    const review = createMockReview({
      id: `rev_${Date.now()}`,
      documentId: nextDocumentId(existing),
      code: documentNumber,
      title:
        intake.documentName ||
        input.title ||
        primary.name.replace(/\.docx$/i, ""),
      contractTypeId: type.id,
      contractTypeLabel: type.label,
      group: type.group,
      status: "queued",
      queuePosition: 2,
      fileName: primary.name,
      fileNames: allNames,
      attachments: buildAttachments({
        fileName: primary.name,
        fileNames: allNames,
        originalDocxUrl: "/samples/Template_HDDV_chung_2026.docx",
        reviewedDocxUrl: "/samples/Template_HDDV_chung_2026.docx",
      }),
      originalDocxUrl: "/samples/Template_HDDV_chung_2026.docx",
      reviewedDocxUrl: "/samples/Template_HDDV_chung_2026.docx",
      prompt: input.prompt || "",
      ownerName: session?.name || "Purchasing",
      ownerId: session?.userId,
      confidence: 0,
      proposals: [],
      intake,
      fields: [
        {
          id: "contract_value",
          label: "Giá trị hợp đồng (VND)",
          type: "number",
          value: String(valueNum || input.intake.contractValue),
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
          label: "Ngày ký",
          type: "date",
          value: input.intake.signingDate || "",
          locked: false,
        },
        {
          id: "has_discount",
          label: "Hợp đồng có chiết khấu",
          type: "select",
          value: input.intake.hasDiscount === "yes" ? "Có" : "Không",
          options: ["Có", "Không"],
          locked: false,
        },
      ],
      messages: [
        {
          id: `m_${Date.now()}`,
          role: "assistant",
          content: `Yêu cầu đã vào Processing Queue (1 file review${refNote}). Local LLM sẽ xử lý sớm.`,
          createdAt: new Date().toISOString(),
        },
      ],
      reviewedText: "",
    });
    upsertReview(review);
    return review;
  }

  const form = new FormData();
  form.append("contract_type_id", input.contractTypeId);
  form.append("title", input.title);
  form.append("prompt", input.prompt || "");
  form.append("intake", JSON.stringify(input.intake));
  form.append("files", primary);
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
    types.find((t) => t.hasChecklist && t.status === "published") ||
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
  });
}

export async function advanceQueue(id: string): Promise<ContractReview> {
  if (USE_MOCK) {
    await delay(800);
    const review = getReview(id);
    if (!review) throw new Error("Not found");
    if (review.status === "queued") {
      review.status = "processing";
      review.queuePosition = 0;
      review.updatedAt = new Date().toISOString();
      upsertReview(review);
      return review;
    }
    if (review.status === "processing") {
      const confidence = review.confidence || 72;
      const done = createMockReview({
        ...review,
        status: "reviewed",
        confidence,
        queuePosition: undefined,
        // Rỗng → dùng SAMPLE_REVIEWED + đề xuất demo mặc định
        reviewedText: review.reviewedText || undefined,
        proposals: review.proposals?.length ? review.proposals : undefined,
        messages: [
          ...(review.messages || []),
          {
            id: `m_${Date.now()}`,
            role: "assistant",
            content:
              "Đã hoàn tất review theo checklist. Có đề xuất Loại A (có thể accept) và cảnh báo Loại B trên vùng khoá — xem panel tài liệu bên phải.",
            createdAt: new Date().toISOString(),
          },
        ],
        updatedAt: new Date().toISOString(),
        contractInsight: buildDefaultContractInsight({
          contractId: review.id,
          contractName: review.title,
          aiConfidenceScore: confidence,
          lastUpdatedAt: new Date().toISOString(),
        }),
      });
      upsertReview(done);
      return done;
    }
    return review;
  }
  return api.get(`/api/v1/reviews/${id}`);
}

/** Cập nhật thông tin hợp đồng (intake) — dùng khi nháp / trước khi gửi Legal. */
export async function updateReviewIntake(
  id: string,
  input: {
    intake: DocumentIntakeMeta;
    contractTypeId: string;
    prompt?: string;
  }
): Promise<ContractReview> {
  if (USE_MOCK) {
    await delay(250);
    const review = getReview(id);
    if (!review) throw new Error("Not found");
    const type = resolveContractType(input.contractTypeId);
    if (!type) throw new Error("Loại hợp đồng không hợp lệ");

    let intake = input.intake;
    // Số tài liệu đã cấp thì giữ nguyên; nháp chưa có số → cấp mới (không cho user sửa).
    if (!parseDocumentNumber(intake.documentNumber)) {
      const lists = loadFormLists();
      const entity = lists.businessEntities.find(
        (e) => e.id === intake.businessEntityId
      );
      const category = lists.documentCategories.find(
        (c) => c.id === intake.documentCategoryId
      );
      if (entity?.code && category?.code) {
        syncDocSeqFromReviews(loadReviews());
        intake = {
          ...intake,
          documentNumber: allocateDocumentNumber(entity.code, category.code),
        };
      }
    }
    review.intake = intake;
    review.contractTypeId = type.id;
    review.contractTypeLabel = type.label;
    review.group = type.group;
    review.title = intake.documentName || review.title;
    if (intake.documentNumber) {
      review.code = intake.documentNumber;
    }
    if (input.prompt !== undefined) {
      review.prompt = input.prompt;
    }
    const valueNum =
      Number(String(input.intake.contractValue).replace(/\D/g, "")) || 0;
    review.fields = review.fields.map((f) => {
      if (f.id === "contract_value") {
        return { ...f, value: String(valueNum || input.intake.contractValue) };
      }
      if (f.id === "effective_date") {
        return { ...f, value: input.intake.signingDate || "" };
      }
      if (f.id === "has_discount") {
        return {
          ...f,
          value: input.intake.hasDiscount === "yes" ? "Có" : "Không",
        };
      }
      return f;
    });
    review.updatedAt = new Date().toISOString();
    upsertReview(review);
    return review;
  }
  return api.patch(`/api/v1/reviews/${id}/intake`, input);
}

/** Nháp → đưa vào Processing Queue để AI review. */
export async function submitDraftToQueue(id: string): Promise<ContractReview> {
  if (USE_MOCK) {
    await delay(300);
    const review = getReview(id);
    if (!review) throw new Error("Not found");
    if (review.status !== "draft") {
      throw new Error("Chỉ gửi AI review từ trạng thái nháp");
    }
    review.status = "queued";
    review.queuePosition = 1;
    review.updatedAt = new Date().toISOString();
    if (!review.reviewedText) {
      review.reviewedText = review.originalText;
    }
    review.messages = [
      ...review.messages,
      {
        id: `m_q_${Date.now()}`,
        role: "assistant",
        content: "Đã nhận bản nháp — đưa vào Processing Queue.",
        createdAt: new Date().toISOString(),
      },
    ];
    upsertReview(review);
    return review;
  }
  return api.post(`/api/v1/reviews/${id}/retry-ai`);
}

export async function sendChat(
  id: string,
  content: string
): Promise<{ review: ContractReview; reply: ChatMessage }> {
  if (USE_MOCK) {
    await delay(600);
    const review = getReview(id);
    if (!review) throw new Error("Not found");
    const userMsg: ChatMessage = {
      id: `m_u_${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    const reply: ChatMessage = {
      id: `m_a_${Date.now()}`,
      role: "assistant",
      content: `Đã cập nhật đề xuất theo yêu cầu: "${content.slice(0, 120)}". Diff cột 3 đã được làm mới (mock).`,
      createdAt: new Date().toISOString(),
    };
    review.messages = [...review.messages, userMsg, reply];
    review.reviewedText =
      review.reviewedText +
      `\n\n[Chat update] ${content.slice(0, 80)}`;
    review.updatedAt = new Date().toISOString();
    upsertReview(review);
    return { review, reply };
  }
  return api.post(`/api/v1/reviews/${id}/chat`, { content });
}

export async function updateProposalStatus(
  id: string,
  proposalId: string,
  status: "accepted" | "undone"
): Promise<ContractReview> {
  if (USE_MOCK) {
    await delay(200);
    const review = getReview(id);
    if (!review) throw new Error("Not found");
    const proposal = review.proposals.find((p) => p.id === proposalId);
    if (!proposal || proposal.kind !== "A") {
      throw new Error("Chỉ Accept/Undo được đề xuất Loại A (field mở)");
    }

    let text = review.reviewedText || review.originalText;
    if (status === "accepted") {
      // Ensure proposed text is present (already in reviewed for mock)
      if (proposal.originalText && text.includes(proposal.originalText)) {
        text = text.replace(proposal.originalText, proposal.proposedText);
      }
    } else {
      // Undo → revert proposed back to original in reviewed text
      if (proposal.proposedText && text.includes(proposal.proposedText)) {
        text = text.replace(proposal.proposedText, proposal.originalText);
      }
    }

    review.reviewedText = text;
    review.proposals = review.proposals.map((p) =>
      p.id === proposalId
        ? { ...p, status: status === "accepted" ? "accepted" : "pending" }
        : p
    );
    review.updatedAt = new Date().toISOString();
    upsertReview(review);
    return review;
  }
  return api.post(`/api/v1/reviews/${id}/proposals/${proposalId}`, { status });
}

export async function acceptAllProposals(id: string): Promise<ContractReview> {
  if (USE_MOCK) {
    let review = getReview(id);
    if (!review) throw new Error("Not found");
    const pending = review.proposals.filter(
      (p) => p.kind === "A" && p.status === "pending"
    );
    for (const p of pending) {
      review = await updateProposalStatus(id, p.id, "accepted");
    }
    return getReview(id)!;
  }
  return api.post(`/api/v1/reviews/${id}/proposals/accept-all`);
}

export async function undoAllProposals(id: string): Promise<ContractReview> {
  if (USE_MOCK) {
    let review = getReview(id);
    if (!review) throw new Error("Not found");
    const accepted = review.proposals.filter(
      (p) => p.kind === "A" && p.status === "accepted"
    );
    for (const p of accepted) {
      review = await updateProposalStatus(id, p.id, "undone");
    }
    return getReview(id)!;
  }
  return api.post(`/api/v1/reviews/${id}/proposals/undo-all`);
}

/** Cập nhật toàn bộ nội dung reviewed sau khi user sửa trực tiếp trên Word embed. */
export async function updateReviewedDocument(
  id: string,
  plainText: string
): Promise<ContractReview> {
  if (USE_MOCK) {
    await delay(200);
    const review = getReview(id);
    if (!review) throw new Error("Not found");
    review.reviewedText = plainText;
    review.updatedAt = new Date().toISOString();
    review.confidence = Math.min(95, (review.confidence || 70) + 1);
    review.confidenceDetail = {
      ...review.confidenceDetail,
      score: review.confidence,
      recentFieldChanges: [
        {
          fieldId: "document_body",
          label: "Nội dung tài liệu (chỉnh trên Word)",
          oldValue: "(trước chỉnh sửa)",
          newValue: plainText.slice(0, 120),
        },
      ],
    };
    review.contractInsight = bumpContractInsight(
      review.contractInsight ||
        buildDefaultContractInsight({
          contractId: review.id,
          contractName: review.title,
          aiConfidenceScore: review.confidence,
        }),
      { aiConfidenceScore: review.confidence }
    );
    upsertReview(review);
    return review;
  }
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
  if (USE_MOCK) {
    await delay(150);
    const review = getReview(id);
    if (!review) throw new Error("Not found");
    const blocks = (review.reviewedText || review.originalText)
      .trim()
      .split(/\n\s*\n/);
    if (sectionIndex < 0 || sectionIndex >= blocks.length) {
      throw new Error("Section không hợp lệ");
    }
    const lines = blocks[sectionIndex].split("\n");
    const first = lines[0] || "";
    const isHeading = /^ĐIỀU\s+\d+/i.test(first);
    blocks[sectionIndex] = isHeading && lines.length > 1
      ? `${first}\n${nextBody}`
      : nextBody;
    review.reviewedText = blocks.join("\n\n");
    review.updatedAt = new Date().toISOString();
    // Soft bump confidence when user edits open fields
    review.confidence = Math.min(95, (review.confidence || 70) + 1);
    review.confidenceDetail = {
      ...review.confidenceDetail,
      score: review.confidence,
      recentFieldChanges: [
        {
          fieldId: `section_${sectionIndex}`,
          label: `Đoạn ${sectionIndex + 1}`,
          oldValue: "(trước chỉnh sửa)",
          newValue: nextBody.slice(0, 80),
        },
      ],
    };
    review.contractInsight = bumpContractInsight(
      review.contractInsight ||
        buildDefaultContractInsight({
          contractId: review.id,
          contractName: review.title,
          aiConfidenceScore: review.confidence,
        }),
      { aiConfidenceScore: review.confidence }
    );
    upsertReview(review);
    return review;
  }
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
  fields: EditableField[]
): Promise<ContractReview> {
  if (USE_MOCK) {
    await delay(300);
    const review = getReview(id);
    if (!review) throw new Error("Not found");

    const merged = fields.map((f) => {
      const old = review.fields.find((x) => x.id === f.id);
      if (old?.locked || f.locked) {
        return { ...f, locked: true, value: old?.value ?? f.value };
      }
      return f;
    });

    const changes = merged
      .map((f) => {
        const old = review.fields.find((x) => x.id === f.id);
        if (!old || old.value === f.value || old.locked) return null;
        return {
          fieldId: f.id,
          label: f.label,
          oldValue: old.value,
          newValue: f.value,
        };
      })
      .filter(Boolean) as NonNullable<
      ContractReview["confidenceDetail"]["recentFieldChanges"][number]
    >[];

    review.fields = merged;
    const value = Number(fields.find((f) => f.id === "contract_value")?.value || 0);
    let score = 72;
    let warning: string | undefined;
    if (value > 5_000_000_000) {
      score = 58;
      warning =
        "Giá trị hợp đồng vượt hạn mức Director — theo Approval Matrix cần cấp BOD (cảnh báo, không routing).";
    } else if (value > 1_000_000_000) {
      score = 72;
    } else {
      score = 85;
    }
    review.confidence = score;
    review.confidenceDetail = {
      ...review.confidenceDetail,
      score,
      recentFieldChanges: changes,
      approvalMatrixWarning: warning,
      cons: warning
        ? [...review.confidenceDetail.cons.filter((c) => !c.includes("hạn mức")), warning]
        : review.confidenceDetail.cons.filter((c) => !c.includes("hạn mức")),
    };
    const baseInsight =
      review.contractInsight ||
      buildDefaultContractInsight({
        contractId: review.id,
        contractName: review.title,
        aiConfidenceScore: score,
      });
    review.contractInsight = bumpContractInsight(baseInsight, {
      aiConfidenceScore: score,
      extraWarning: warning
        ? {
            id: "WN-MATRIX",
            title: "Vượt hạn mức Approval Matrix",
            description: warning,
            severity: "high",
            relatedFieldId: "contract_value",
          }
        : undefined,
    });
    if (!warning) {
      review.contractInsight = {
        ...review.contractInsight,
        groups: {
          ...review.contractInsight.groups,
          warnings: review.contractInsight.groups.warnings.filter(
            (w) => w.id !== "WN-MATRIX"
          ),
        },
      };
      review.contractInsight = {
        ...review.contractInsight,
        fairnessScore: computeFairnessScore(review.contractInsight.groups),
      };
    }
    review.updatedAt = new Date().toISOString();
    upsertReview(review);
    return review;
  }
  return api.put(`/api/v1/reviews/${id}/fields`, { fields });
}

import {
  buildEcontractPayload as buildEcontractPayloadFromFlow,
  markerTypeForSignType,
  normalizeSigningFlow,
  recipientNeedsMarker,
  validateIdentifySigners,
  validateMarkers,
} from "@/lib/econtract-flow";

export {
  buildMarkerSyntax,
  markerTypeForSignType,
  normalizeSigningFlow,
  recipientNeedsMarker,
  validateIdentifySigners,
  validateMarkers,
} from "@/lib/econtract-flow";

export async function assignMarker(
  id: string,
  recipientId: string,
  positionLabel: string,
  height = 100
): Promise<ContractReview> {
  if (USE_MOCK) {
    await delay(200);
    const review = getReview(id);
    if (!review) throw new Error("Not found");
    review.recipients = review.recipients.map((r) => {
      if (r.id !== recipientId) return r;
      return {
        ...r,
        marker: {
          id: `${r.markerType}_${r.refRecipientId ?? r.id}`,
          type: r.markerType,
          height,
          positionLabel,
        },
      };
    });
    const allAssigned = review.recipients
      .filter(recipientNeedsMarker)
      .every((r) => r.marker);
    if (allAssigned && review.status === "reviewed") {
      review.status = "awaiting_markers";
    }
    review.updatedAt = new Date().toISOString();
    upsertReview(review);
    return review;
  }
  return api.post(`/api/v1/reviews/${id}/markers`, {
    recipientId,
    positionLabel,
    height,
  });
}

/** Cập nhật thông tin người ký (email, orgName, hình thức ký...) trước khi đẩy eContract. */
export async function updateRecipient(
  id: string,
  recipientId: string,
  patch: Partial<SignRecipient>
): Promise<ContractReview> {
  if (USE_MOCK) {
    await delay(150);
    const review = getReview(id);
    if (!review) throw new Error("Not found");
    review.recipients = review.recipients.map((r) => {
      if (r.id !== recipientId) return r;
      const next = { ...r, ...patch };
      // Đổi hình thức ký → cập nhật loại marker và gỡ marker cũ nếu lệch loại
      if (patch.signType && next.markerType !== "st") {
        const mt = markerTypeForSignType(patch.signType);
        if (mt) next.markerType = mt;
        if (next.marker && (!mt || next.marker.type !== mt)) {
          next.marker = undefined;
        }
        if (!mt) next.marker = undefined;
      }
      return next;
    });
    review.updatedAt = new Date().toISOString();
    upsertReview(review);
    return review;
  }
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
  if (USE_MOCK) {
    await delay(300);
    const review = getReview(id);
    if (!review) throw new Error("Not found");
    // Marker kéo-thả thực hiện SAU Legal approve — không chặn Submit.
    const session = getSession();
    // Có Line Manager → chờ Purchasing Manager; không có → thẳng Legal
    const { getUserById } = await import("@/lib/user-store");
    const owner = review.ownerId ? getUserById(review.ownerId) : undefined;
    const hasManager = Boolean(owner?.lineManagerId);
    review.status = hasManager ? "pending_manager" : "pending_legal";
    const isFirstSubmit = !(review.versionHistory?.length ?? 0);
    pushVersionEntry(review, isFirstSubmit ? "submit_legal" : "resubmit", {
      role: "purchasing",
      name: session?.name || review.ownerName,
    });
    review.updatedAt = new Date().toISOString();
    upsertReview(review);
    return review;
  }
  return api.post(`/api/v1/reviews/${id}/submit`);
}

/** Purchasing Manager approve / reject (lane 4 swimlane). */
export async function managerDecide(
  id: string,
  decision: "approve" | "reject",
  comment = ""
): Promise<ContractReview> {
  if (USE_MOCK) {
    await delay(350);
    const review = getReview(id);
    if (!review) throw new Error("Not found");
    if (review.status !== "pending_manager") {
      throw new Error("Ticket không ở trạng thái chờ Manager duyệt");
    }
    const session = getSession();
    if (decision === "reject") {
      if (!comment.trim()) throw new Error("Cần comment khi từ chối");
      review.status = "rejected";
      review.feedback = [
        {
          id: `fb_${Date.now()}`,
          clauseLabel: "Purchasing Manager feedback",
          comment: comment.trim(),
          done: false,
        },
      ];
      pushVersionEntry(review, "legal_reject", {
        role: "purchasing",
        name: session?.name || "Purchasing Manager",
      });
    } else {
      review.status = "pending_legal";
      pushVersionEntry(review, "resubmit", {
        role: "purchasing",
        name: session?.name || "Purchasing Manager",
      });
    }
    review.updatedAt = new Date().toISOString();
    upsertReview(review);
    return review;
  }
  return api.post(`/api/v1/reviews/${id}/manager-decide`, { decision, comment });
}

export async function legalDecide(
  id: string,
  decision: "approve" | "reject",
  feedback: StructuredFeedbackItem[] = []
): Promise<ContractReview> {
  if (USE_MOCK) {
    await delay(400);
    const review = getReview(id);
    if (!review) throw new Error("Not found");
    if (decision === "reject") {
      review.status = "rejected";
      review.feedback = feedback;
      const session = getSession();
      pushVersionEntry(
        review,
        "legal_reject",
        { role: "legal", name: session?.name || "Trần Thị Legal" },
        { feedback }
      );
    } else {
      // Legal duyệt → trả ticket cho người tạo gán vị trí chữ ký (kéo-thả).
      const {
        assertSigningMatrixReady,
        mergeCompanyRecipientsFromMatrix,
        resolveSigningRecipients,
      } = await import("@/lib/config-service");
      assertSigningMatrixReady(review);
      try {
        const orgName =
          review.recipients.find((r) => r.isMyOrg)?.orgName ||
          review.intake?.businessEntityLabel ||
          "Công ty SGVN";
        const resolved = resolveSigningRecipients(
          review.intake!.documentCategoryId,
          review.intake!.contractValue,
          orgName,
          review.intake?.businessEntityId
        );
        review.recipients = mergeCompanyRecipientsFromMatrix(
          review.recipients,
          resolved.companyRecipients
        );
      } catch {
        /* matrix assert đã chạy — giữ recipients nếu merge lỗi */
      }
      review.status = "pending_markers";
    }
    review.updatedAt = new Date().toISOString();
    upsertReview(review);
    return review;
  }
  return api.post(`/api/v1/reviews/${id}/legal-decision`, { decision, feedback });
}

/**
 * Lưu danh sách người ký (bước 1 wizard) — chuẩn hoá thứ tự mua trước, trên→dưới.
 */
export async function saveSigningRecipients(
  id: string,
  recipients: SignRecipient[]
): Promise<ContractReview> {
  if (USE_MOCK) {
    await delay(120);
    const review = getReview(id);
    if (!review) throw new Error("Not found");
    if (review.status !== "pending_markers") {
      throw new Error("Ticket không ở trạng thái chờ gán chữ ký");
    }
    const cleaned = recipients.filter((r) => r.name !== "__party_shell__");
    const idErrors = validateIdentifySigners(cleaned);
    if (idErrors.length) throw new Error(idErrors[0]);
    review.recipients = normalizeSigningFlow(cleaned);
    review.updatedAt = new Date().toISOString();
    upsertReview(review);
    return review;
  }
  return api.put(`/api/v1/reviews/${id}/recipients`, { recipients });
}

/**
 * Người tạo hoàn tất kéo-thả marker → đẩy eContract.
 * - USE_MOCK && !ECONTRACT_LIVE: giả lập sync (không cần BE).
 * - Ngược lại: POST /api/econtract/push (BE).
 */
export async function completeMarkersAndPushEcontract(
  id: string
): Promise<ContractReview> {
  const review = USE_MOCK ? getReview(id) : await getReviewById(id);
  if (!review) throw new Error("Not found");
  if (review.status !== "pending_markers") {
    throw new Error("Ticket không ở trạng thái chờ gán chữ ký");
  }
  const errors = validateMarkers(review.recipients);
  if (errors.length) throw new Error(errors[0]);
  const { assertSigningMatrixReady } = await import("@/lib/config-service");
  assertSigningMatrixReady(review);

  const useLivePush = !USE_MOCK || ECONTRACT_LIVE;

  if (!useLivePush) {
    await delay(600);
    const latest = getReview(id);
    if (!latest) throw new Error("Not found");
    latest.status = "syncing_econtract";
    latest.econtract = {
      envelopeId: `MOCK-ENV-${Date.now()}`,
      envStatus: "Processing",
      code: 0,
      message: "Mock push — bật NEXT_PUBLIC_ECONTRACT_LIVE=true để gọi BE thật",
      pushedAt: new Date().toISOString(),
      fileMode: "pdf",
    };
    latest.updatedAt = new Date().toISOString();
    upsertReview(latest);
    setTimeout(() => {
      const r = getReview(id);
      if (r && r.status === "syncing_econtract") {
        r.status = "signed";
        if (r.econtract) r.econtract.envStatus = "Completed";
        r.updatedAt = new Date().toISOString();
        upsertReview(r);
      }
    }, 2500);
    return latest;
  }

  const login = getEcontractUserLogin();
  if (!login) {
    throw new Error(
      "Thiếu tài khoản đăng nhập để gọi eContract — đăng nhập lại rồi Submit"
    );
  }

  const data = (await api.post("/api/v1/econtract/push", {
    reviewId: id,
    review,
    username: login.username,
    password: login.password,
  })) as {
    ok?: boolean;
    message?: string;
    econtract?: ContractReview["econtract"];
    review?: ContractReview;
  };

  if (data.ok === false) {
    throw new Error(data.message || "Đẩy eContract thất bại");
  }

  if (USE_MOCK) {
    const latest = getReview(id);
    if (!latest) throw new Error("Not found");
    latest.status = "syncing_econtract";
    latest.econtract = data.econtract;
    latest.updatedAt = new Date().toISOString();
    if (data.econtract?.envelopeId) {
      setTimeout(() => {
        const r = getReview(id);
        if (r && r.status === "syncing_econtract") {
          r.status = "signed";
          if (r.econtract) r.econtract.envStatus = "Completed";
          r.updatedAt = new Date().toISOString();
          upsertReview(r);
        }
      }, 3000);
    }
    upsertReview(latest);
    return latest;
  }

  if (data.review) return data.review;
  return getReviewById(id);
}

/** Gán marker bằng kéo-thả (trang + tọa độ %). */
export async function placeMarkerOnDocument(
  id: string,
  recipientId: string,
  placement: {
    page: number;
    xPct: number;
    yPct: number;
    height?: number;
    width?: number;
    sizePreset?: "default" | "large";
    signType?: EcontractSignType;
  }
): Promise<ContractReview> {
  if (USE_MOCK) {
    await delay(120);
    const review = getReview(id);
    if (!review) throw new Error("Not found");
    const target = review.recipients.find((r) => r.id === recipientId);
    if (!target) throw new Error("Không tìm thấy người nhận");
    if (!recipientNeedsMarker(target)) {
      throw new Error(
        `${target.name} không cần marker (chỉ Người ký / Văn thư)`
      );
    }
    const signType =
      placement.signType || target.signType || "sign_fca.passcode";
    const mt = markerTypeForSignType(signType as EcontractSignType);
    if (!mt) throw new Error("Hình thức ký không hợp lệ cho marker");
    const height =
      placement.height ??
      target.marker?.height ??
      (target.marker?.sizePreset === "large" ? 140 : 98);
    const width =
      placement.width ??
      target.marker?.width ??
      (target.marker?.sizePreset === "large" ? 220 : 164);
    const sizePreset =
      placement.sizePreset || target.marker?.sizePreset || "default";
    const positionLabel = `Trang ${placement.page} · (${Math.round(placement.xPct)}%, ${Math.round(placement.yPct)}%)`;
    review.recipients = review.recipients.map((r) => {
      if (r.id !== recipientId) return r;
      return {
        ...r,
        signType,
        markerType: mt,
        marker: {
          id: `${mt}_${r.id}`,
          type: mt,
          height,
          width,
          sizePreset,
          positionLabel,
          page: placement.page,
          xPct: placement.xPct,
          yPct: placement.yPct,
        },
      };
    });
    review.updatedAt = new Date().toISOString();
    upsertReview(review);
    return review;
  }
  return api.post(`/api/v1/reviews/${id}/markers/place`, {
    recipientId,
    ...placement,
  });
}

/**
 * Áp dụng ma trận ký eContract (Loại HĐ cha + Giá trị) → thay recipients phía công ty.
 * Giữ nguyên bên đối tác và marker `st`.
 */
export async function applySigningMatrix(
  id: string
): Promise<{ review: ContractReview; bandLabel: string }> {
  const {
    mergeCompanyRecipientsFromMatrix,
    resolveSigningRecipients,
  } = await import("@/lib/config-service");

  if (USE_MOCK) {
    await delay(200);
    const review = getReview(id);
    if (!review) throw new Error("Not found");
    const parentId = review.intake?.documentCategoryId;
    const value = review.intake?.contractValue;
    if (!parentId) {
      throw new Error("Thiếu Loại HĐ trên intake — không áp dụng ma trận ký");
    }
    if (value == null || String(value).trim() === "") {
      throw new Error("Thiếu Giá trị HĐ trên intake — không áp dụng ma trận ký");
    }
    const orgName =
      review.recipients.find((r) => r.isMyOrg)?.orgName ||
      review.intake?.businessEntityLabel ||
      "Công ty SGVN";
    const resolved = resolveSigningRecipients(
      parentId,
      value,
      orgName,
      review.intake?.businessEntityId
    );
    review.recipients = mergeCompanyRecipientsFromMatrix(
      review.recipients,
      resolved.companyRecipients
    );
    const allAssigned = review.recipients
      .filter(recipientNeedsMarker)
      .every((r) => r.marker);
    if (
      !allAssigned &&
      (review.status === "awaiting_markers" || review.status === "reviewed")
    ) {
      review.status = "reviewed";
    }
    review.updatedAt = new Date().toISOString();
    upsertReview(review);
    return { review, bandLabel: resolved.bandLabel };
  }
  return api.post(`/api/v1/reviews/${id}/apply-signing-matrix`, {});
}

async function fetchDocxBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Không tải được file tham chiếu (${res.status}): ${url}`);
  }
  return res.arrayBuffer();
}

/**
 * Phương thức 2 — upload lại .docx sau khi chỉnh sửa offline.
 * Chạy validateReupload trước; nếu OK → NEW review cycle (bump version, clear proposals/chat, queue AI).
 */
export async function reuploadSubmit(
  contractId: string,
  file: File
): Promise<ContractReview> {
  if (!file.name.toLowerCase().endsWith(".docx")) {
    throw new ReuploadValidationError([
      {
        type: "unexpected_new_field",
        location: "File phải là .docx",
      },
    ]);
  }

  if (USE_MOCK) {
    await delay(600);
    const review = getReview(contractId);
    if (!review) throw new Error("Not found");

    const previousUrl =
      review.reviewedDocxUrl ||
      review.originalDocxUrl ||
      resolveTemplateUrlForContractType(review.contractTypeId);
    const templateUrl = resolveTemplateUrlForContractType(review.contractTypeId);

    const [templateBytes, previousBytes, newlyBytes] = await Promise.all([
      fetchDocxBytes(templateUrl),
      fetchDocxBytes(previousUrl),
      file.arrayBuffer(),
    ]);

    const validation: ReuploadValidationResult =
      await validateReuploadFromBuffers({
        contractTypeId: review.contractTypeId,
        templateBytes,
        previousBytes,
        newlyBytes,
        currentVersion: review.version,
        templateFileName: templateUrl.split("/").pop(),
        previousFileName: previousUrl.split("/").pop(),
        newlyFileName: file.name,
      });

    if (!validation.isValid) {
      throw new ReuploadValidationError(validation.issues);
    }

    const blobUrl = URL.createObjectURL(file);

    review.fileName = file.name;
    review.fileNames = [file.name];
    review.originalDocxUrl = blobUrl;
    review.reviewedDocxUrl = blobUrl;
    review.attachments = buildAttachments({
      fileName: file.name,
      fileNames: [file.name],
      originalDocxUrl: blobUrl,
      reviewedDocxUrl: blobUrl,
    });
    const session = getSession();
    const entry = pushVersionEntry(review, "reupload", {
      role: "purchasing",
      name: session?.name || review.ownerName,
    });
    review.proposals = [];
    review.messages = [
      {
        id: `m_reupload_${Date.now()}`,
        role: "assistant",
        content: `Đã nhận file upload lại (v${entry.version}). Hệ thống coi đây là vòng review MỚI — đang đưa vào Processing Queue để chạy lại AI Review Engine. Các đề xuất/chat của phiên bản trước không được áp dụng tự động.`,
        createdAt: new Date().toISOString(),
      },
    ];
    review.feedback = [];
    review.status = "queued";
    review.queuePosition = 1;
    review.confidence = 0;
    review.contractInsight = emptyContractInsight(review.id, review.title);
    review.updatedAt = new Date().toISOString();
    upsertReview(review);
    return review;
  }

  const form = new FormData();
  form.append("file", file);
  return api.post(`/api/v1/reviews/${contractId}/reupload`, form) as Promise<ContractReview>;
}

export { ReuploadValidationError, formatIssueMessage };
export type { FieldStructureIssue, ReuploadValidationResult };

export function buildEcontractPayload(review: ContractReview) {
  return buildEcontractPayloadFromFlow(review, "<base64 file PDF đã chèn marker mực trắng>");
}

