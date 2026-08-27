"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import AppLayout from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import type { ContractNameOption } from "@/lib/domain/form-lists";
import { getSession } from "@/lib/auth/session";
import {
  createQuickReview,
  listContractNames,
  listDocumentCategories,
} from "@/lib/services/reviews";
import { canAccessContractsList, canCreateContracts } from "@/lib/domain/roles";
import type { DocumentCategory } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { FileText, Loader2, Sparkles, Upload, X } from "lucide-react";

const DOCX_ACCEPT = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
};

export default function QuickReviewUploadPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [contractNames, setContractNames] = useState<ContractNameOption[]>([]);
  const [documentCategoryId, setDocumentCategoryId] = useState("");
  const [contractNameId, setContractNameId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const session = getSession();
    if (!canCreateContracts(session) && !canAccessContractsList(session)) {
      router.replace("/dashboard");
      return;
    }
    Promise.all([listDocumentCategories(), listContractNames()]).then(
      ([cats, names]) => {
        setCategories(cats);
        setContractNames(names);
      }
    );
  }, [router]);

  const filteredNames = useMemo(
    () =>
      documentCategoryId
        ? contractNames.filter(
            (n) =>
              n.documentCategoryId === documentCategoryId &&
              n.status !== "archived"
          )
        : [],
    [contractNames, documentCategoryId]
  );

  const onDrop = useCallback(
    (accepted: File[]) => {
      const docx = accepted.filter((f) =>
        f.name.toLowerCase().endsWith(".docx")
      );
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
          title: "Chỉ 1 file",
          description: "Đã lấy file .docx đầu tiên.",
        });
      }
      setFile(docx[0]);
    },
    [toast]
  );

  const dropzone = useDropzone({
    onDrop,
    multiple: false,
    maxFiles: 1,
    accept: DOCX_ACCEPT,
  });

  const formReady = Boolean(documentCategoryId && contractNameId && file);

  const handleStart = async () => {
    if (!documentCategoryId || !contractNameId) {
      toast({
        title: "Thiếu thông tin",
        description: "Chọn Loại hợp đồng và Tên hợp đồng.",
        variant: "destructive",
      });
      return;
    }
    if (!file) {
      toast({
        title: "Chưa có file",
        description: "Tải lên 1 hợp đồng .docx để bắt đầu review.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const review = await createQuickReview({
        file,
        documentCategoryId,
        contractNameId,
      });
      toast({
        title: "Đã gửi AI review",
        description: "Đang mở workspace chat + tài liệu.",
      });
      router.push(`/dashboard/review/${review.id}`);
    } catch (e) {
      toast({
        title: "Không tạo được review",
        description: e instanceof Error ? e.message : "Lỗi",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-sky-600" />
            Review hợp đồng
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Chỉ AI review — không Submit duyệt / eContract. Muốn trình ký hãy dùng
            Tạo tài liệu.
          </p>
        </div>

        <Card className="rounded-xl border-sky-200 bg-sky-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Tải hợp đồng</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sky-900">
                  Loại hợp đồng (Contract category){" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={documentCategoryId}
                  onValueChange={(v) => {
                    setDocumentCategoryId(v);
                    const keep = contractNames.some(
                      (n) => n.id === contractNameId && n.documentCategoryId === v
                    );
                    if (!keep) setContractNameId("");
                  }}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Chọn loại hợp đồng" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                        {c.code ? ` (${c.code})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sky-900">
                  Tên hợp đồng (Contract name){" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={contractNameId}
                  onValueChange={setContractNameId}
                  disabled={!documentCategoryId}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue
                      placeholder={
                        documentCategoryId
                          ? "Chọn tên hợp đồng"
                          : "Chọn loại hợp đồng trước"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredNames.map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        {n.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div
              {...dropzone.getRootProps()}
              className={cn(
                "rounded-xl border-2 border-dashed bg-white px-4 py-10 text-center cursor-pointer transition-colors",
                dropzone.isDragActive
                  ? "border-sky-500 bg-sky-50"
                  : "border-sky-200 hover:border-sky-400"
              )}
            >
              <input {...dropzone.getInputProps()} />
              <Upload className="mx-auto h-8 w-8 text-sky-600 mb-2" />
              <p className="text-sm font-medium text-sky-950">
                Kéo thả hoặc bấm để chọn file .docx
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Một file hợp đồng review
              </p>
            </div>

            {file && (
              <div className="flex items-center gap-3 rounded-xl border bg-white px-3 py-2.5 text-sm">
                <FileText className="h-4 w-4 text-sky-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => setFile(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}

            <Button
              className="w-full sm:w-auto"
              disabled={!formReady || submitting}
              onClick={handleStart}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Bắt đầu AI Review
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
