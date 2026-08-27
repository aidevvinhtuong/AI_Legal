"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Info,
  ShieldCheck,
  ShieldOff,
  X,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  ChecklistFinding,
  ContractInsight,
  InsightSeverity,
} from "@/lib/domain/types";
import { cn } from "@/lib/utils";

export interface ContractInsightPopupProps {
  isOpen: boolean;
  onClose: () => void;
  insight: ContractInsight;
  isRecalculating?: boolean;
  onJumpToField?: (fieldId: string) => void;
  /** Neo panel ngay bên phải nút % tin cậy — không làm tối background */
  anchorRef?: RefObject<HTMLElement | null>;
}

const NAVY = "#1F4E79";
const PANEL_WIDTH = 420;
const GAP = 8;

function fairnessRingClass(score: number) {
  if (score >= 80) return "border-emerald-600 text-emerald-800 bg-emerald-50";
  if (score >= 50) return "border-amber-500 text-amber-800 bg-amber-50";
  return "border-red-600 text-red-800 bg-red-50";
}

function SeverityTag({ severity }: { severity: InsightSeverity }) {
  if (severity === "block") {
    return (
      <Badge className="rounded-md border-transparent bg-[#C62828] text-white hover:bg-[#C62828] text-[10px] px-1.5 py-0">
        Block
      </Badge>
    );
  }
  if (severity === "high") {
    return (
      <Badge
        variant="outline"
        className="rounded-md border-amber-500 text-amber-700 text-[10px] px-1.5 py-0"
      >
        High
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="rounded-md border-slate-400 text-slate-600 text-[10px] px-1.5 py-0"
    >
      Low
    </Badge>
  );
}

function FindingRow({
  finding,
  onJumpToField,
}: {
  finding: ChecklistFinding;
  onJumpToField?: (fieldId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 space-y-1.5">
      <div className="flex items-start gap-2 flex-wrap">
        <span className="text-sm font-semibold text-slate-900 leading-snug">
          {finding.title}
        </span>
        {finding.severity && <SeverityTag severity={finding.severity} />}
        <span className="text-[10px] text-muted-foreground font-mono ml-auto">
          {finding.id}
        </span>
      </div>
      <p className="text-sm text-slate-600 leading-relaxed">{finding.description}</p>
      {finding.relatedFieldId ? (
        <button
          type="button"
          className="text-xs font-medium text-[#1F4E79] hover:underline inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F4E79] focus-visible:ring-offset-1 rounded"
          onClick={() => onJumpToField?.(finding.relatedFieldId!)}
        >
          → Xem field trong tài liệu
        </button>
      ) : (
        <p className="text-xs text-muted-foreground">
          🔒 Vùng khoá — cần Legal xem lại template nếu muốn thay đổi
        </p>
      )}
    </div>
  );
}

function GroupSkeleton() {
  return (
    <div className="space-y-2 animate-pulse py-1" aria-hidden>
      <div className="h-3 w-3/4 rounded bg-slate-200" />
      <div className="h-3 w-full rounded bg-slate-100" />
      <div className="h-3 w-5/6 rounded bg-slate-100" />
    </div>
  );
}

type GroupKey = keyof ContractInsight["groups"];

const GROUP_META: Record<
  GroupKey,
  {
    label: string;
    emptyOk: string;
    color: string;
    Icon: typeof AlertTriangle;
    defaultOpen: boolean;
  }
> = {
  redFlags: {
    label: "Red Flags",
    emptyOk: "Không phát hiện Red Flag nào",
    color: "#C62828",
    Icon: AlertTriangle,
    defaultOpen: true,
  },
  warnings: {
    label: "Warnings",
    emptyOk: "Không có Warning",
    color: "#F59E0B",
    Icon: AlertCircle,
    defaultOpen: false,
  },
  protections: {
    label: "Protections",
    emptyOk: "Chưa ghi nhận Protection",
    color: "#2E7D32",
    Icon: ShieldCheck,
    defaultOpen: false,
  },
  missingProtections: {
    label: "Missing Protections",
    emptyOk: "Không thiếu bảo vệ quan trọng",
    color: "#64748B",
    Icon: ShieldOff,
    defaultOpen: true,
  },
};

function ScoreChip({
  label,
  value,
  ringClass,
  tooltip,
  style,
}: {
  label: string;
  value: string;
  ringClass?: string;
  tooltip: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border-2 px-2.5 py-1.5 text-xs font-medium",
        ringClass
      )}
      style={style}
    >
      <span>
        {label}: <strong className="font-semibold">{value}</strong>
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="rounded-full p-0.5 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
            aria-label={`Giải thích: ${label}`}
          >
            <Info className="h-3.5 w-3.5 opacity-70" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[240px] text-xs leading-relaxed">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function computePanelStyle(anchor: HTMLElement | null): CSSProperties {
  if (!anchor || typeof window === "undefined") {
    return { top: 72, left: 24 };
  }
  const rect = anchor.getBoundingClientRect();
  const maxH = Math.min(560, window.innerHeight - 24);
  let left = rect.right + GAP;
  let top = rect.top;

  // Không đủ chỗ bên phải → đặt bên trái nút
  if (left + PANEL_WIDTH > window.innerWidth - 12) {
    left = Math.max(12, rect.left - PANEL_WIDTH - GAP);
  }
  // Vẫn tràn → kẹp trong viewport
  left = Math.min(left, window.innerWidth - PANEL_WIDTH - 12);
  left = Math.max(12, left);

  if (top + maxH > window.innerHeight - 12) {
    top = Math.max(12, window.innerHeight - maxH - 12);
  }
  top = Math.max(12, top);

  return {
    top,
    left,
    width: PANEL_WIDTH,
    maxHeight: maxH,
  };
}

/**
 * Panel phân tích HĐ neo cạnh nút % tin cậy — không overlay làm tối nền.
 */
export function ContractInsightPopup({
  isOpen,
  onClose,
  insight,
  isRecalculating = false,
  onJumpToField,
  anchorRef,
}: ContractInsightPopupProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [pos, setPos] = useState<CSSProperties>({ top: 72, left: 24 });
  const [mounted, setMounted] = useState(false);

  const defaultOpen = Object.entries(GROUP_META)
    .filter(([, m]) => m.defaultOpen)
    .map(([k]) => k);

  const [openGroups, setOpenGroups] = useState<string[]>(defaultOpen);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setOpenGroups(defaultOpen);
    setSummaryOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insight.contractId, isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const update = () =>
      setPos(computePanelStyle(anchorRef?.current ?? null));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isOpen, anchorRef]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (anchorRef?.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [isOpen, onClose, anchorRef]);

  const updatedLabel = (() => {
    try {
      return format(new Date(insight.lastUpdatedAt), "HH:mm");
    } catch {
      return "—";
    }
  })();

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="fixed z-[60] flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl font-sans"
      style={pos}
    >
      <TooltipProvider delayDuration={200}>
        <div className="px-4 pt-4 pb-3 border-b space-y-3 shrink-0 relative">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 rounded-sm p-1 opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F4E79]"
            aria-label="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="pr-7">
            <h2 id={titleId} className="text-base font-semibold text-slate-900 leading-snug">
              {insight.contractName}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Cập nhật lúc {updatedLabel}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <ScoreChip
              label="Độ tin cậy AI"
              value={`${insight.aiConfidenceScore}%`}
              style={{
                borderColor: NAVY,
                color: NAVY,
                backgroundColor: "#E8F0F7",
              }}
              tooltip="Độ chắc chắn của AI về phân tích hiện tại — dựa trên khớp checklist rule-based + phân tích ngữ nghĩa LLM + đối chiếu Approval Matrix. Không đo mức độ có lợi của điều khoản."
            />
            <ScoreChip
              label="Fairness Score"
              value={`${insight.fairnessScore}/100`}
              ringClass={fairnessRingClass(insight.fairnessScore)}
              tooltip="Mức cân bằng / có lợi của điều khoản đối với công ty — tính từ tỷ lệ Red Flags & Warnings so với Protections. Không phải độ tin cậy của AI."
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          <div className="rounded-lg border border-slate-200 bg-slate-50/80">
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F4E79] rounded-lg"
              onClick={() => setSummaryOpen((v) => !v)}
              aria-expanded={summaryOpen}
            >
              <span>AI tóm tắt điểm chính</span>
              <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                {summaryOpen ? "Thu gọn" : "Mở rộng"}
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform",
                    summaryOpen && "rotate-180"
                  )}
                />
              </span>
            </button>
            {summaryOpen && (
              <div className="px-3 pb-3">
                {isRecalculating ? (
                  <GroupSkeleton />
                ) : (
                  <p className="text-sm text-slate-700 leading-relaxed">
                    {insight.aiSummary}
                  </p>
                )}
              </div>
            )}
          </div>

          <Accordion
            type="multiple"
            value={openGroups}
            onValueChange={setOpenGroups}
            className="space-y-2"
          >
            {(Object.keys(GROUP_META) as GroupKey[]).map((key) => {
              const meta = GROUP_META[key];
              const items = insight.groups[key];
              const Icon = meta.Icon;
              return (
                <AccordionItem
                  key={key}
                  value={key}
                  className="rounded-lg border border-slate-200 px-3 border-b-slate-200"
                >
                  <AccordionTrigger className="py-2.5 hover:no-underline text-sm">
                    <span className="flex items-center gap-2">
                      <Icon
                        className="h-4 w-4 shrink-0"
                        style={{ color: meta.color }}
                      />
                      <span
                        style={{ color: meta.color }}
                        className="font-semibold"
                      >
                        {meta.label}
                      </span>
                      <Badge
                        variant="secondary"
                        className="rounded-md text-[10px] px-1.5 py-0 font-semibold"
                        style={{
                          backgroundColor: `${meta.color}18`,
                          color: meta.color,
                        }}
                      >
                        {items.length}
                      </Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    {isRecalculating ? (
                      <GroupSkeleton />
                    ) : items.length === 0 ? (
                      <p className="flex items-center gap-1.5 text-sm text-muted-foreground py-1">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                        {meta.emptyOk}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {items.map((f) => (
                          <FindingRow
                            key={f.id}
                            finding={f}
                            onJumpToField={onJumpToField}
                          />
                        ))}
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>

        <div className="px-4 py-2.5 border-t flex justify-end shrink-0">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Đóng
          </Button>
        </div>
      </TooltipProvider>
    </div>,
    document.body
  );
}
