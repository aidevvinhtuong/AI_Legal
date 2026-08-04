import type { ReviewStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<ReviewStatus, string> = {
  draft: "Nháp — đang hoàn thiện file",
  queued: "Đang chờ queue",
  processing: "AI đang xử lý",
  reviewed: "Đã AI review",
  awaiting_markers: "Đủ marker",
  pending_legal: "Chờ Legal",
  rejected: "Legal từ chối",
  approved: "Đã duyệt",
  syncing_econtract: "Đồng bộ Econtract",
  signed: "Đã ký",
};

const STATUS_VARIANT: Record<ReviewStatus, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  queued: "secondary",
  processing: "secondary",
  reviewed: "default",
  awaiting_markers: "default",
  pending_legal: "default",
  rejected: "destructive",
  approved: "default",
  syncing_econtract: "secondary",
  signed: "default",
};

export function StatusBadge({
  status,
  className,
}: {
  status: ReviewStatus;
  className?: string;
}) {
  return (
    <Badge variant={STATUS_VARIANT[status]} className={cn(className)}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export { STATUS_LABEL };
