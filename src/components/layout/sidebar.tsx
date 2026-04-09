"use client";
import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, CalendarDays, CalendarRange, Package, Megaphone,
  BoxesIcon, Calculator, Target, Upload, Settings, DollarSign, Link2,
  ChevronDown, ChevronRight, ShoppingBag, Filter,
} from "lucide-react";

type NavItem = { name: string; href: string; icon: any };
type NavSection = { section: string; items: NavItem[]; collapsible?: boolean; defaultOpen?: boolean; badge?: string };
type NavEntry = NavItem | NavSection;

const navigation: NavEntry[] = [
  { name: "ダッシュボード", href: "/", icon: LayoutDashboard },
  {
    section: "🟠 Amazon",
    collapsible: true,
    defaultOpen: true,
    items: [
      { name: "日別分析", href: "/daily", icon: CalendarDays },
      { name: "月別分析", href: "/monthly", icon: CalendarRange },
      { name: "商品別分析", href: "/products-analysis", icon: Package },
      { name: "広告管理", href: "/advertising", icon: Megaphone },
    ],
  },
  {
    section: "🔴 楽天",
    collapsible: true,
    defaultOpen: true,
    items: [
      { name: "日別分析", href: "/rakuten/daily", icon: CalendarDays },
      { name: "月別分析", href: "/rakuten/monthly", icon: CalendarRange },
      { name: "商品別分析", href: "/rakuten/products", icon: Package },
      { name: "RPP広告管理", href: "/rakuten/rpp", icon: Megaphone },
    ],
  },
  {
    section: "🟢 Shopify",
    collapsible: true,
    defaultOpen: false,
    items: [
      { name: "日別分析", href: "/shopify/daily", icon: CalendarDays },
      { name: "月別分析", href: "/shopify/monthly", icon: CalendarRange },
      { name: "商品別分析", href: "/shopify/products", icon: Package },
      { name: "広告ファネル", href: "/shopify/funnel", icon: Filter },
      { name: "Meta広告管理", href: "/shopify/meta-ads", icon: Megaphone },
    ],
  },
  {
    section: "在庫",
    items: [
      { name: "在庫管理", href: "/inventory", icon: BoxesIcon },
    ],
  },
  {
    section: "ツール",
    items: [
      { name: "利益シミュレーション", href: "/simulation", icon: Calculator },
      { name: "目標・進捗管理", href: "/goals", icon: Target },
      { name: "施策カレンダー", href: "/events", icon: CalendarDays },
    ],
  },
  {
    section: "データ",
    items: [
      { name: "CSVインポート", href: "/import", icon: Upload },
    ],
  },
  {
    section: "設定",
    items: [
      { name: "商品マスタ管理", href: "/settings/products", icon: Settings },
      { name: "経費・原価管理", href: "/settings/expenses", icon: DollarSign },
      { name: "API連携設定", href: "/settings/api-integration", icon: Link2 },
    ],
  },
];

function CollapsibleSection({ section, pathname }: { section: NavSection; pathname: string }) {
  const hasActive = section.items.some((item) =>
    pathname === item.href || pathname.startsWith(item.href + "/")
  );
  const [open, setOpen] = useState(section.defaultOpen ?? hasActive);

  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen(!open)}
        className="mb-1 flex w-full items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
      >
        <span>{section.section}</span>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {open && section.items.map((subItem) => {
        const isActive = pathname === subItem.href || pathname.startsWith(subItem.href + "/");
        return (
          <Link
            key={subItem.href}
            href={subItem.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-[hsl(var(--accent))] text-[hsl(var(--foreground))]"
                : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
            )}
          >
            <subItem.icon className="h-4 w-4" />
            {subItem.name}
          </Link>
        );
      })}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-56 overflow-y-auto border-r border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <div className="flex h-14 items-center border-b border-[hsl(var(--border))] px-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--primary))] text-sm font-bold text-white">
            N
          </div>
          <div>
            <div className="text-sm font-bold">NXT売上管理</div>
            <div className="text-[10px] text-[hsl(var(--muted-foreground))]">Amazon / 楽天</div>
          </div>
        </Link>
      </div>
      <nav className="flex-1 px-3 py-3">
        {navigation.map((item, i) => {
          if ("href" in item && "name" in item) {
            const navItem = item as NavItem;
            const isActive = pathname === navItem.href;
            return (
              <Link
                key={i}
                href={navItem.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-[hsl(var(--accent))] text-[hsl(var(--foreground))]"
                    : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
                )}
              >
                <navItem.icon className="h-4 w-4" />
                {navItem.name}
              </Link>
            );
          }
          const sectionItem = item as NavSection;

          if (sectionItem.collapsible) {
            return <CollapsibleSection key={i} section={sectionItem} pathname={pathname} />;
          }

          return (
            <div key={i} className="mt-4">
              <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                {sectionItem.section}
              </div>
              {sectionItem.items.map((subItem) => {
                const isActive = pathname === subItem.href;
                return (
                  <Link
                    key={subItem.href}
                    href={subItem.href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-[hsl(var(--accent))] text-[hsl(var(--foreground))]"
                        : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
                    )}
                  >
                    <subItem.icon className="h-4 w-4" />
                    {subItem.name}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
