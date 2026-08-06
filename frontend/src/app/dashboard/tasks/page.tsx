"use client";

import { Suspense } from "react";
import TaskInboxPage from "./task-inbox";

export default function TasksPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-muted-foreground">
          Đang tải...
        </div>
      }
    >
      <TaskInboxPage />
    </Suspense>
  );
}
