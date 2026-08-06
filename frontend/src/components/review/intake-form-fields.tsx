"use client";

import { useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CodeLabelOption,
  ContractNameOption,
  DiscountOption,
} from "@/lib/form-lists-store";
import { peekDocumentNumber } from "@/lib/document-number";
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
  contractNames: ContractNameOption[] = []
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

/** Định dạng tiền: giữ chữ số, ngăn cách hàng nghìn bằng dấu phẩy (vd 1,000,000). */
export function formatMoney(raw: string): string {
  const digits = String(raw).replace(/\D/g, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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
  /** true = preview số tiếp theo khi chọn Công ty + Loại HĐ (form tạo mới). */
  autoDocumentNumber = false,
}: {
  value: IntakeFormValue;
  onChange: (next: IntakeFormValue) => void;
  categories: DocumentCategory[];
  types: ContractTypeConfig[];
  discountOptions?: DiscountOption[];
  businessEntities?: CodeLabelOption[];
  contractBases?: CodeLabelOption[];
  contractNames?: ContractNameOption[];
  disabled?: boolean;
  autoDocumentNumber?: boolean;
}) {
  const selectedType = types.find((t) => t.id === value.contractTypeId);
  const filteredContractNames = value.documentCategoryId
    ? contractNames.filter(
        (n) => n.documentCategoryId === value.documentCategoryId
      )
    : [];

  const patch = (partial: Partial<IntakeFormValue>) =>
    onChange({ ...value, ...partial });

  useEffect(() => {
    if (!autoDocumentNumber || disabled) return;
    const entity = businessEntities.find((e) => e.id === value.businessEntityId);
    const category = categories.find((c) => c.id === value.documentCategoryId);
    const preview =
      entity && category
        ? peekDocumentNumber(entity.code, category.code)
        : "";
    if (preview !== value.documentNumber) {
      onChange({ ...value, documentNumber: preview });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ sync khi đổi Công ty / Loại HĐ / danh mục
  }, [
    autoDocumentNumber,
    disabled,
    value.businessEntityId,
    value.documentCategoryId,
    businessEntities,
    categories,
  ]);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Hàng 1: Loại hợp đồng + Tên hợp đồng */}
        <div className="space-y-2">
          <Label>
            Loại hợp đồng (Contract category)
            <RequiredMark />
          </Label>
          <Select
            value={value.documentCategoryId}
            onValueChange={(v) => {
              const keepName = contractNames.some(
                (n) =>
                  n.id === value.contractNameId && n.documentCategoryId === v
              );
              patch({
                documentCategoryId: v,
                contractNameId: keepName ? value.contractNameId : "",
              });
            }}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Loại hợp đồng (Contract category)" />
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
            Tên hợp đồng (Contract name)
            <RequiredMark />
          </Label>
          <Select
            value={value.contractNameId}
            onValueChange={(v) => patch({ contractNameId: v })}
            disabled={disabled || !value.documentCategoryId}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  value.documentCategoryId
                    ? "Tên hợp đồng (Contract name)"
                    : "Chọn loại hợp đồng (Contract category) trước"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {filteredContractNames.length === 0 ? (
                <SelectItem value="__empty" disabled>
                  Chưa có tên HĐ cho loại hợp đồng này
                </SelectItem>
              ) : (
                filteredContractNames.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.label}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Hàng 2: Công ty trước Tên tài liệu */}
        <div className="space-y-2">
          <Label>
            Công ty (Business Entity)
            <RequiredMark />
          </Label>
          <Select
            value={value.businessEntityId}
            onValueChange={(v) => patch({ businessEntityId: v })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Công ty (Business Entity)" />
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
            Tên tài liệu (Document name)
            <RequiredMark />
          </Label>
          <Input
            value={value.documentName}
            onChange={(e) => patch({ documentName: e.target.value })}
            placeholder="Tên tài liệu (Document name)"
            disabled={disabled}
          />
        </div>

        {/* Hàng 3 */}
        <div className="space-y-2">
          <Label>Số tài liệu (Document number)</Label>
          <Input
            value={value.documentNumber}
            readOnly
            placeholder="Chọn Công ty + Loại hợp đồng để sinh số"
            disabled={disabled}
            className="bg-muted/40"
          />
        </div>

        <div className="space-y-2">
          <Label>Ngày ký (Signing date)</Label>
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

        {/* Hàng 4 */}
        <div className="space-y-2">
          <Label htmlFor="intake-contract-value-type">
            Loại giá trị hợp đồng (Contract value type)
            <RequiredMark />
          </Label>
          <Select
            value={value.contractTypeId}
            onValueChange={(v) => patch({ contractTypeId: v })}
            disabled={disabled}
          >
            <SelectTrigger id="intake-contract-value-type">
              <SelectValue placeholder="Loại giá trị hợp đồng (Contract value type)" />
            </SelectTrigger>
            <SelectContent>
              {types.length === 0 ? (
                <SelectItem value="__empty_types" disabled>
                  Chưa có dữ liệu — cấu hình ở Form lists
                </SelectItem>
              ) : (
                types.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))
              )}
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
            Hợp đồng tiêu chuẩn (Standard contract)
            <RequiredMark />
          </Label>
          <Select
            value={value.contractBaseId}
            onValueChange={(v) => patch({ contractBaseId: v })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Hợp đồng tiêu chuẩn (Standard contract)" />
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
            Hợp đồng có chiết khấu (Has discount)
            <RequiredMark />
          </Label>
          <Select
            value={value.hasDiscount}
            onValueChange={(v) => patch({ hasDiscount: v as DiscountFlag })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Hợp đồng có chiết khấu (Has discount)" />
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
            Chi tiết chiết khấu (Discount details)
            {value.hasDiscount === "yes" && <RequiredMark />}
          </Label>
          <Input
            value={value.discountDetails}
            onChange={(e) => patch({ discountDetails: e.target.value })}
            placeholder="Chi tiết chiết khấu (Discount details)"
            disabled={disabled || value.hasDiscount === "no"}
          />
        </div>

        <div className="space-y-2">
          <Label>
            Giá trị hợp đồng (Contract value)
            <RequiredMark />
          </Label>
          <Input
            value={formatMoney(value.contractValue)}
            onChange={(e) => patch({ contractValue: formatMoney(e.target.value) })}
            placeholder="Giá trị hợp đồng (Contract value)"
            inputMode="numeric"
            disabled={disabled}
          />
        </div>
      </div>
    </>
  );
}
