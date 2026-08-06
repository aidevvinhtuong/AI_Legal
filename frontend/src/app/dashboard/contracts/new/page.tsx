"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import AppLayout from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import {
  IntakeFormFields,
  buildIntakeMeta,
  isIntakeFormValid,
  type IntakeFormValue,
} from "@/components/review/intake-form-fields";
import type {
  CodeLabelOption,
  ContractNameOption,
  DiscountOption,
} from "@/lib/form-lists-store";
import {
  createReview,
  listBusinessEntities,
  listContractBases,
  listContractNames,
  listContractTypes,
  listDiscountOptions,
  listDocumentCategories,
} from "@/lib/review-service";
import type { ContractTypeConfig, DocumentCategory } from "@/lib/types";
import { FileText, Loader2, Sparkles, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";

const EMPTY_INTAKE: IntakeFormValue = {
  documentCategoryId: "",
  documentName: "",
  documentNumber: "",
  signingDate: "",
  contractTypeId: "",
  contractNameId: "",
  businessEntityId: "",
  contractBaseId: "",
  hasDiscount: "",
  discountDetails: "",
  contractValue: "",
  prompt: "",
};

const DOCX_ACCEPT = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
};

function filterDocx(accepted: File[]) {
  return accepted.filter((f) => f.name.toLowerCase().endsWith(".docx"));
}

function FileList({
  files,
  onRemove,
}: {
  files: File[];
  onRemove: (index: number) => void;
}) {
  if (!files.length) return null;
  return (
    <ul className="mt-3 space-y-2">
      {files.map((f, i) => (
        <li
          key={`${f.name}-${f.size}-${i}`}
          className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-sm"
        >
          <FileText className="h-4 w-4 text-sky-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{f.name}</p>
            <p className="text-xs text-muted-foreground">
              {(f.size / 1024).toFixed(1)} KB
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(i)}
          >
            <X className="h-4 w-4" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

export default function NewReviewPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [types, setTypes] = useState<ContractTypeConfig[]>([]);
  const [discountOptions, setDiscountOptions] = useState<DiscountOption[]>([]);
  const [businessEntities, setBusinessEntities] = useState<CodeLabelOption[]>(
    []
  );
  const [contractBases, setContractBases] = useState<CodeLabelOption[]>([]);
  const [contractNames, setContractNames] = useState<ContractNameOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [intakeForm, setIntakeForm] = useState<IntakeFormValue>(EMPTY_INTAKE);
  const [reviewFile, setReviewFile] = useState<File | null>(null);

  useEffect(() => {
    Promise.all([
      listDocumentCategories(),
      listContractTypes(),
      listDiscountOptions(),
      listBusinessEntities(),
      listContractBases(),
      listContractNames(),
    ]).then(([cats, t, discounts, entities, bases, names]) => {
      setCategories(cats);
      setTypes(t);
      setDiscountOptions(discounts);
      setBusinessEntities(entities);
      setContractBases(bases);
      setContractNames(names);
      if (cats[0]) {
        setIntakeForm((prev) => ({
          ...prev,
          documentCategoryId: cats[0].id,
        }));
      }
    });
  }, []);

  const onDropReview = useCallback(
    (accepted: File[]) => {
      const docx = filterDocx(accepted);
      if (accepted.length && !docx.length) {
        toast({
          title: "File bị bỏ qua",
          description: "Chỉ nhận định dạng .docx",
          variant: "destructive",
        });
        return;
      }
      if (!docx.length) return;
      if (docx.length > 1) {
        toast({
          title: "Chỉ 1 file review",
          description: "Hợp đồng review chỉ nhận một file .docx. Đã lấy file đầu tiên.",
        });
      }
      const file = docx[0];
      setReviewFile(file);
      setIntakeForm((prev) => {
        if (prev.documentName) return prev;
        return {
          ...prev,
          documentName: file.name.replace(/\.docx$/i, ""),
        };
      });
    },
    [toast]
  );

  const reviewDropzone = useDropzone({
    onDrop: onDropReview,
    multiple: false,
    maxFiles: 1,
    accept: DOCX_ACCEPT,
  });

  const formValid = useMemo(
    () => isIntakeFormValid(intakeForm, true, reviewFile ? 1 : 0),
    [intakeForm, reviewFile]
  );

  const handleSubmit = async () => {
    if (!formValid || !reviewFile) {
      toast({
        title: "Thiếu thông tin",
        description:
          "Điền đủ trường bắt buộc và tải lên 1 file Hợp đồng review (.docx).",
        variant: "destructive",
      });
      return;
    }

    const intake = buildIntakeMeta(
      intakeForm,
      categories,
      businessEntities,
      contractBases,
      contractNames
    );
    if (!intake) {
      toast({
        title: "Loại hợp đồng (Contract category) không hợp lệ",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const review = await createReview({
        contractTypeId: intakeForm.contractTypeId,
        title: intakeForm.documentName.trim(),
        prompt: intakeForm.prompt,
        files: [reviewFile],
        intake,
      });
      toast({
        title: "Đã tạo tài liệu",
        description: "File đã vào Processing Queue.",
      });
      router.push(`/dashboard/contracts/${review.id}`);
    } catch (err) {
      toast({
        title: "Không thể tạo",
        description: err instanceof Error ? err.message : "Lỗi",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Tạo tài liệu</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Nhập thông tin hợp đồng, tải file review rồi gửi AI review.
            </p>
          </div>
          <Button variant="outline" onClick={() => router.push("/dashboard")}>
            Quay lại
          </Button>
        </div>

        <Card className="rounded-xl border-sky-200 bg-sky-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Thông tin tài liệu</CardTitle>
            <p className="text-sm text-muted-foreground">
              Các trường đánh dấu * là bắt buộc. Tải Hợp đồng review (1 file) bên dưới
              trước khi gửi.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <IntakeFormFields
              value={intakeForm}
              onChange={setIntakeForm}
              categories={categories}
              types={types}
              discountOptions={discountOptions}
              businessEntities={businessEntities}
              contractBases={contractBases}
              contractNames={contractNames}
              autoDocumentNumber
            />

            <div className="space-y-2">
              <Label className="text-sky-800">
                Hợp đồng review
                <span className="text-destructive ml-0.5">*</span>
              </Label>
              <p className="text-xs text-sky-700/70">
                Chỉ 1 file .docx — tài liệu chính để AI review.
              </p>
              <div
                {...reviewDropzone.getRootProps()}
                className={cn(
                  "border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors min-h-[140px] flex items-center justify-center",
                  reviewDropzone.isDragActive
                    ? "border-sky-600 bg-sky-100 ring-2 ring-sky-200"
                    : "border-sky-300 bg-sky-50 hover:border-sky-500 hover:bg-sky-100/80"
                )}
              >
                <input {...reviewDropzone.getInputProps()} />
                <div className="flex flex-col items-center gap-2 text-sky-700/80">
                  <Upload className="h-8 w-8 text-sky-600" />
                  <p className="text-sm font-medium text-sky-900">
                    Kéo thả hoặc bấm để chọn
                  </p>
                  <p className="text-xs text-sky-700/70">Tối đa 1 file .docx</p>
                </div>
              </div>
              <FileList
                files={reviewFile ? [reviewFile] : []}
                onRemove={() => setReviewFile(null)}
              />
            </div>

            <div className="flex justify-end pt-2 border-t border-sky-100">
              <Button
                className="bg-sky-600 hover:bg-sky-700"
                disabled={submitting || !formValid}
                onClick={handleSubmit}
              >
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Sparkles className="mr-2 h-4 w-4" />
                Submit + AI review
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
