"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import {
  createChildContractType,
  getConfigPermission,
  listConfigVersions,
  listMatrices,
  pickChildLineConfig,
} from "@/lib/config-service";
import {
  CONTRACT_PARENT_CATEGORIES,
  type ApprovalMatrixConfig,
  type ContractTypeConfigVersion,
} from "@/lib/config-types";
import { getSession } from "@/lib/review-service";
import { canAccessConfig } from "@/lib/roles";
import { Loader2, Plus, Settings2 } from "lucide-react";

export default function ConfigListPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [configs, setConfigs] = useState<ContractTypeConfigVersion[]>([]);
  const [matrices, setMatrices] = useState<ApprovalMatrixConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingParentId, setAddingParentId] = useState<string | null>(null);
  const [newChildLabel, setNewChildLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const perm = getConfigPermission();

  const reload = () =>
    Promise.all([listConfigVersions(), listMatrices()]).then(([c, m]) => {
      setConfigs(c);
      setMatrices(m);
    });

  useEffect(() => {
    const session = getSession();
    if (session && !canAccessConfig(session.role)) {
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

  /** Parent → unique child types (1 line / contractTypeId). */
  const byParent = useMemo(() => {
    return CONTRACT_PARENT_CATEGORIES.map((parent) => {
      const under = configs.filter(
        (c) =>
          c.parentCategoryId === parent.id ||
          (!c.parentCategoryId &&
            ((parent.id === "purchase" && c.group === "framework") ||
              (parent.id === "vendor" && c.group === "vendor")))
      );
      const byType = new Map<string, ContractTypeConfigVersion[]>();
      for (const c of under) {
        const arr = byType.get(c.contractTypeId) || [];
        arr.push(c);
        byType.set(c.contractTypeId, arr);
      }
      const lines = Array.from(byType.entries())
        .map(([typeId, versions]) => ({
          typeId,
          config: pickChildLineConfig(versions)!,
        }))
        .filter((x) => x.config)
        .sort((a, b) => a.config.label.localeCompare(b.config.label, "vi"));
      return { parent, lines };
    });
  }, [configs]);

  const matrixName = (id: string | null) => {
    if (!id) return "Global mặc định";
    return matrices.find((m) => m.id === id)?.name || id;
  };

  const handleAddChild = async (parentId: string) => {
    if (!perm.canEditDraft) {
      toast({ title: "Không có quyền tạo loại con", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const child = await createChildContractType(parentId, newChildLabel);
      toast({ title: "Đã thêm loại con", description: child.label });
      setNewChildLabel("");
      setAddingParentId(null);
      await reload();
      router.push(`/dashboard/config/${child.id}`);
    } catch (e) {
      toast({
        title: "Không tạo được loại con",
        description: e instanceof Error ? e.message : "Lỗi",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <AppLayout>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Cấu hình theo loại hợp đồng</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Mỗi loại hợp đồng cha có nhiều loại con (line). Checklist · Approval Matrix ·
            Ideal/Fallback/Red Line theo từng điều khoản · phân quyền cấu hình riêng.
          </p>
        </div>
        <div className="text-xs text-muted-foreground rounded-md border px-3 py-2 bg-muted/30">
          Quyền hiện tại:{" "}
          <span className="font-medium text-foreground">
            {perm.canEditDraft ? "thêm/sửa loại con" : "không sửa"}
            {perm.canPublish ? " · Publish" : " · không Publish"}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Đang tải...
        </div>
      ) : (
        <div className="space-y-4">
          {byParent.map(({ parent, lines }) => (
            <Card key={parent.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{parent.label}</CardTitle>
                    <CardDescription>
                      {lines.length} loại con
                      {parent.description ? ` · ${parent.description}` : ""}
                    </CardDescription>
                  </div>
                  {perm.canEditDraft && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAddingParentId(
                          addingParentId === parent.id ? null : parent.id
                        );
                        setNewChildLabel("");
                      }}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Thêm loại con
                    </Button>
                  )}
                </div>
                {addingParentId === parent.id && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md border bg-muted/20 p-3">
                    <div className="space-y-1.5 flex-1 min-w-[200px]">
                      <Label htmlFor={`child-${parent.id}`}>
                        Tên loại hợp đồng con
                      </Label>
                      <Input
                        id={`child-${parent.id}`}
                        value={newChildLabel}
                        onChange={(e) => setNewChildLabel(e.target.value)}
                        placeholder="VD: Hợp đồng khung vật tư"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAddChild(parent.id);
                        }}
                      />
                    </div>
                    <Button
                      size="sm"
                      disabled={creating || !newChildLabel.trim()}
                      onClick={() => handleAddChild(parent.id)}
                    >
                      {creating ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      ) : (
                        <Plus className="h-3.5 w-3.5 mr-1" />
                      )}
                      Tạo
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={creating}
                      onClick={() => setAddingParentId(null)}
                    >
                      Huỷ
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground text-xs">
                        <th className="py-2 pr-3 font-medium">Loại con</th>
                        <th className="py-2 pr-3 font-medium">Clauses</th>
                        <th className="py-2 pr-3 font-medium">Approval Matrix</th>
                        <th className="py-2 pr-3 font-medium">AI tiers</th>
                        <th className="py-2 pr-3 font-medium">Test preview</th>
                        <th className="py-2 pr-3 font-medium">Template</th>
                        <th className="py-2 font-medium">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.length === 0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="py-6 text-center text-muted-foreground text-sm"
                          >
                            Chưa có loại con — bấm Thêm loại con để tạo line mới.
                          </td>
                        </tr>
                      ) : (
                        lines.map(({ typeId, config: v }) => (
                          <tr key={typeId} className="border-b last:border-0">
                            <td className="py-2.5 pr-3">
                              <div className="font-medium">{v.label}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {typeId}
                              </div>
                            </td>
                            <td className="py-2.5 pr-3">{v.clauses.length}</td>
                            <td className="py-2.5 pr-3 max-w-[200px] truncate">
                              {matrixName(v.approvalMatrixId)}
                            </td>
                            <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                              {v.aiTiers.ruleBasedEnabled ? "rule" : "—"}
                              {v.aiTiers.semanticEnabled ? " + semantic" : ""}
                            </td>
                            <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                              {v.lastTestPreview?.summary || "—"}
                            </td>
                            <td className="py-2.5 pr-3">
                              <Badge variant="outline" className="text-[11px]">
                                {v.requireTemplateMatch ? "Bắt buộc" : "Không"}
                              </Badge>
                            </td>
                            <td className="py-2.5">
                              <Button size="sm" variant="ghost" asChild>
                                <Link href={`/dashboard/config/${v.id}`}>
                                  <Settings2 className="h-3.5 w-3.5 mr-1" />
                                  Mở
                                </Link>
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
