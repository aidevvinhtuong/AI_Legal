import type { ContractInsight, ChecklistFinding } from "@/lib/types";

/** Tính Fairness Score 0–100 từ tỷ lệ Red Flags/Warnings/Missing vs Protections. */
export function computeFairnessScore(groups: ContractInsight["groups"]): number {
  const risk =
    groups.redFlags.length * 22 +
    groups.missingProtections.length * 14 +
    groups.warnings.length * 8;
  const protect = groups.protections.length * 18;
  return Math.max(0, Math.min(100, Math.round(55 - risk + protect)));
}

export function buildDefaultContractInsight(input: {
  contractId: string;
  contractName: string;
  aiConfidenceScore?: number;
  lastUpdatedAt?: string;
  groups?: Partial<ContractInsight["groups"]>;
  aiSummary?: string;
  fairnessScore?: number;
}): ContractInsight {
  const now = input.lastUpdatedAt || new Date().toISOString();
  const groups = {
    redFlags: input.groups?.redFlags ?? DEFAULT_RED_FLAGS,
    warnings: input.groups?.warnings ?? DEFAULT_WARNINGS,
    protections: input.groups?.protections ?? DEFAULT_PROTECTIONS,
    missingProtections:
      input.groups?.missingProtections ?? DEFAULT_MISSING,
  };
  const aiConfidenceScore = input.aiConfidenceScore ?? 72;
  return {
    contractId: input.contractId,
    contractName: input.contractName,
    aiConfidenceScore,
    fairnessScore:
      input.fairnessScore ?? computeFairnessScore(groups),
    aiSummary:
      input.aiSummary ??
      "Hợp đồng có khung bảo mật và chấm dứt bằng văn bản phù hợp playbook bên mua; điểm rủi ro chính nằm ở thời hạn thanh toán gốc (90 ngày) và điều khoản bảo mật trên vùng khoá chưa đạt khuyến nghị 5 năm. Giá trị thuộc cấp Director theo Approval Matrix.",
    lastUpdatedAt: now,
    groups,
  };
}

/** Khi user sửa field — bump nhẹ AI confidence và cập nhật timestamp/summary. */
export function bumpContractInsight(
  insight: ContractInsight,
  patch?: Partial<Pick<ContractInsight, "aiConfidenceScore" | "aiSummary">> & {
    extraWarning?: ChecklistFinding;
  }
): ContractInsight {
  const groups = { ...insight.groups };
  if (patch?.extraWarning) {
    const exists = groups.warnings.some((w) => w.id === patch.extraWarning!.id);
    if (!exists) {
      groups.warnings = [...groups.warnings, patch.extraWarning];
    } else {
      groups.warnings = groups.warnings.map((w) =>
        w.id === patch.extraWarning!.id ? patch.extraWarning! : w
      );
    }
  }
  const aiConfidenceScore = Math.min(
    95,
    patch?.aiConfidenceScore ??
      Math.min(95, (insight.aiConfidenceScore || 70) + 1)
  );
  return {
    ...insight,
    aiConfidenceScore,
    fairnessScore: computeFairnessScore(groups),
    aiSummary: patch?.aiSummary ?? insight.aiSummary,
    lastUpdatedAt: new Date().toISOString(),
    groups,
  };
}

const DEFAULT_RED_FLAGS: ChecklistFinding[] = [
  {
    id: "RF-PAY-90",
    title: "Thời hạn thanh toán vượt chuẩn",
    description:
      "Thời hạn thanh toán gốc (90 ngày) vượt checklist chuẩn ≤ 60 ngày đối với HĐ khung mua hàng.",
    severity: "block",
    relatedFieldId: "payment_days",
  },
  {
    id: "RF-CONF-LOCK",
    title: "Bảo mật vùng khoá chưa khớp khuyến nghị",
    description:
      "Điều khoản bảo mật trên vùng khoá còn 2 năm — khuyến nghị playbook là 5 năm sau khi chấm dứt.",
    severity: "high",
    relatedFieldId: null,
  },
];

const DEFAULT_WARNINGS: ChecklistFinding[] = [
  {
    id: "WN-ACCEPT",
    title: "Thiếu điều kiện nghiệm thu rõ ràng",
    description:
      "AI đề xuất bổ sung biên bản nghiệm thu trước thanh toán để giảm rủi ro thanh toán sớm.",
    severity: "high",
    relatedFieldId: "payment_days",
  },
];

const DEFAULT_PROTECTIONS: ChecklistFinding[] = [
  {
    id: "PT-CONF",
    title: "Đã có điều khoản bảo mật",
    description:
      "Hợp đồng đã có điều khoản bảo mật và chấm dứt bằng văn bản — phù hợp checklist cơ bản.",
    severity: "low",
    relatedFieldId: null,
  },
  {
    id: "PT-MATRIX",
    title: "Giá trị trong hạn mức Director",
    description:
      "Giá trị hợp đồng nằm trong hạn mức Director theo Approval Matrix (không cần BOD).",
    severity: "low",
    relatedFieldId: "contract_value",
  },
  {
    id: "PT-TERM",
    title: "Chấm dứt bằng văn bản 30 ngày",
    description:
      "Thông báo trước 30 ngày bằng văn bản — phù hợp playbook bên mua.",
    severity: "low",
    relatedFieldId: null,
  },
];

const DEFAULT_MISSING: ChecklistFinding[] = [
  {
    id: "MP-ACCEPT-CLAUSE",
    title: "Thiếu bảo vệ nghiệm thu trước thanh toán",
    description:
      "Checklist khuyến nghị có điều kiện nghiệm thu bắt buộc trước khi thanh toán đợt cuối — hiện chưa thấy đủ rõ trong bản gốc.",
    severity: "high",
    relatedFieldId: null,
  },
];

/** Insight rỗng / nháp (chưa AI review). */
export function emptyContractInsight(
  contractId: string,
  contractName: string
): ContractInsight {
  return {
    contractId,
    contractName,
    aiConfidenceScore: 0,
    fairnessScore: 0,
    aiSummary:
      "Chưa có kết quả AI review. Hoàn thiện file và bấm “Gửi AI review” để xem phân tích 4 nhóm.",
    lastUpdatedAt: new Date().toISOString(),
    groups: {
      redFlags: [],
      warnings: [],
      protections: [],
      missingProtections: [],
    },
  };
}
