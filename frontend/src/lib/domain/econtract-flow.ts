import type {
  ContractReview,
  DocumentIntakeMeta,
  EcontractNotifyType,
  EcontractSignType,
  EcontractUiRole,
  MarkerType,
  SignRecipient,
} from "@/lib/domain/types";

/** Mặc định: gửi cả email + SMS FPT.eContract. */
export const DEFAULT_NOTIFY_TYPES: EcontractNotifyType[] = [
  "email_econtract",
  "sms_econtract",
];

export const NOTIFY_TYPE_OPTIONS: {
  value: EcontractNotifyType;
  label: string;
}[] = [
  { value: "email_econtract", label: "Gửi bằng email FPT.eContract" },
  { value: "sms_econtract", label: "Gửi bằng SMS FPT.eContract" },
];

export function normalizeNotifyTypes(
  types?: EcontractNotifyType[] | null
): EcontractNotifyType[] {
  if (!types || types.length === 0) return [...DEFAULT_NOTIFY_TYPES];
  const allowed = new Set(NOTIFY_TYPE_OPTIONS.map((o) => o.value));
  const uniq = Array.from(new Set(types.filter((t) => allowed.has(t))));
  return uniq.length ? uniq : [...DEFAULT_NOTIFY_TYPES];
}

/** Thứ tự hiển thị / ký trong một bên (trên → dưới). */
export const UI_ROLE_ORDER: EcontractUiRole[] = [
  "coordinator",
  "reviewer",
  "signer",
  "clerk",
  "cc",
];

export const UI_ROLE_LABEL: Record<EcontractUiRole, string> = {
  coordinator: "Người điều phối",
  reviewer: "Người xem xét",
  signer: "Người ký",
  clerk: "Văn thư (Đóng dấu)",
  cc: "CC",
};

export const UI_ROLE_ADD_LABEL: Record<EcontractUiRole, string> = {
  coordinator: "Thêm người điều phối",
  reviewer: "Thêm người xem xét",
  signer: "Thêm người ký",
  clerk: "Thêm văn thư",
  cc: "Thêm người cc",
};

/** Header màu gần giống màn eContract. */
export const UI_ROLE_HEADER_CLASS: Record<EcontractUiRole, string> = {
  coordinator: "bg-slate-200 text-slate-800",
  reviewer: "bg-amber-100 text-amber-900",
  signer: "bg-sky-200 text-sky-900",
  clerk: "bg-emerald-100 text-emerald-900",
  cc: "bg-pink-100 text-pink-900",
};

export function normalizeUiRole(
  role: string | undefined | null
): EcontractUiRole {
  if (
    role === "coordinator" ||
    role === "reviewer" ||
    role === "signer" ||
    role === "clerk" ||
    role === "cc"
  ) {
    return role;
  }
  return "signer";
}

/** Ký chính + Văn thư cần marker; điều phối / xem xét / CC không. */
export function recipientNeedsMarker(r: SignRecipient): boolean {
  const role = normalizeUiRole(r.ecRole);
  if (role === "coordinator" || role === "reviewer" || role === "cc") {
    return false;
  }
  if (r.signType === "review") return false;
  return role === "signer" || role === "clerk";
}

/** Map UI role → role API FPT (chỉ document signer|reviewer). */
export function toApiRecipientRole(
  role: EcontractUiRole | undefined
): "signer" | "reviewer" {
  const r = normalizeUiRole(role);
  return r === "signer" || r === "clerk" ? "signer" : "reviewer";
}

export function markerTypeForSignType(
  signType: EcontractSignType
): MarkerType | null {
  if (signType === "review") return null;
  if (signType === "sign_img") return "is";
  return "ds";
}

export function defaultSignTypeForRole(
  role: EcontractUiRole
): EcontractSignType {
  if (role === "signer" || role === "clerk") return "sign_fca.passcode";
  return "review";
}

export function econtractSignTypes(signType?: EcontractSignType): string[] {
  if (!signType || signType === "review") return [];
  if (signType === "sign_img") return ["Sign-IMG"];
  if (signType === "sign_ekyc") return ["sign_ekyc", "sign_fca.otp"];
  return ["sign_fca.passcode"];
}

/**
 * contactId gửi FPT: nhập tay → local-part email → id.
 *
 * Backend đã điền `contactId` (username tài khoản) khi dựng recipients từ bảng
 * phân quyền ký, nên ở đây chỉ còn suy luận dự phòng từ email.
 */
export function resolveContactId(r: SignRecipient): string {
  const manual = r.contactId?.trim();
  if (manual) return manual;
  const email = r.email?.trim();
  if (email?.includes("@")) {
    const local = email.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "");
    if (local) return local;
  }
  return r.id.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function discountHeaderValue(flag: DocumentIntakeMeta["hasDiscount"] | undefined): string {
  if (flag === "yes") return "Có - Yes";
  if (flag === "no") return "Không - No";
  return "";
}

function buildHeaderFields(review: ContractReview) {
  const intake = review.intake;
  const envName =
    intake?.documentName?.trim() || review.title || review.fileName || "";
  const envNo = intake?.documentNumber?.trim() || review.code || "";
  const envDate = intake?.signingDate?.trim() || "";
  const envSubmittedFrom = intake?.businessEntityLabel?.trim() || "";
  const envF00 =
    intake?.documentCategoryLabel?.trim() ||
    review.contractTypeLabel ||
    "";
  const envF01 = discountHeaderValue(intake?.hasDiscount);
  const envF02 = intake?.discountDetails?.trim() || "";
  const envF03 = String(intake?.contractValue ?? "").replace(/\s/g, "") || "0";

  return [
    {
      id: "envName",
      name: "Tên tài liệu",
      type: "String",
      value: envName,
    },
    {
      id: "envNo",
      name: "Số tài liệu",
      type: "String",
      value: envNo,
    },
    {
      id: "envDate",
      name: "Ngày ký",
      type: "Date",
      value: envDate,
    },
    {
      id: "envSubmittedFrom",
      name: "Đơn vị tạo yêu cầu",
      type: "String",
      value: envSubmittedFrom,
    },
    {
      id: "envF00",
      name: "Loại hợp đồng",
      type: "String",
      value: envF00,
    },
    {
      id: "envF01",
      name: "Hợp đồng có chiết khấu",
      type: "String",
      value: envF01,
    },
    {
      id: "envF02",
      name: "Chi tiết chiết khấu",
      type: "String",
      value: envF02,
    },
    {
      id: "envF03",
      name: "Giá trị hợp đồng",
      type: "Number",
      value: envF03,
    },
  ];
}

export type CounterpartyKind = "organization" | "individual";

export type SigningPartyBucket = {
  partyId: string;
  isMyOrg: boolean;
  orgName: string;
  /** Tổ chức | Cá nhân — bắt buộc với bên đối tác. */
  partyKind?: CounterpartyKind | null;
  /** Thứ tự bên: mua trước (1), đối tác tiếp theo. */
  order: number;
  recipients: SignRecipient[];
};

/** Nhóm recipients theo party; bên mua trước, rồi đối tác theo order. */
export function groupRecipientsByParty(
  recipients: SignRecipient[]
): SigningPartyBucket[] {
  const map = new Map<string, SigningPartyBucket>();
  for (const r of recipients) {
    if (r.markerType === "st") continue;
    const partyId =
      r.partyId ||
      (r.isMyOrg || r.role === "company" ? "p_001" : `p_${r.id}`);
    if (!map.has(partyId)) {
      const isMyOrg = r.isMyOrg ?? r.role === "company";
      map.set(partyId, {
        partyId,
        isMyOrg,
        orgName: r.orgName || "",
        partyKind: isMyOrg
          ? "organization"
          : r.partyKind ?? null,
        order: r.order ?? 99,
        recipients: [],
      });
    }
    const bucket = map.get(partyId)!;
    bucket.recipients.push(r);
    if (r.orgName) bucket.orgName = r.orgName;
    if (!bucket.isMyOrg && r.partyKind) bucket.partyKind = r.partyKind;
  }

  const list = Array.from(map.values());
  list.sort((a, b) => {
    if (a.isMyOrg !== b.isMyOrg) return a.isMyOrg ? -1 : 1;
    return a.order - b.order || a.partyId.localeCompare(b.partyId);
  });
  // Sort within party: role sections top→bottom, then insertion order
  for (const p of list) {
    p.recipients.sort((a, b) => {
      const ra = UI_ROLE_ORDER.indexOf(normalizeUiRole(a.ecRole));
      const rb = UI_ROLE_ORDER.indexOf(normalizeUiRole(b.ecRole));
      if (ra !== rb) return ra - rb;
      return (a.order ?? 0) - (b.order ?? 0);
    });
  }
  return list;
}

/**
 * Gán lại party order + recipient order + id chuẩn p_XXX_r_YYY
 * theo màn hình: bên mua trước, trong bên từ trên xuống.
 */
export function normalizeSigningFlow(
  recipients: SignRecipient[]
): SignRecipient[] {
  const parties = groupRecipientsByParty(recipients);
  const next: SignRecipient[] = [];
  parties.forEach((party, pIdx) => {
    const partyId = `p_${String(pIdx + 1).padStart(3, "0")}`;
    const partyOrder = pIdx + 1; // mua = 1
    party.recipients.forEach((r, rIdx) => {
      const role = normalizeUiRole(r.ecRole);
      const signType =
        role === "signer" || role === "clerk"
          ? r.signType && r.signType !== "review"
            ? r.signType
            : "sign_fca.passcode"
          : "review";
      const mt = markerTypeForSignType(signType);
      const id = `${partyId}_r_${String(rIdx + 1).padStart(3, "0")}`;
      const keepMarker =
        r.marker &&
        recipientNeedsMarker({ ...r, ecRole: role, signType }) &&
        mt;
      next.push({
        ...r,
        id,
        partyId,
        isMyOrg: party.isMyOrg,
        role: party.isMyOrg ? "company" : "counterparty",
        orgName: party.orgName || r.orgName || "",
        partyKind: party.isMyOrg
          ? "organization"
          : party.partyKind || r.partyKind,
        order: rIdx + 1,
        ecRole: role,
        signType,
        notifyTypes: normalizeNotifyTypes(r.notifyTypes),
        markerType: mt || r.markerType || "ds",
        marker: keepMarker
          ? {
              ...r.marker!,
              id: `${mt}_${id}`,
              type: mt!,
            }
          : undefined,
      });
    });
    void partyOrder;
  });
  // Preserve text markers (st)
  for (const r of recipients) {
    if (r.markerType === "st") next.push(r);
  }
  return next;
}

export function buildMarkerSyntax(r: SignRecipient): string {
  if (!r.marker) return "";
  const ref = r.refRecipientId || r.id;
  const width = r.marker.width ?? 164;
  const pad = Math.max(1, Math.round(width / 8));
  const spaces = " ".repeat(pad);
  return `#${r.marker.type}:${r.marker.id} r:${ref} h:${r.marker.height}${spaces}#`;
}

export function validateMarkers(recipients: SignRecipient[]): string[] {
  const errors: string[] = [];
  const markerIds = new Set<string>();

  for (const r of recipients) {
    if (r.markerType === "st") continue;
    const role = normalizeUiRole(r.ecRole);

    if (!r.ecRole) {
      errors.push(`recipientRoleIsNull: thiếu role cho ${r.name || "(chưa tên)"}`);
    }
    if (!r.orgName?.trim()) {
      errors.push(
        `isNotExistsIndividual: thiếu orgName cho ${r.name || role}`
      );
    }
    if (!r.email?.includes("@")) {
      errors.push(
        `isNotExistsRecipientInfo: thiếu email cho ${r.name || role}`
      );
    }

    const needs = recipientNeedsMarker(r);
    if (!needs) {
      if (r.marker) {
        errors.push(
          `wrongFieldWithRole: ${r.name} (${UI_ROLE_LABEL[role]}) không được gán marker`
        );
      }
      continue;
    }

    if (!r.name?.trim()) {
      errors.push(`Thiếu họ tên người ${UI_ROLE_LABEL[role]}`);
    }

    if (!r.marker) {
      errors.push(
        `isNotExistsMarkerField: thiếu marker vị trí ký cho ${r.name || UI_ROLE_LABEL[role]} (${UI_ROLE_LABEL[role]})`
      );
      continue;
    }

    if (markerIds.has(r.marker.id)) {
      errors.push(`Trùng marker id: ${r.marker.id}`);
    }
    markerIds.add(r.marker.id);

    if (!(r.marker.height > 0)) {
      errors.push(`Marker ${r.marker.id}: chiều cao (h) phải > 0`);
    }

    const expected = markerTypeForSignType(r.signType || "sign_fca.passcode");
    if (expected && r.marker.type !== expected) {
      errors.push(
        `wrongFieldWithRole: ${r.name} — marker ${r.marker.type} không khớp hình thức ký`
      );
    }
  }

  return errors;
}

/** Validate bước 1 (người ký) trước khi sang thiết kế. */
export function validateIdentifySigners(recipients: SignRecipient[]): string[] {
  const errors: string[] = [];
  const parties = groupRecipientsByParty(recipients);
  if (!parties.some((p) => p.isMyOrg)) {
    errors.push("Thiếu bên tổ chức của tôi (bên mua)");
  }
  if (!parties.some((p) => !p.isMyOrg)) {
    errors.push("Chưa thêm bên ký đối tác — bấm Thêm bên ký");
  }
  for (const p of parties) {
    const real = p.recipients.filter((r) => r.name !== "__party_shell__");
    if (!p.isMyOrg) {
      if (p.partyKind !== "organization" && p.partyKind !== "individual") {
        errors.push(
          `Đối tác ${p.orgName || p.partyId}: bắt buộc chọn Tổ chức hoặc Cá nhân`
        );
      }
    }
    const nameLabel =
      p.partyKind === "individual" ? "tên cá nhân" : "tên tổ chức";
    if (!p.orgName.trim()) {
      errors.push(
        `Thiếu ${nameLabel} cho bên ${p.isMyOrg ? "mua" : "đối tác"} (${p.partyId})`
      );
    }
    const signers = real.filter(
      (r) => normalizeUiRole(r.ecRole) === "signer"
    );
    if (!signers.length) {
      errors.push(
        `${p.orgName || p.partyId}: cần ít nhất một Người ký (ký chính)`
      );
    }
    for (const r of real) {
      if (!r.name?.trim()) {
        errors.push(`Thiếu họ tên trong ${p.orgName || p.partyId}`);
      }
      if (!r.email?.includes("@")) {
        errors.push(
          `Email bắt buộc: ${r.name || normalizeUiRole(r.ecRole)} (${p.orgName})`
        );
      }
    }
  }
  return errors;
}

export function newEmptyRecipient(
  party: Pick<
    SigningPartyBucket,
    "partyId" | "isMyOrg" | "orgName" | "partyKind"
  >,
  role: EcontractUiRole,
  seq: number
): SignRecipient {
  const signType = defaultSignTypeForRole(role);
  const mt = markerTypeForSignType(signType);
  return {
    id: `${party.partyId}_r_${String(seq).padStart(3, "0")}`,
    name: "",
    role: party.isMyOrg ? "company" : "counterparty",
    partyId: party.partyId,
    orgName: party.orgName,
    isMyOrg: party.isMyOrg,
    partyKind: party.isMyOrg
      ? "organization"
      : party.partyKind || undefined,
    order: seq,
    email: "",
    phone: "",
    notifyTypes: [...DEFAULT_NOTIFY_TYPES],
    ecRole: role,
    signType,
    markerType: mt || "ds",
  };
}

export function buildEcontractPayload(
  review: ContractReview,
  fileBase64: string,
  opts?: { selector?: string; docTypeCode?: number | null }
) {
  const flow = normalizeSigningFlow(
    review.recipients.filter((r) => r.markerType !== "st")
  );
  const parties = groupRecipientsByParty(flow).map((p, pIdx) => ({
    id: p.partyId,
    isMyOrg: p.isMyOrg,
    isOrg: p.isMyOrg ? true : p.partyKind !== "individual",
    orgName: p.orgName,
    order: pIdx + 1,
    recipients: p.recipients.map((r, rIdx) => ({
      isEsign: false,
      recipientId: r.id,
      email: r.email || "",
      personalName: r.name,
      telephoneNumber: r.phone || "",
      contactId: resolveContactId(r),
      role: toApiRecipientRole(r.ecRole),
      order: rIdx + 1,
      notifyTypes: normalizeNotifyTypes(r.notifyTypes),
      signTypes: econtractSignTypes(r.signType),
    })),
  }));

  const selector =
    opts?.selector ||
    process.env.NEXT_PUBLIC_ECONTRACT_SELECTOR ||
    "flow_start_AI_LEGAL_create_auto_determine_econtract_integrate";

  const docTypeCode =
    opts?.docTypeCode !== undefined
      ? opts.docTypeCode
      : process.env.NEXT_PUBLIC_ECONTRACT_DOC_TYPE_CODE
        ? Number(process.env.NEXT_PUBLIC_ECONTRACT_DOC_TYPE_CODE)
        : 2;

  return {
    id: "",
    refId: review.code,
    selector,
    lookup: review.code,
    attrs: null,
    payload: null,
    body: {
      alias: "",
      refId: review.code,
      file: fileBase64,
      fileName: review.fileName.replace(/\.docx$/i, ".pdf"),
      docTypeCode,
      headerFields: buildHeaderFields(review),
      parties,
    },
  };
}
