"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import type { PipelineStage } from "@/lib/system-prompts/constants";
import {
  fetchSystemPrompts,
  updateSystemPrompt,
  type SystemPromptSnapshot,
} from "@/lib/system-prompts-service";
import { ChevronDown, Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils";

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
    fetchSystemPrompts()
      .then((list) => {
        setPrompts(list);
        const initial: Partial<Record<PipelineStage, string>> = {};
        for (const p of list) {
          initial[p.stage] = p.content;
        }
        setDrafts(initial);
        setOpenPanels({});
      })
      .catch((e) =>
        toast({
          title: "Không đọc được system prompts",
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
      const saved = await updateSystemPrompt(stage, drafts[stage] ?? "");
      setPrompts((prev) =>
        prev.map((p) => (p.stage === saved.stage ? saved : p))
      );
      setDrafts((prev) => ({ ...prev, [saved.stage]: saved.content }));
      toast({
        title: "Đã lưu",
        description: `Ghi ${saved.fileName} · ${STAGE_LABELS[saved.stage]}`,
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
        Prompt theo stage pipeline (file Git{" "}
        <code className="text-xs">/prompts</code>
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
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              onClick={() =>
                setOpenPanels((prev) => ({ ...prev, [stage]: !prev[stage] }))
              }
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-medium">{STAGE_LABELS[stage]}</span>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {prompt.fileName}
                </Badge>
                {dirty && (
                  <Badge variant="outline" className="text-[10px] text-amber-700">
                    Chưa lưu
                  </Badge>
                )}
              </div>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  panelOpen && "rotate-180"
                )}
              />
            </button>

            {panelOpen && (
              <div className="space-y-3 border-t px-4 py-4">
                <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                  <p>
                    <span className="font-medium text-foreground">Khi: </span>
                    {STAGE_META[stage].when}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Input: </span>
                    {STAGE_META[stage].input}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Output: </span>
                    {STAGE_META[stage].output}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`prompt-${stage}`}>Nội dung prompt</Label>
                  <textarea
                    id={`prompt-${stage}`}
                    className="min-h-[180px] w-full rounded-md border bg-background px-3 py-2 font-mono text-xs leading-relaxed"
                    value={draft}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [stage]: e.target.value,
                      }))
                    }
                  />
                </div>

                {prompt.placeholders.length > 0 && (
                  <div className="space-y-1">
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setExpandedTemplates((prev) => ({
                          ...prev,
                          [stage]: !prev[stage],
                        }))
                      }
                    >
                      Placeholders ({prompt.placeholders.length})
                      <ChevronDown
                        className={cn(
                          "h-3 w-3 transition-transform",
                          templateExpanded && "rotate-180"
                        )}
                      />
                    </button>
                    {templateExpanded && (
                      <ul className="flex flex-wrap gap-1.5">
                        {prompt.placeholders.map((ph) => (
                          <li key={ph}>
                            <Badge
                              variant="outline"
                              className="font-mono text-[10px]"
                            >
                              {ph}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={!dirty || saving}
                    onClick={() => handleSave(stage)}
                  >
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Lưu
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
