"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppLayout from "@/components/layout/app-layout";
import { FormListsPanel } from "@/components/configurations/form-lists-panel";
import { SystemPromptsPanel } from "@/components/configurations/system-prompts-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { getSession } from "@/lib/review-service";
import {
  canAccessConfigurations,
  canAccessFormLists,
  canAccessSystemPrompts,
} from "@/lib/roles";
import type { UserSession } from "@/lib/types";
import { FileCode2, ListTree, Loader2 } from "lucide-react";

type ConfigTab = "form-lists" | "system-prompts";

function ConfigurationsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [session, setSession] = useState<UserSession | null>(null);

  const canForms = canAccessFormLists(session);
  const canPrompts = canAccessSystemPrompts(session);

  const tabParam = searchParams.get("tab");
  const initialTab: ConfigTab = useMemo(() => {
    if (tabParam === "system-prompts" && canPrompts) return "system-prompts";
    if (canForms) return "form-lists";
    if (canPrompts) return "system-prompts";
    return "form-lists";
  }, [tabParam, canForms, canPrompts]);
  const [tab, setTab] = useState<ConfigTab>(initialTab);

  useEffect(() => {
    const s = getSession();
    if (!canAccessConfigurations(s)) {
      toast({
        title: "Không có quyền Configurations",
        description: "Cần quyền Form lists hoặc System prompts.",
        variant: "destructive",
      });
      router.push("/dashboard");
      return;
    }
    setSession(s);
  }, [router, toast]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  if (!session) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        Đang kiểm tra quyền…
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Configurations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cấu hình dropdown form tạo review và System prompts — theo quyền IT
          gán trên Users.
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = v as ConfigTab;
          if (next === "form-lists" && !canForms) return;
          if (next === "system-prompts" && !canPrompts) return;
          setTab(next);
          const q = next === "system-prompts" ? "?tab=system-prompts" : "";
          router.replace(`/dashboard/configurations${q}`);
        }}
        className="space-y-4"
      >
        <TabsList className="h-10">
          {canForms && (
            <TabsTrigger value="form-lists" className="gap-1.5 px-4">
              <ListTree className="h-3.5 w-3.5" />
              Form lists
            </TabsTrigger>
          )}
          {canPrompts && (
            <TabsTrigger value="system-prompts" className="gap-1.5 px-4">
              <FileCode2 className="h-3.5 w-3.5" />
              System prompts
            </TabsTrigger>
          )}
        </TabsList>

        {canForms && (
          <TabsContent value="form-lists" className="mt-0">
            <FormListsPanel />
          </TabsContent>
        )}
        {canPrompts && (
          <TabsContent value="system-prompts" className="mt-0">
            <SystemPromptsPanel />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

export default function ConfigurationsPage() {
  return (
    <AppLayout>
      <Suspense
        fallback={
          <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Đang tải Configurations…
          </div>
        }
      >
        <ConfigurationsContent />
      </Suspense>
    </AppLayout>
  );
}
