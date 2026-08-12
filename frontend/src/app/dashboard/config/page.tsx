"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  countReviewsUsingContractType,
  deleteChildContractType,
  ensureConfigForContractName,
  ensureConfigForParentCategory,
  getConfigPermission,
  listConfigVersions,
  listFormListContractNames,
  listMatrices,
  listParentCategories,
  mergeParentAndChildConfig,
  pickChildLineConfig,
} from "@/lib/config-service";
import type {
  ApprovalMatrixConfig,
  ContractParentCategory,
  ContractTypeConfigVersion,
} from "@/lib/config-types";
import type { ContractNameOption } from "@/lib/form-lists-store";
import { getSession } from "@/lib/review-service";
import { canAccessConfig } from "@/lib/roles";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";

type ConfirmAction = {
  mode: "delete";
  typeId: string;
  label: string;
  usage: number;
};

export default function ConfigListPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [configs, setConfigs] = useState<ContractTypeConfigVersion[]>([]);
  const [parents, setParents] = useState<ContractParentCategory[]>([]);
  const [contractNames, setContractNames] = useState<ContractNameOption[]>([]);
  const [matrices, setMatrices] = useState<ApprovalMatrixConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [busyTypeId, setBusyTypeId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  /** Tên HĐ đang chọn để thêm overlay — theo parent.id */
  const [pickByParent, setPickByParent] = useState<Record<string, string>>({});
  const perm = getConfigPermission();

  const reload = () =>
    Promise.all([
      listConfigVersions(),
      listMatrices(),
      listParentCategories(),
      listFormListContractNames(),
    ]).then(([c, m, p, names]) => {
      setConfigs(c);
      setMatrices(m);
      setParents(p);
      setContractNames(names);
    });

  useEffect(() => {
    const session = getSession();
    if (session && !canAccessConfig(session)) {
      toast({ title: "Không có quyền xem cấu hình", variant: "destructive" });
      router.push("/dashboard");
      return;
    }
    reload()
      .catch((e) =>
        toast({
          title: "Lỗi tải cấu hình",
          description: e instanceof Error ? e.message : "Lỗi",
          variant: "destructive",
        })
      )
      .finally(() => setLoading(false));
  }, [router, toast]);

  /**
   * Chỉ hiện tên HĐ đã có overlay. Tên chưa cấu hình riêng không nằm trong bảng
   * nhưng vẫn hưởng checklist loại cha khi AI review.
   */
  const byParent = useMemo(() => {
    return parents.map((parent) => {
      const parentVersions = configs.filter((c) => c.contractTypeId === parent.id);
      const parentConfig = pickChildLineConfig(parentVersions);

      const allNames = contractNames
        .filter((n) => n.documentCategoryId === parent.id)
        .sort((a, b) => a.label.localeCompare(b.label, "vi"));

      const configured = allNames
        .map((name) => {
          const versions = configs.filter((c) => c.contractTypeId === name.id);
          const config = pickChildLineConfig(versions);
          if (!config) return null;
          const merged = mergeParentAndChildConfig(parentConfig, config);
          return {
            typeId: name.id,
            name,
            config,
            usage: countReviewsUsingContractType(name.id),
            merged,
          };
        })
        .filter((x): x is NonNullable<typeof x> => !!x);

      const availableToAdd = allNames.filter(
        (n) => !configured.some((c) => c.typeId === n.id)
      );

      return {
        parent,
        parentConfig,
        allNamesCount: allNames.length,
        lines: configured,
        availableToAdd,
      };
    });
  }, [configs, parents, contractNames]);

  const matrixName = (id: string | null | undefined) => {
    if (!id) return "Global mặc định";
    return matrices.find((m) => m.id === id)?.name || id;
  };

  const openConfirm = (typeId: string, label: string) => {
    setConfirm({
      mode: "delete",
      typeId,
      label,
      usage: countReviewsUsingContractType(typeId),
    });
  };

  const handleOpenParentConfig = async (categoryId: string) => {
    setOpeningId(`parent:${categoryId}`);
    try {
      const cfg = await ensureConfigForParentCategory(categoryId);
      router.push(`/dashboard/config/${cfg.id}`);
    } catch (e) {
      toast({
        title: "Không mở được cấu hình loại cha",
        description: e instanceof Error ? e.message : "Lỗi",
        variant: "destructive",
      });
    } finally {
      setOpeningId(null);
    }
  };

  const handleOpenChildConfig = async (typeId: string) => {
    setOpeningId(typeId);
    try {
      const cfg = await ensureConfigForContractName(typeId);
      router.push(`/dashboard/config/${cfg.id}`);
    } catch (e) {
      toast({
        title: "Không mở được cấu hình riêng",
        description: e instanceof Error ? e.message : "Lỗi",
        variant: "destructive",
      });
    } finally {
      setOpeningId(null);
    }
  };

  const handleAddChildConfig = async (parentId: string) => {
    const typeId = pickByParent[parentId];
    if (!typeId) {
      toast({
        title: "Chọn tên hợp đồng",
        description: "Chọn tên HĐ cần thêm cấu hình riêng.",
        variant: "destructive",
      });
      return;
    }
    await handleOpenChildConfig(typeId);
  };

  const handleConfirmAction = async () => {
    if (!confirm) return;
    setBusyTypeId(confirm.typeId);
    try {
      await deleteChildContractType(confirm.typeId);
      toast({
        title: "Đã xóa checklist riêng",
        description: `${confirm.label} — vẫn kế thừa checklist loại cha; không còn hiện trong danh sách.`,
      });
      setConfirm(null);
      await reload();
    } catch (e) {
      toast({
        title: "Không thực hiện được",
        description: e instanceof Error ? e.message : "Lỗi",
        variant: "destructive",
      });
    } finally {
      setBusyTypeId(null);
    }
  };

  return (
    <AppLayout>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Cấu hình theo loại hợp đồng</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Cấu hình chính ở <strong>loại cha</strong> — mọi tên HĐ con được hưởng.
            Chỉ hiện tên HĐ đã chọn cấu hình riêng (overlay); tên chưa cấu hình
            không nằm trong danh sách nhưng vẫn dùng checklist cha.
          </p>
        </div>
        <Button size="sm" variant="outline" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            Quay lại
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Đang tải...
        </div>
      ) : (
        <div className="space-y-4">
          {byParent.map(
            ({
              parent,
              parentConfig,
              allNamesCount,
              lines,
              availableToAdd,
            }) => (
              <Card key={parent.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">
                        {parent.label}
                      </CardTitle>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        size="sm"
                        disabled={openingId === `parent:${parent.id}`}
                        onClick={() => handleOpenParentConfig(parent.id)}
                      >
                        {openingId === `parent:${parent.id}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <Settings2 className="h-3.5 w-3.5 mr-1" />
                        )}
                        Cấu hình
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {perm.canEditDraft && availableToAdd.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                      <span className="text-xs text-muted-foreground shrink-0">
                        Thêm cấu hình riêng cho
                      </span>
                      <Select
                        value={pickByParent[parent.id] || undefined}
                        onValueChange={(v) =>
                          setPickByParent((prev) => ({
                            ...prev,
                            [parent.id]: v,
                          }))
                        }
                      >
                        <SelectTrigger className="h-9 w-[240px] bg-background">
                          <SelectValue placeholder="Chọn tên hợp đồng…" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableToAdd.map((n) => (
                            <SelectItem key={n.id} value={n.id}>
                              {n.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={
                          !pickByParent[parent.id] ||
                          openingId === pickByParent[parent.id]
                        }
                        onClick={() => handleAddChildConfig(parent.id)}
                      >
                        {openingId === pickByParent[parent.id] ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <Plus className="h-3.5 w-3.5 mr-1" />
                        )}
                        Thêm
                      </Button>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground text-xs">
                          <th className="py-2 pr-3 font-medium">
                            Tên hợp đồng
                          </th>
                          <th className="py-2 pr-3 font-medium">
                            AI gộp (cha+con)
                          </th>
                          <th className="py-2 pr-3 font-medium">
                            Approval Matrix
                          </th>
                          <th className="py-2 pr-3 font-medium">AI tiers</th>
                          <th className="py-2 pr-3 font-medium">Template</th>
                          <th className="py-2 font-medium">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.length === 0 ? (
                          <tr>
                            <td
                              colSpan={6}
                              className="py-6 text-center text-muted-foreground text-sm"
                            >
                              {allNamesCount === 0 ? (
                                <>
                                  Chưa có Tên hợp đồng trên Form lists — thêm tại{" "}
                                  <Link
                                    href="/dashboard/configurations"
                                    className="underline font-medium text-foreground"
                                  >
                                    Form lists
                                  </Link>
                                  .
                                </>
                              ) : (
                                <>
                                  Chưa có tên HĐ cấu hình riêng. Các tên vẫn hưởng
                                  checklist loại cha — chọn tên ở trên rồi bấm
                                  Thêm nếu cần overlay.
                                </>
                              )}
                            </td>
                          </tr>
                        ) : (
                          lines.map(
                            ({ typeId, name, config, usage, merged }) => (
                              <tr
                                key={typeId}
                                className="border-b last:border-0"
                              >
                                <td className="py-2.5 pr-3 font-medium text-foreground">
                                  {name.label}
                                </td>
                                <td className="py-2.5 pr-3 font-medium">
                                  {merged.clauses.length}
                                </td>
                                <td className="py-2.5 pr-3 max-w-[200px] truncate">
                                  {matrixName(merged.approvalMatrixId)}
                                </td>
                                <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                                  {merged.aiTiers.ruleBasedEnabled
                                    ? "rule"
                                    : "—"}
                                  {merged.aiTiers.semanticEnabled
                                    ? " + semantic"
                                    : ""}
                                </td>
                                <td className="py-2.5 pr-3">
                                  <Badge
                                    variant="outline"
                                    className="text-[11px]"
                                  >
                                    {merged.requireTemplateMatch
                                      ? "Bắt buộc"
                                      : "Không"}
                                  </Badge>
                                </td>
                                <td className="py-2.5">
                                  <div className="flex flex-wrap items-center gap-1">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      disabled={openingId === typeId}
                                      onClick={() =>
                                        handleOpenChildConfig(typeId)
                                      }
                                    >
                                      {openingId === typeId ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                                      ) : (
                                        <Settings2 className="h-3.5 w-3.5 mr-1" />
                                      )}
                                      Cấu hình
                                    </Button>
                                    {perm.canEditDraft && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="text-destructive hover:text-destructive"
                                        disabled={
                                          busyTypeId === typeId ||
                                          usage > 0 ||
                                          !config
                                        }
                                        onClick={() =>
                                          openConfirm(typeId, name.label)
                                        }
                                        title={
                                          usage > 0
                                            ? `Không xóa được — đang dùng bởi ${usage} HĐ`
                                            : "Xóa overlay — tên biến mất khỏi danh sách, vẫn kế thừa cha"
                                        }
                                      >
                                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                                        Xóa
                                      </Button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )
          )}
        </div>
      )}

      <Dialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open && !busyTypeId) setConfirm(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Xóa checklist riêng</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Tên:{" "}
                  <span className="font-medium text-foreground">
                    {confirm?.label}
                  </span>
                </p>
                <p>
                  Xóa overlay — tên không còn trong danh sách này. Checklist loại
                  cha vẫn áp dụng khi AI review.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={!!busyTypeId}
              onClick={() => setConfirm(null)}
            >
              Huỷ
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!!busyTypeId}
              onClick={handleConfirmAction}
            >
              {busyTypeId ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 mr-1" />
              )}
              Xóa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
