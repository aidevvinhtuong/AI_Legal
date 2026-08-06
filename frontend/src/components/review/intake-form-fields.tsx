"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CodeLabelOption, DiscountOption } from "@/lib/form-lists-store";
import type {
  ContractTypeConfig,
  DiscountFlag,
  DocumentCategory,
  DocumentIntakeMeta,
} from "@/lib/types";
import { AlertTriangle, Calendar } from "lucide-react";

const DEFAULT_DISCOUNT_OPTIONS: DiscountOption[] = [
  { value: "yes", label: "Có" },
  { value: "no", label: "Không" },
];

function RequiredMark() {
  return <span className="text-destructive ml-0.5">*</span>;
}

export type IntakeFormValue = {
  documentCategoryId: string;
  documentName: string;
  documentNumber: string;
  signingDate: string;
  contractTypeId: string;
  contractNameId: string;
  businessEntityId: string;
  contractBaseId: string;
  hasDiscount: DiscountFlag | "";
  discountDetails: string;
  contractValue: string;
  prompt: string;
};

export function intakeFromReview(meta: {
  intake?: DocumentIntakeMeta;
  contractTypeId: string;
  prompt: string;
}): IntakeFormValue {
  const i = meta.intake;
  return {
    documentCategoryId: i?.documentCategoryId || "",
    documentName: i?.documentName || "",
    documentNumber: i?.documentNumber || "",
    signingDate: i?.signingDate || "",
    contractTypeId: meta.contractTypeId || "",
    contractNameId: i?.contractNameId || "",
    businessEntityId: i?.businessEntityId || "",
    contractBaseId: i?.contractBaseId || "",
    hasDiscount: (i?.hasDiscount as DiscountFlag | "") || "",
    discountDetails: i?.discountDetails || "",
    contractValue: i?.contractValue || "",
    prompt: meta.prompt || "",
  };
}

export function buildIntakeMeta(
  value: IntakeFormValue,
  categories: DocumentCategory[],
  businessEntities: CodeLabelOption[] = [],
  contractBases: CodeLabelOption[] = [],
  contractNames: CodeLabelOption[] = []
): DocumentIntakeMeta | null {
  const selectedCategory = categories.find((c) => c.id === value.documentCategoryId);
  if (!selectedCategory) return null;
  const entity = businessEntities.find((e) => e.id === value.businessEntityId);
  const base = contractBases.find((b) => b.id === value.contractBaseId);
  const contractName = contractNames.find((n) => n.id === value.contractNameId);
  return {
    documentCategoryId: value.documentCategoryId,
    documentCategoryLabel: selectedCategory.label,
    documentName: value.documentName.trim(),
    documentNumber: value.documentNumber.trim(),
    signingDate: value.signingDate,
    contractNameId: value.contractNameId || undefined,
    contractNameLabel: contractName?.label,
    businessEntityId: value.businessEntityId || undefined,
    businessEntityLabel: entity?.label,
    contractBaseId: value.contractBaseId || undefined,
    contractBaseLabel: base?.label,
    hasDiscount: value.hasDiscount,
    discountDetails: value.discountDetails.trim(),
    contractValue: value.contractValue.trim(),
  };
}

export function isIntakeFormValid(value: IntakeFormValue, requireFiles = false, fileCount = 0) {
  if (!value.documentCategoryId || !value.documentName.trim() || !value.contractTypeId) {
    return false;
  }
  if (!value.contractNameId || !value.businessEntityId || !value.contractBaseId) {
    return false;
  }
  if (!value.hasDiscount || !value.contractValue.trim()) return false;
  if (value.hasDiscount === "yes" && !value.discountDetails.trim()) return false;
  if (requireFiles && fileCount < 1) return false;
  return true;
}

/** Form chỉnh sửa thông tin hợp đồng — dùng chung tạo mới & nháp. */
export function IntakeFormFields({
  value,
  onChange,
  categories,
  types,
  discountOptions = DEFAULT_DISCOUNT_OPTIONS,
  businessEntities = [],
  contractBases = [],
  contractNames = [],
  disabled,
}: {
  value: IntakeFormValue;
  onChange: (next: IntakeFormValue) => void;
  categories: DocumentCategory[];
  types: ContractTypeConfig[];
  discountOptions?: DiscountOption[];
  businessEntities?: CodeLabelOption[];
  contractBases?: CodeLabelOption[];
  contractNames?: CodeLabelOption[];
  disabled?: boolean;
}) {
  const selectedType = types.find((t) => t.id === value.contractTypeId);

  const patch = (partial: Partial<IntakeFormValue>) =>
    onChange({ ...value, ...partial });

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Hàng 1 */}
        <div className="space-y-2">
          <Label>
            Chọn loại tài liệu
            <RequiredMark />
          </Label>
          <Select
            value={value.documentCategoryId}
            onValueChange={(v) => patch({ documentCategoryId: v })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Chọn loại tài liệu" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>
            Tên tài liệu
            <RequiredMark />
          </Label>
          <Input
            value={value.documentName}
            onChange={(e) => patch({ documentName: e.target.value })}
            placeholder="Tên tài liệu"
            disabled={disabled}
          />
        </div>

        {/* Hàng 2 */}
        <div className="space-y-2">
          <Label>Số tài liệu</Label>
          <Input
            value={value.documentNumber}
            onChange={(e) => patch({ documentNumber: e.target.value })}
            placeholder="Số tài liệu"
            disabled={disabled}
          />
        </div>

        <div className="space-y-2">
          <Label>Ngày ký</Label>
          <div className="relative">
            <Input
              type="date"
              value={value.signingDate}
              onChange={(e) => patch({ signingDate: e.target.value })}
              className="pr-10"
              disabled={disabled}
            />
            <Calendar className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>

        {/* Hàng 3 */}
        <div className="space-y-2">
          <Label>
            Loại hợp đồng (Contract type)
            <RequiredMark />
          </Label>
          <Select
            value={value.contractTypeId}
            onValueChange={(v) => patch({ contractTypeId: v })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Loại hợp đồng (Contract type)" />
            </SelectTrigger>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedType && !selectedType.hasChecklist && (
            <p className="flex items-start gap-1 text-xs text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Chưa có checklist chi tiết — AI review mang tính tham khảo.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>
            Tên hợp đồng (Contract name)
            <RequiredMark />
          </Label>
          <Select
            value={value.contractNameId}
            onValueChange={(v) => patch({ contractNameId: v })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Tên hợp đồng (Contract name)" />
            </SelectTrigger>
            <SelectContent>
              {contractNames.map((n) => (
                <SelectItem key={n.id} value={n.id}>
                  {n.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Hàng 4 */}
        <div className="space-y-2">
          <Label>
            Business Entity
            <RequiredMark />
          </Label>
          <Select
            value={value.businessEntityId}
            onValueChange={(v) => patch({ businessEntityId: v })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Business Entity" />
            </SelectTrigger>
            <SelectContent>
              {businessEntities.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>
            Contract base
            <RequiredMark />
          </Label>
          <Select
            value={value.contractBaseId}
            onValueChange={(v) => patch({ contractBaseId: v })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Contract base" />
            </SelectTrigger>
            <SelectContent>
              {contractBases.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>
            Hợp đồng có chiết khấu
            <RequiredMark />
          </Label>
          <Select
            value={value.hasDiscount}
            onValueChange={(v) => patch({ hasDiscount: v as DiscountFlag })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Hợp đồng có chiết khấu" />
            </SelectTrigger>
            <SelectContent>
              {discountOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Hàng 5 */}
        <div className="space-y-2">
          <Label>
            Chi tiết chiết khấu
            {value.hasDiscount === "yes" && <RequiredMark />}
          </Label>
          <Input
            value={value.discountDetails}
            onChange={(e) => patch({ discountDetails: e.target.value })}
            placeholder="Chi tiết chiết khấu"
            disabled={disabled || value.hasDiscount === "no"}
          />
        </div>

        <div className="space-y-2">
          <Label>
            Giá trị hợp đồng (Contract value)
            <RequiredMark />
          </Label>
          <Input
            value={value.contractValue}
            onChange={(e) => patch({ contractValue: e.target.value })}
            placeholder="Giá trị hợp đồng (Contract value)"
            inputMode="decimal"
            disabled={disabled}
          />
        </div>
      </div>
    </>
  );
}
