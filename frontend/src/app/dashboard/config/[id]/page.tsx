"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AppLayout from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import type {
  ApprovalMatrixConfig,
  ChecklistClause,
  ConfigAuditEntry,
  ContractTypeConfigVersion,
} from "@/lib/config-types";
import { isClausePlaybookIncomplete } from "@/lib/config-types";
import {
  clauseKindLabel,
  getConfigPermission,
  getConfigVersion,
  linkMatrix,
  listConfigAudit,
  listMatrices,
  removeClause,
  saveConfigDraft,
  severityLabel,
  upsertClause,
} from "@/lib/config-service";
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  FileText,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { format } from "date-fns";

const emptyClause = (): ChecklistClause => ({
  id: `c_${Date.now()}`,
  code: "",
  name: "",
  kind: "required",
  severity: "warn_high",
  standardText: "",
  fallback: "",
  redLine: "",
  rationale: "",
  approvalLevelOnFallbackBreach: "",
  keywords: [],
  patterns: [],
  enableRuleBased: true,
  enableSemantic: true,
  sortOrder: 99,
  active: true,
});

export default function ConfigDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const perm = getConfigPermission();

  const [config, setConfig] = useState<ContractTypeConfigVersion | null>(null);
  const [matrices, setMatrices] = useState<ApprovalMatrixConfig[]>([]);
  const [audit, setAudit] = useState<ConfigAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clauseOpen, setClauseOpen] = useState(false);
  const [editing, setEditing] = useState<ChecklistClause | null>(null);
  const [isNewClause, setIsNewClause] = useState(false);

  const refresh = useCallback(async () => {
    const [c, m, a] = await Promise.all([
      getConfigVersion(params.id),
      listMatrices(),
      listConfigAudit(),
    ]);
    setConfig(c);
    setMatrices(m);
    setAudit(a.filter((x) => x.contractTypeId === c.contractTypeId));
  }, [params.id]);

  useEffect(() => {
    refresh()
      .catch((e) => {
        toast({
          title: "Không tải được",
          description: e instanceof Error ? e.message : "Lỗi",
          variant: "destructive",
        });
        router.push("/dashboard/config");
      })
      .finally(() => setLoading(false));
  }, [refresh, router, toast]);

  const canEdit =
    !!perm.canEditDraft && config?.lifecycle !== "archived";

  const openNewClause = () => {
    setEditing(emptyClause());
    setIsNewClause(true);
    setClauseOpen(true);
  };

  const openEditClause = (c: ChecklistClause) => {
    setEditing({ ...c, keywords: [...c.keywords], patterns: [...c.patterns] });
    setIsNewClause(false);
    setClauseOpen(true);
  };

  const handleSaveClause = async () => {
    if (!editing || !config) return;
    if (!editing.code.trim() || !editing.name.trim()) {
      toast({ title: "Thiếu mã / tên điều khoản", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const updated = await upsertClause(config.id, editing, isNewClause);
      setConfig(updated);
      setClauseOpen(false);
      toast({ title: isNewClause ? "Đã thêm điều khoản" : "Đã cập nhật điều khoản" });
      setAudit(await listConfigAudit(config.contractTypeId));
    } catch (e) {
      toast({
        title: "Lỗi",
        description: e instanceof Error ? e.message : "Lỗi",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClause = async (clauseId: string) => {
    if (!config || !canEdit) return;
    setSaving(true);
    try {
      setConfig(await removeClause(config.id, clauseId));
      setAudit(await listConfigAudit(config.contractTypeId));
      toast({ title: "Đã xoá điều khoản" });
    } catch (e) {
      toast({
        title: "Lỗi",
        description: e instanceof Error ? e.message : "Lỗi",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMeta = async () => {
    if (!config || !canEdit) return;
    setSaving(true);
    try {
      setConfig(await saveConfigDraft(config));
      toast({ title: "Đã lưu" });
    } catch (e) {
      toast({
        title: "Lỗi",
        description: e instanceof Error ? e.message : "Lỗi",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleLinkMatrix = async (matrixId: string) => {
    if (!config || !canEdit) return;
    const value = matrixId === "__global__" ? null : matrixId;
    try {
      setConfig(await linkMatrix(config.id, value));
      setAudit(await listConfigAudit(config.contractTypeId));
      toast({ title: "Đã gắn Approval Matrix" });
    } catch (e) {
      toast({
        title: "Lỗi",
        description: e instanceof Error ? e.message : "Lỗi",
        variant: "destructive",
      });
    }
  };

  if (loading || !config) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Đang tải...
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Button variant="ghost" size="sm" className="mb-2 -ml-2" asChild>
              <Link href="/dashboard/config">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Danh sách cấu hình
              </Link>
            </Button>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold">{config.label}</h1>
              <span className="text-sm text-muted-foreground">v{config.version}</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {config.contractTypeId} · cập nhật bởi {config.updatedBy}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Button onClick={handleSaveMeta} disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                Lưu
              </Button>
            )}
          </div>
        </div>

        <Tabs defaultValue="clauses">
          <TabsList>
            <TabsTrigger value="meta">Thông tin & Matrix</TabsTrigger>
            <TabsTrigger value="clauses">Checklist điều khoản</TabsTrigger>
            <TabsTrigger value="ai">AI 2 tầng</TabsTrigger>
            <TabsTrigger value="template">Template Contract</TabsTrigger>
            <TabsTrigger value="audit">Audit cấu hình</TabsTrigger>
          </TabsList>

          <TabsContent value="meta" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Template & cờ loại HĐ</CardTitle>
              </CardHeader>
              <CardContent className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tên hiển thị</Label>
                  <Input
                    value={config.label}
                    disabled={!canEdit}
                    onChange={(e) => setConfig({ ...config, label: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Approval Matrix áp dụng</Label>
                  <Select
                    value={config.approvalMatrixId || "__global__"}
                    disabled={!canEdit}
                    onValueChange={handleLinkMatrix}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__global__">
                        Global mặc định (toàn hệ thống)
                      </SelectItem>
                      {matrices.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name} ({m.lifecycle})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Matrix có thể global hoặc gắn theo loại HĐ. Sprint 1 chỉ dùng tính % tin cậy /
                    cảnh báo — không routing nhiều cấp.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="clauses" className="mt-4">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">
                    Checklist ({config.clauses.length})
                  </CardTitle>
                  <CardDescription>
                    Mã · loại · severity · Ideal / Fallback / Red Line · keywords · Content Control
                  </CardDescription>
                </div>
                {canEdit && (
                  <Button size="sm" onClick={openNewClause}>
                    <Plus className="h-4 w-4 mr-1" />
                    Thêm điều khoản
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {config.clauses.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Chưa có điều khoản — AI sẽ chỉ dùng lớp ngữ nghĩa chung (tham khảo).
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[1100px]">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="py-2 pr-2">Mã</th>
                          <th className="py-2 pr-2">Tên</th>
                          <th className="py-2 pr-2">Loại</th>
                          <th className="py-2 pr-2">Severity</th>
                          <th className="py-2 pr-2">Rule / Semantic</th>
                          <th className="py-2 pr-2">Field CC</th>
                          <th className="py-2 pr-2">Điều kiện</th>
                          <th className="py-2">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {config.clauses
                          .slice()
                          .sort((a, b) => a.sortOrder - b.sortOrder)
                          .map((c) => (
                            <tr key={c.id} className="border-b last:border-0 align-top">
                              <td className="py-2.5 pr-2 font-mono text-xs">{c.code}</td>
                              <td className="py-2.5 pr-2 max-w-[220px]">
                                <div className="font-medium">{c.name}</div>
                                <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                                  {c.standardText}
                                </div>
                                {isClausePlaybookIncomplete(c) && (
                                  <Badge className="mt-1.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-100 gap-1 text-[10px]">
                                    <AlertTriangle className="h-3 w-3" />
                                    Chưa cấu hình Ideal/Fallback/Red Line
                                  </Badge>
                                )}
                              </td>
                              <td className="py-2.5 pr-2">
                                <Badge variant="outline">{clauseKindLabel(c.kind)}</Badge>
                              </td>
                              <td className="py-2.5 pr-2 text-xs">{severityLabel(c.severity)}</td>
                              <td className="py-2.5 pr-2 text-xs text-muted-foreground">
                                {c.enableRuleBased ? "RB" : "—"} /{" "}
                                {c.enableSemantic ? "SEM" : "—"}
                              </td>
                              <td className="py-2.5 pr-2 font-mono text-xs">
                                {c.contentControlId || "—"}
                              </td>
                              <td className="py-2.5 pr-2 text-xs text-muted-foreground max-w-[160px]">
                                {c.condition?.note ||
                                  (c.condition?.minContractValue
                                    ? `≥ ${c.condition.minContractValue}`
                                    : c.condition?.partnerType || "—")}
                              </td>
                              <td className="py-2.5 whitespace-nowrap">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => openEditClause(c)}
                                >
                                  {canEdit ? "Sửa" : "Xem"}
                                </Button>
                                {canEdit && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive"
                                    onClick={() => handleDeleteClause(c.id)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ai" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cơ chế AI dùng checklist</CardTitle>
                <CardDescription>
                  Tách rõ 2 tầng để debug khi review sai / bỏ sót
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium text-sm">Tầng 1 — Rule-based</h4>
                      <Select
                        value={config.aiTiers.ruleBasedEnabled ? "on" : "off"}
                        disabled={!canEdit}
                        onValueChange={(v) =>
                          setConfig({
                            ...config,
                            aiTiers: {
                              ...config.aiTiers,
                              ruleBasedEnabled: v === "on",
                            },
                          })
                        }
                      >
                        <SelectTrigger className="w-24 h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="on">Bật</SelectItem>
                          <SelectItem value="off">Tắt</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Match cứng keywords / patterns / cấu trúc. Nhanh — dùng tính % tin cậy cơ
                      bản trước khi gọi LLM.
                    </p>
                  </div>
                  <div className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium text-sm">Tầng 2 — Semantic (LLM Local)</h4>
                      <Select
                        value={config.aiTiers.semanticEnabled ? "on" : "off"}
                        disabled={!canEdit}
                        onValueChange={(v) =>
                          setConfig({
                            ...config,
                            aiTiers: {
                              ...config.aiTiers,
                              semanticEnabled: v === "on",
                            },
                          })
                        }
                      >
                        <SelectTrigger className="w-24 h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="on">Bật</SelectItem>
                          <SelectItem value="off">Tắt</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Đối chiếu văn bản mẫu chuẩn — phát hiện điều khoản núp bóng (ý nghĩa tương
                      đương dù khác từ khóa).
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Ghi chú kỹ thuật</Label>
                  <textarea
                    className="w-full min-h-[80px] rounded-md border px-3 py-2 text-sm"
                    disabled={!canEdit}
                    value={config.aiTiers.notes || ""}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        aiTiers: { ...config.aiTiers, notes: e.target.value },
                      })
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="template" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Template Contract</CardTitle>
                <CardDescription>
                  File Word mẫu chuẩn của loại HĐ này (tham chiếu cho Legal / Purchasing). Hệ
                  thống không so khớp nội dung file Hợp đồng review với template khi tạo hoặc
                  upload — không chặn vào AI queue vì lệch mẫu.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Tên file template mẫu</Label>
                    <Input
                      value={config.templateFileName || ""}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setConfig({ ...config, templateFileName: e.target.value })
                      }
                      placeholder="Template_HD_Khung_....docx"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Bắt buộc khớp template</Label>
                    <Select
                      value={config.requireTemplateMatch ? "yes" : "no"}
                      disabled={!canEdit}
                      onValueChange={(v) =>
                        setConfig({
                          ...config,
                          requireTemplateMatch: v === "yes",
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="yes">Có (HĐ khung)</SelectItem>
                        <SelectItem value="no">Không (NCC / khác)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="rounded-xl border border-dashed bg-slate-50/80 p-6 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <FileText className="h-9 w-9 text-sky-700 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {config.templateFileName || "Chưa gắn file template"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Demo: dùng mẫu{" "}
                        <code className="text-[11px]">
                          /samples/Template_HDDV_chung_2026.docx
                        </code>{" "}
                        để preview.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    {canEdit && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileRef.current?.click()}
                      >
                        <Upload className="h-4 w-4 mr-1" />
                        Upload .docx
                      </Button>
                    )}
                    <Button type="button" variant="outline" size="sm" asChild>
                      <a
                        href="/samples/Template_HDDV_chung_2026.docx"
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Tải mẫu demo
                      </a>
                    </Button>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f || !config) return;
                      if (!f.name.toLowerCase().endsWith(".docx")) {
                        toast({
                          title: "Chỉ nhận file .docx",
                          variant: "destructive",
                        });
                        return;
                      }
                      setConfig({ ...config, templateFileName: f.name });
                      toast({
                        title: "Đã gắn template (mock)",
                        description: f.name,
                      });
                      e.target.value = "";
                    }}
                  />
                </div>

                {canEdit && (
                  <Button onClick={handleSaveMeta} disabled={saving}>
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Save className="h-4 w-4 mr-1" />
                    )}
                    Lưu thay đổi template
                  </Button>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Audit trail cấu hình</CardTitle>
                <CardDescription>
                  Tách biệt audit hợp đồng — ai sửa clause / meta nào, version nào từng áp dụng.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!perm.canViewAudit ? (
                  <p className="text-sm text-muted-foreground">Không có quyền xem audit.</p>
                ) : audit.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Chưa có log.</p>
                ) : (
                  <div className="space-y-2 max-h-[420px] overflow-y-auto">
                    {audit.map((a) => (
                      <div key={a.id} className="rounded border px-3 py-2 text-sm">
                        <div className="flex flex-wrap justify-between gap-2">
                          <span className="font-medium">{a.action}</span>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(a.at), "dd/MM/yyyy HH:mm")}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {a.actorName} ({a.actorRole})
                          {a.clauseCode ? ` · ${a.clauseCode}` : ""}
                          {a.field ? ` · ${a.field}` : ""}
                        </p>
                        {(a.oldValue || a.newValue || a.note) && (
                          <p className="text-xs mt-1">
                            {a.oldValue != null && (
                              <span className="text-muted-foreground">
                                {a.oldValue} →{" "}
                              </span>
                            )}
                            {a.newValue && <span>{a.newValue}</span>}
                            {a.note && (
                              <span className="text-muted-foreground"> — {a.note}</span>
                            )}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={clauseOpen} onOpenChange={setClauseOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isNewClause ? "Thêm điều khoản" : canEdit ? "Sửa điều khoản" : "Xem điều khoản"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Mã điều khoản *</Label>
                <Input
                  value={editing.code}
                  disabled={!canEdit || !isNewClause}
                  onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                  placeholder="PAY-001"
                />
                {!isNewClause && (
                  <p className="text-[11px] text-muted-foreground">
                    Mã điều khoản ổn định — không đổi sau khi tạo.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Tên hiển thị *</Label>
                <Input
                  value={editing.name}
                  disabled={!canEdit}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Loại</Label>
                <Select
                  value={editing.kind}
                  disabled={!canEdit}
                  onValueChange={(v) =>
                    setEditing({ ...editing, kind: v as ChecklistClause["kind"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="required">Bắt buộc phải có</SelectItem>
                    <SelectItem value="forbidden">Cấm xuất hiện</SelectItem>
                    <SelectItem value="recommended">Khuyến nghị (không block)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Mức nghiêm trọng</Label>
                <Select
                  value={editing.severity}
                  disabled={!canEdit}
                  onValueChange={(v) =>
                    setEditing({
                      ...editing,
                      severity: v as ChecklistClause["severity"],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="block">Block</SelectItem>
                    <SelectItem value="warn_high">Cảnh báo cao</SelectItem>
                    <SelectItem value="warn_low">Cảnh báo thấp</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Văn bản mẫu chuẩn (Ideal)</Label>
                <textarea
                  className="w-full min-h-[80px] rounded-md border-2 border-[#1F4E79]/35 px-3 py-2 text-sm"
                  disabled={!canEdit}
                  value={editing.standardText}
                  onChange={(e) =>
                    setEditing({ ...editing, standardText: e.target.value })
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  Dùng cho cả đối chiếu ngữ nghĩa và đề xuất sửa của AI.
                </p>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-amber-800">Fallback</Label>
                <textarea
                  className="w-full min-h-[72px] rounded-md border-2 border-[#F59E0B] bg-amber-50/40 px-3 py-2 text-sm"
                  disabled={!canEdit}
                  value={editing.fallback || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, fallback: e.target.value })
                  }
                  placeholder="Phương án chấp nhận được khi Ideal không phù hợp bối cảnh"
                />
                <p className="text-[11px] text-muted-foreground">
                  Phương án chấp nhận được khi Ideal không phù hợp bối cảnh.
                </p>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-[#C62828]">Red Line</Label>
                <textarea
                  className="w-full min-h-[72px] rounded-md border-2 border-[#C62828] bg-rose-50/40 px-3 py-2 text-sm text-[#C62828]"
                  disabled={!canEdit}
                  value={editing.redLine || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, redLine: e.target.value })
                  }
                  placeholder="Ngưỡng walk-away…"
                />
                <p className="text-[11px] text-[#C62828]/90 flex gap-1.5 items-start">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  Dưới mức này AI KHÔNG tự đề xuất câu chữ thay thế, chỉ cảnh báo và yêu
                  cầu leo thang.
                </p>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Rationale</Label>
                <textarea
                  className="w-full min-h-[64px] rounded-md border px-3 py-2 text-sm"
                  disabled={!canEdit}
                  value={editing.rationale || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, rationale: e.target.value })
                  }
                  placeholder="Lý do nghiệp vụ đằng sau vị thế Ideal/Fallback/Red Line"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Từ khóa rule-based (cách nhau bằng | )</Label>
                <Input
                  disabled={!canEdit}
                  value={editing.keywords.join("|")}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      keywords: e.target.value
                        .split("|")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Patterns regex (cách nhau bằng | )</Label>
                <Input
                  disabled={!canEdit}
                  value={editing.patterns.join("|")}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      patterns: e.target.value
                        .split("|")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Content Control / Field ID</Label>
                <Input
                  disabled={!canEdit}
                  value={editing.contentControlId || ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      contentControlId: e.target.value || undefined,
                    })
                  }
                  placeholder="payment_days"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label>Cấp duyệt khi vượt Fallback</Label>
                  <Link
                    href="/dashboard/config"
                    className="text-xs text-[#1F4E79] hover:underline"
                  >
                    Xem Ma trận phê duyệt
                  </Link>
                </div>
                <Select
                  value={editing.approvalLevelOnFallbackBreach || "__none__"}
                  disabled={!canEdit}
                  onValueChange={(v) =>
                    setEditing({
                      ...editing,
                      approvalLevelOnFallbackBreach:
                        v === "__none__" ? "" : v,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn cấp duyệt" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Không chọn —</SelectItem>
                    {Array.from(
                      new Set(
                        matrices.flatMap((m) => m.tiers.map((t) => t.label))
                      )
                    ).map((label) => (
                      <SelectItem key={label} value={label}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Đối tác (điều kiện áp dụng)</Label>
                <Select
                  value={editing.condition?.partnerType || "any"}
                  disabled={!canEdit}
                  onValueChange={(v) =>
                    setEditing({
                      ...editing,
                      condition: {
                        ...editing.condition,
                        partnerType: v as NonNullable<
                          ChecklistClause["condition"]
                        >["partnerType"],
                      },
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Mọi đối tác</SelectItem>
                    <SelectItem value="foreign_vendor">NCC nước ngoài</SelectItem>
                    <SelectItem value="domestic_vendor">NCC trong nước</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>GT HĐ tối thiểu (VND)</Label>
                <Input
                  type="number"
                  disabled={!canEdit}
                  value={editing.condition?.minContractValue ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      condition: {
                        ...editing.condition,
                        minContractValue: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      },
                    })
                  }
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Ghi chú điều kiện áp dụng</Label>
                <Input
                  disabled={!canEdit}
                  value={editing.condition?.note || ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      condition: { ...editing.condition, note: e.target.value },
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Rule-based</Label>
                <Select
                  value={editing.enableRuleBased ? "on" : "off"}
                  disabled={!canEdit}
                  onValueChange={(v) =>
                    setEditing({ ...editing, enableRuleBased: v === "on" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on">Bật</SelectItem>
                    <SelectItem value="off">Tắt</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Semantic</Label>
                <Select
                  value={editing.enableSemantic ? "on" : "off"}
                  disabled={!canEdit}
                  onValueChange={(v) =>
                    setEditing({ ...editing, enableSemantic: v === "on" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on">Bật</SelectItem>
                    <SelectItem value="off">Tắt</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setClauseOpen(false)}>
              Đóng
            </Button>
            {canEdit && (
              <Button onClick={handleSaveClause} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Lưu điều khoản
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
