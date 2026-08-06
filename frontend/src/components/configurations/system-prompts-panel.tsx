"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import type { PipelineStage } from "@/lib/system-prompts/constants";
import { ChevronDown, Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils";

interface SystemPromptSnapshot {
  stage: PipelineStage;
  currentFile: string;
  content: string;
  placeholders: string[];
  versions: string[];
}

const STAGE_LABELS: Record<PipelineStage, string> = {
  checklist_review: "Checklist review (first-pass)",
  chat_edit: "Chat edit",
  ai_summary_fairness: "AI summary & fairness",
};

const STAGE_META: Record<
  PipelineStage,
  { input: string; output: string; when: string }
> = {
  checklist_review: {
    input: "Toàn bộ văn bản hợp đồng + checklist",
    output:
      "JSON có cấu trúc: danh sách phát hiện phân loại Red Flag / Warning / Protection / Missing Protection",
    when: "User bấm Submit lần đầu (Bước 2)",
  },
  chat_edit: {
    input: "Lịch sử hội thoại + trạng thái tài liệu hiện tại + checklist",
    output: "Diff cục bộ vào đúng đoạn user yêu cầu",
    when: "User gõ chat yêu cầu sửa thêm",
  },
  ai_summary_fairness: {
    input:
      "Danh sách phát hiện đã có sẵn (đầu ra của stage 1/2) + Ma trận phê duyệt",
    output: "Đoạn tóm tắt ngôn ngữ tự nhiên + Fairness Score",
    when: "Mỗi lần field được lưu (Mục 4.4)",
  },
};

/** Panel chỉnh System Prompt theo stage — dùng trong Configurations. */
export function SystemPromptsPanel() {
  const { toast } = useToast();
  const [prompts, setPrompts] = useState<SystemPromptSnapshot[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<PipelineStage, string>>>(
    {}
  );
  const [loading, setLoading] = useState(true);
  const [savingStage, setSavingStage] = useState<PipelineStage | null>(null);
  const [openPanels, setOpenPanels] = useState<
    Partial<Record<PipelineStage, boolean>>
  >({});
  const [expandedTemplates, setExpandedTemplates] = useState<
    Partial<Record<PipelineStage, boolean>>
  >({});

  useEffect(() => {
    fetch("/api/system-prompts")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Lỗi tải prompts");
        const list = (data.prompts || []) as SystemPromptSnapshot[];
        setPrompts(list);
        const initial: Partial<Record<PipelineStage, string>> = {};
        for (const p of list) {
          initial[p.stage] = p.content;
        }
        setDrafts(initial);
        setOpenPanels({}); // mặc định thu gọn — chỉ hiện title
      })
      .catch((e) =>
        toast({
          title: "Không đọc được /prompts",
          description: e instanceof Error ? e.message : "Lỗi",
          variant: "destructive",
        })
      )
      .finally(() => setLoading(false));
  }, [toast]);

  const isDirty = (stage: PipelineStage) => {
    const saved = prompts.find((p) => p.stage === stage)?.content ?? "";
    return (drafts[stage] ?? "") !== saved;
  };

  const handleSave = async (stage: PipelineStage) => {
    setSavingStage(stage);
    try {
      const res = await fetch("/api/system-prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage, content: drafts[stage] ?? "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lưu thất bại");
      const saved = data.prompt as SystemPromptSnapshot;
      setPrompts((prev) =>
        prev.map((p) => (p.stage === saved.stage ? saved : p))
      );
      setDrafts((prev) => ({ ...prev, [saved.stage]: saved.content }));
      toast({
        title: "Đã lưu",
        description: `Ghi ${saved.currentFile} · ${STAGE_LABELS[saved.stage]}`,
      });
    } catch (e) {
      toast({
        title: "Không lưu được",
        description: e instanceof Error ? e.message : "Lỗi",
        variant: "destructive",
      });
    } finally {
      setSavingStage(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Đang đọc file prompts…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Prompt theo stage pipeline (file Git <code className="text-xs">/prompts</code>
        ). Không hardcode điều khoản Legal.
      </p>
      {prompts.map((prompt) => {
        const stage = prompt.stage;
        const panelOpen = !!openPanels[stage];
        const templateExpanded = !!expandedTemplates[stage];
        const dirty = isDirty(stage);
        const saving = savingStage === stage;
        const draft = drafts[stage] ?? "";

        return (
          <div key={stage} className="rounded-lg border bg-white shadow-sm">
            <button
              type="button"
              onClick={() =>
                setOpenPanels((prev) => ({
                  ...prev,
                  [stage]: !panelOpen,
                }))
              }
              className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
              aria-expanded={panelOpen}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">
                  {STAGE_LABELS[stage]}
                </h2>
                {dirty && (
                  <Badge variant="secondary" className="text-[11px]">
                    Chưa lưu
                  </Badge>
                )}
              </div>
              <ChevronDown
                className={cn(
                  "h-5 w-5 shrink-0 text-muted-foreground transition-transform",
                  panelOpen && "rotate-180"
                )}
              />
            </button>

            {panelOpen && (
              <div className="space-y-4 border-t px-5 py-4">
                <dl className="grid gap-1.5 text-sm text-muted-foreground sm:grid-cols-[5.5rem_1fr]">
                  <dt className="font-medium text-foreground/80">Input</dt>
                  <dd>{STAGE_META[stage].input}</dd>
                  <dt className="font-medium text-foreground/80">Output</dt>
                  <dd>{STAGE_META[stage].output}</dd>
                  <dt className="font-medium text-foreground/80">Kích hoạt</dt>
                  <dd>{STAGE_META[stage].when}</dd>
                </dl>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={`template-${stage}`}>Instruction</Label>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedTemplates((prev) => ({
                          ...prev,
                          [stage]: !templateExpanded,
                        }))
                      }
                      className="text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      {templateExpanded ? "Thu gọn" : "Mở rộng"}
                    </button>
                  </div>
                  <textarea
                    id={`template-${stage}`}
                    value={draft}
                    rows={14}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [stage]: e.target.value,
                      }))
                    }
                    spellCheck={false}
                    className={cn(
                      "w-full rounded-md border border-input bg-white px-3 py-2",
                      "font-mono text-sm leading-relaxed text-foreground",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      templateExpanded
                        ? "min-h-[min(70vh,560px)] resize-y"
                        : "min-h-[280px] resize-y"
                    )}
                    aria-label={`Prompt template ${stage}`}
                  />
                </div>

                <div className="flex justify-end pt-1">
                  <Button
                    type="button"
                    disabled={!dirty || saving}
                    onClick={() => handleSave(stage)}
                  >
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Save Prompt
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
