"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AppLayout from "@/components/layout/app-layout";
import { FormListsPanel } from "@/components/configurations/form-lists-panel";
import { SigningRulesPanel } from "@/components/configurations/signing-rules-panel";
import { TemplatesPanel } from "@/components/configurations/templates-panel";
import { SystemPromptsPanel } from "@/components/configurations/system-prompts-panel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { getSession } from "@/lib/session";
import {
  canAccessConfig,
  canAccessConfigurations,
  canAccessFormLists,
  canAccessSystemPrompts,
} from "@/lib/roles";
import type { UserSession } from "@/lib/types";
import {
  ArrowLeft,
  FileCode2,
  FileCheck2,
  ListTree,
  Loader2,
  Users,
} from "lucide-react";

type ConfigTab = "form-lists" | "system-prompts" | "signing" | "templates";

function tabQuery(tab: ConfigTab): string {
  if (tab === "system-prompts") return "?tab=system-prompts";
  if (tab === "signing") return "?tab=signing";
  if (tab === "templates") return "?tab=templates";
  return "";
}

function ConfigurationsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [session, setSession] = useState<UserSession | null>(null);

  const canForms = canAccessFormLists(session);
  const canPrompts = canAccessSystemPrompts(session);
  const canSigning = canAccessConfig(session);

  const tabParam = searchParams.get("tab");
  const initialTab: ConfigTab = useMemo(() => {
    if (tabParam === "system-prompts" && canPrompts) return "system-prompts";
    if (tabParam === "signing" && canSigning) return "signing";
    if (tabParam === "templates" && canSigning) return "templates";
    if (canForms) return "form-lists";
    if (canSigning) return "signing";
    if (canPrompts) return "system-prompts";
    return "form-lists";
  }, [tabParam, canForms, canPrompts, canSigning]);
  const [tab, setTab] = useState<ConfigTab>(initialTab);

  useEffect(() => {
    const s = getSession();
    if (!canAccessConfigurations(s)) {
      toast({
        title: "Không có quyền Configurations",
        description:
          "Cần quyền Form lists, System prompts hoặc Cấu hình hợp đồng.",
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Configurations
          </h1>
        </div>
        <Button size="sm" variant="outline" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            Quay lại
          </Link>
        </Button>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = v as ConfigTab;
          if (next === "form-lists" && !canForms) return;
          if (next === "system-prompts" && !canPrompts) return;
          if (next === "signing" && !canSigning) return;
          if (next === "templates" && !canSigning) return;
          setTab(next);
          router.replace(`/dashboard/configurations${tabQuery(next)}`);
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
          {canSigning && (
            <TabsTrigger value="templates" className="gap-1.5 px-4">
              <FileCheck2 className="h-3.5 w-3.5" />
              Template
            </TabsTrigger>
          )}
          {canSigning && (
            <TabsTrigger value="signing" className="gap-1.5 px-4">
              <Users className="h-3.5 w-3.5" />
              Phân quyền ký
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
        {canSigning && (
          <TabsContent value="templates" className="mt-0">
            <TemplatesPanel />
          </TabsContent>
        )}
        {canSigning && (
          <TabsContent value="signing" className="mt-0">
            <SigningRulesPanel />
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
