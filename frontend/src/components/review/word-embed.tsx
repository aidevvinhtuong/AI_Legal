"use client";

import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

export type WordFileTab = {
  id: string;
  label: string;
};

/** Khung nhúng giống Word Online — hỗ trợ tab theo file. */
export function WordEmbedShell({
  fileName,
  files,
  activeFileId,
  onFileChange,
  children,
  className,
  toolbar,
}: {
  /** Fallback khi không truyền `files` */
  fileName?: string;
  files?: WordFileTab[];
  activeFileId?: string;
  onFileChange?: (fileId: string) => void;
  children: React.ReactNode;
  className?: string;
  toolbar?: React.ReactNode;
}) {
  const tabs: WordFileTab[] =
    files && files.length > 0
      ? files
      : fileName
        ? [{ id: "primary", label: fileName }]
        : [];
  const activeId = activeFileId || tabs[0]?.id;

  return (
    <div className={cn("flex flex-col h-full min-h-0 bg-[#f3f3f3]", className)}>
      <div className="shrink-0 flex items-end gap-0 border-b bg-[#e8eaed] px-1 pt-1.5 overflow-x-auto">
        <div className="flex items-end min-w-0 flex-1 gap-0.5">
          {tabs.map((tab) => {
            const active = tab.id === activeId;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onFileChange?.(tab.id)}
                title={tab.label}
                className={cn(
                  "group relative flex max-w-[220px] min-w-[96px] items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs transition-colors",
                  active
                    ? "bg-white text-foreground shadow-[0_-1px_0_#fff] z-[1] border border-b-0 border-black/10"
                    : "bg-transparent text-muted-foreground hover:bg-white/60 hover:text-foreground"
                )}
              >
                <FileText
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    active ? "text-sky-700" : "text-muted-foreground"
                  )}
                />
                <span className="truncate font-medium">
                  {tab.label.replace(/\.docx$/i, "")}
                  <span className="font-normal opacity-70">.docx</span>
                </span>
                {active && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1F4E79]" />
                )}
              </button>
            );
          })}
        </div>
        <span className="shrink-0 self-center px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
          Word
        </span>
      </div>

      {toolbar && (
        <div className="shrink-0 border-b bg-white px-3 py-2 flex flex-wrap items-center gap-2">
          {toolbar}
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 min-h-0">
        <div className="mx-auto max-w-[720px] min-h-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.18)] border border-black/5">
          {children}
        </div>
      </div>
    </div>
  );
}
