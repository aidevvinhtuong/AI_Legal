"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  FileText,
  Gavel,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Users,
} from "lucide-react";
import { clearSession, getSession } from "@/lib/review-service";
import type { UserSession } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  canAccessContractsList,
  canAccessTasks,
  canAccessUsers,
  canCreateContracts,
} from "@/lib/roles";

const SIDEBAR_KEY = "ai_econtract_sidebar_collapsed";

export default function AppLayout({
  children,
  mainClassName,
  lockViewport,
}: {
  children: React.ReactNode;
  /** Tuỳ chỉnh vùng main (vd. màn workspace cố định chiều cao viewport) */
  mainClassName?: string;
  /** Khoá chiều cao = viewport, không cuộn trang ngoài */
  lockViewport?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserSession | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.push("/login");
      return;
    }
    setUser(session);
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, [router]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const handleLogout = () => {
    clearSession();
    router.push("/login");
  };

  const contractsLabel =
    user?.role === "legal" || user?.role === "legal_lead" || user?.role === "it"
      ? "Tất cả hợp đồng"
      : "Danh sách HĐ";

  const navigation = [
    ...(canAccessTasks(user)
      ? [{ name: "Task", href: "/dashboard/tasks", icon: Gavel }]
      : []),
    ...(canCreateContracts(user) || canAccessContractsList(user)
      ? [
          {
            name: "Review hợp đồng",
            href: "/dashboard/review",
            icon: Sparkles,
          },
        ]
      : []),
    ...(canAccessContractsList(user)
      ? [
          {
            name: contractsLabel,
            href: "/dashboard",
            icon:
              user?.role === "legal" ||
              user?.role === "legal_lead" ||
              user?.role === "it"
                ? FileText
                : LayoutDashboard,
          },
        ]
      : []),
    ...(canAccessUsers(user)
      ? [{ name: "Users", href: "/dashboard/users", icon: Users }]
      : []),
  ];

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Đang tải...
      </div>
    );
  }

  return (
    <div
      className={cn(
        "bg-background",
        lockViewport ? "h-dvh overflow-hidden" : "min-h-screen"
      )}
    >
      {/* Desktop collapse toggle (when sidebar collapsed — floating) */}
      {collapsed && (
        <button
          type="button"
          onClick={toggleCollapsed}
          className="hidden lg:flex fixed top-3.5 left-3 z-50 h-9 w-9 items-center justify-center rounded-md border bg-card shadow-sm hover:bg-accent"
          title="Mở rộng sidebar"
          aria-label="Mở rộng sidebar"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      )}

      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 bg-card border-r transition-all duration-200 ease-in-out",
          collapsed ? "w-16" : "w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="flex h-full flex-col">
          <div
            className={cn(
              "flex h-16 items-center border-b gap-2",
              collapsed ? "justify-center px-2" : "px-4"
            )}
          >
            <img
              src="/logo.png"
              alt="Saint-Gobain"
              className={cn(
                "rounded-lg shrink-0",
                collapsed ? "w-9 h-9" : "w-12 h-12"
              )}
            />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold leading-tight truncate">
                  Saint-Gobain
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  AI Legal
                </div>
              </div>
            )}
            {!collapsed && (
              <button
                type="button"
                onClick={toggleCollapsed}
                className="hidden lg:inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground shrink-0"
                title="Thu gọn sidebar"
                aria-label="Thu gọn sidebar"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            )}
          </div>

          <nav
            className={cn("flex-1 space-y-1 py-4", collapsed ? "px-2" : "px-3")}
          >
            {navigation.map((item) => {
              const active =
                item.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  title={collapsed ? item.name : undefined}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "group flex items-center rounded-lg text-sm font-medium transition-all",
                    collapsed ? "justify-center px-2 py-3" : "px-3 py-2.5",
                    active
                      ? "bg-gradient-to-r from-primary/10 to-primary/5 text-primary shadow-sm"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                >
                  <item.icon
                    className={cn("h-5 w-5 shrink-0", !collapsed && "mr-3")}
                  />
                  {!collapsed && <span className="truncate">{item.name}</span>}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <button
          type="button"
          className="lg:hidden fixed inset-0 z-30 bg-black/40"
          aria-label="Đóng menu"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div
        className={cn(
          "transition-[padding] duration-200 ease-in-out",
          lockViewport && "h-full flex flex-col",
          collapsed ? "lg:pl-16" : "lg:pl-64"
        )}
      >
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b bg-card px-4 lg:px-8">
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="lg:hidden inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background"
            aria-label="Mở menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="ml-auto flex min-w-0 items-center gap-3">
            <div className="min-w-0 text-right hidden sm:block">
              <div className="text-sm font-medium truncate">{user.name}</div>
              <div className="text-xs text-muted-foreground truncate">
                {user.email}
              </div>
            </div>
            <Badge variant="secondary" className="capitalize shrink-0">
              {user.role}
            </Badge>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 shrink-0"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Đăng xuất</span>
            </button>
          </div>
        </header>

        <main
          className={cn(
            "p-4 lg:p-8",
            lockViewport
              ? "flex-1 min-h-0 overflow-hidden flex flex-col"
              : "min-h-[calc(100dvh-4rem)]",
            mainClassName
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
