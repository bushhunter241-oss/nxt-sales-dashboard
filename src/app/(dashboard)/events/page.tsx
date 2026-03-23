"use client";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getProducts } from "@/lib/api/products";
import { getProductEvents, createProductEventsBulk, deleteProductEvent } from "@/lib/api/events";
import { ChevronLeft, ChevronRight, Plus, Trash2, Check } from "lucide-react";

const EVENT_TYPES = [
  { value: "sale", label: "セール", color: "#ef4444" },
  { value: "image_change", label: "画像変更", color: "#3b82f6" },
  { value: "ad_campaign", label: "広告施策", color: "#f59e0b" },
  { value: "price_change", label: "価格変更", color: "#8b5cf6" },
  { value: "listing_update", label: "出品更新", color: "#10b981" },
  { value: "other", label: "その他", color: "#6b7280" },
];

function getEventColor(type: string): string {
  return EVENT_TYPES.find((t) => t.value === type)?.color || "#6b7280";
}
function getEventLabel(type: string): string {
  return EVENT_TYPES.find((t) => t.value === type)?.label || type;
}

export default function EventsPage() {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-indexed
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [form, setForm] = useState({ selectedGroups: [] as string[], endDate: "", event_type: "other", memo: "", product_id: "" });
  const queryClient = useQueryClient();

  const monthStart = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
  const monthEnd = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => getProducts() });
  const { data: events = [] } = useQuery({
    queryKey: ["productEvents", monthStart, monthEnd],
    queryFn: () => getProductEvents({ startDate: monthStart, endDate: monthEnd }),
  });

  const groupOptions = useMemo(() => {
    const groups = new Set<string>();
    for (const p of products as any[]) {
      if (!p.is_archived && p.product_group) groups.add(p.product_group);
    }
    return Array.from(groups).sort().map((g) => ({ value: g, label: g }));
  }, [products]);

  const createMutation = useMutation({
    mutationFn: createProductEventsBulk,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["productEvents"] }); setDialogOpen(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProductEvent,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["productEvents"] }),
  });

  // Build calendar grid
  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    const startDow = firstDay.getDay(); // 0=Sun
    const totalDays = lastDay.getDate();

    const days: Array<{ date: string; day: number; isCurrentMonth: boolean }> = [];

    const fmtDate = (dt: Date) =>
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

    // Fill leading days from previous month
    for (let i = 0; i < startDow; i++) {
      const d = new Date(viewYear, viewMonth, -startDow + i + 1);
      days.push({ date: fmtDate(d), day: d.getDate(), isCurrentMonth: false });
    }
    // Current month
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ date: dateStr, day: d, isCurrentMonth: true });
    }
    // Fill trailing days
    while (days.length % 7 !== 0) {
      const d = new Date(viewYear, viewMonth + 1, days.length - startDow - totalDays + 1);
      days.push({ date: fmtDate(d), day: d.getDate(), isCurrentMonth: false });
    }
    return days;
  }, [viewYear, viewMonth]);

  // Group events by date
  const eventsByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const e of events as any[]) {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    }
    return map;
  }, [events]);

  // Grouped events for calendar display: merge same event_type + memo into one block
  const groupedEventsByDate = useMemo(() => {
    const result: Record<string, Array<{ event_type: string; memo: string; count: number; groups: string[] }>> = {};
    for (const [date, evts] of Object.entries(eventsByDate)) {
      const buckets = new Map<string, { event_type: string; memo: string; count: number; groups: string[] }>();
      for (const ev of evts) {
        const key = `${ev.event_type}||${ev.memo || ""}`;
        if (!buckets.has(key)) {
          buckets.set(key, { event_type: ev.event_type, memo: ev.memo || "", count: 0, groups: [] });
        }
        const b = buckets.get(key)!;
        b.count++;
        if (!b.groups.includes(ev.product_group)) b.groups.push(ev.product_group);
      }
      result[date] = Array.from(buckets.values());
    }
    return result;
  }, [eventsByDate]);

  const todayStr = now.toISOString().split("T")[0];

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0); }
    else setViewMonth(viewMonth + 1);
  };

  const openCreateDialog = (date: string) => {
    setSelectedDate(date);
    setForm({ selectedGroups: [], endDate: date, event_type: "other", memo: "", product_id: "" });
    setDialogOpen(true);
  };

  const toggleGroup = (group: string) => {
    setForm((f) => ({
      ...f,
      selectedGroups: f.selectedGroups.includes(group)
        ? f.selectedGroups.filter((g) => g !== group)
        : [...f.selectedGroups, group],
    }));
  };

  const toggleAllGroups = () => {
    setForm((f) => ({
      ...f,
      selectedGroups: f.selectedGroups.length === groupOptions.length
        ? []
        : groupOptions.map((g) => g.value),
    }));
  };

  // Events for selected date (shown below calendar)
  const [focusDate, setFocusDate] = useState("");
  const focusEvents = focusDate ? (eventsByDate[focusDate] || []) : [];

  return (
    <div>
      <PageHeader title="施策カレンダー" description="マーケティング施策・イベントの管理" />

      <Card>
        <CardContent className="p-4">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-4">
            <Button variant="ghost" size="sm" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
            <h2 className="text-lg font-bold">{viewYear}年{viewMonth + 1}月</h2>
            <Button variant="ghost" size="sm" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-px bg-[hsl(var(--border))] rounded-lg overflow-hidden">
            {["日", "月", "火", "水", "木", "金", "土"].map((dow) => (
              <div key={dow} className="bg-[hsl(var(--muted))] p-2 text-center text-xs font-medium text-[hsl(var(--muted-foreground))]">{dow}</div>
            ))}
            {calendarDays.map((cell, i) => {
              const grouped = groupedEventsByDate[cell.date] || [];
              const isToday = cell.date === todayStr;
              const isFocused = cell.date === focusDate;
              return (
                <div
                  key={i}
                  className={`bg-[hsl(var(--card))] min-h-[80px] p-1 cursor-pointer transition-colors hover:bg-[hsl(var(--muted))/0.5] ${
                    !cell.isCurrentMonth ? "opacity-30" : ""
                  } ${isFocused ? "ring-2 ring-[hsl(var(--primary))] ring-inset" : ""}`}
                  onClick={() => setFocusDate(cell.date)}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-medium ${isToday ? "bg-[hsl(var(--primary))] text-white rounded-full w-5 h-5 flex items-center justify-center" : ""}`}>
                      {cell.day}
                    </span>
                    {cell.isCurrentMonth && (
                      <button
                        className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]"
                        onClick={(e) => { e.stopPropagation(); openCreateDialog(cell.date); }}
                        style={{ opacity: 0.3 }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.3")}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <div className="mt-0.5 space-y-0.5">
                    {grouped.slice(0, 2).map((g, gi) => (
                      <div
                        key={gi}
                        className="rounded px-1 py-0.5 text-white"
                        style={{ backgroundColor: getEventColor(g.event_type) }}
                        title={`[${getEventLabel(g.event_type)}] ${g.memo || ""} (${g.count}件)`}
                      >
                        <div className="flex items-center gap-0.5 text-[10px]">
                          <span className="font-bold truncate">{getEventLabel(g.event_type)}</span>
                          {g.count > 1 && <span className="shrink-0 text-[8px] opacity-80">({g.count})</span>}
                        </div>
                        {g.memo && <div className="text-[9px] leading-tight truncate opacity-90">{g.memo}</div>}
                      </div>
                    ))}
                    {grouped.length > 2 && (
                      <div className="text-[10px] text-[hsl(var(--muted-foreground))]">+{grouped.length - 2}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Day detail panel */}
      <Card className="mt-4">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm">
              {focusDate ? `${focusDate} の施策` : "日付を選択してください"}
            </h3>
            {focusDate && (
              <Button size="sm" onClick={() => openCreateDialog(focusDate)}>
                <Plus className="h-3 w-3 mr-1" />追加
              </Button>
            )}
          </div>
          {focusEvents.length > 0 ? (
            <div className="space-y-2">
              {focusEvents.map((ev: any) => (
                <div key={ev.id} className="flex items-start gap-3 rounded-lg border border-[hsl(var(--border))] p-3">
                  <div
                    className="mt-0.5 rounded px-2 py-0.5 text-xs text-white font-medium whitespace-nowrap"
                    style={{ backgroundColor: getEventColor(ev.event_type) }}
                  >
                    {getEventLabel(ev.event_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {ev.product_group}
                      {ev.product_id && (
                        <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
                          {ev.product_id}
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">{ev.memo || "(メモなし)"}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-400 hover:text-red-500"
                    onClick={() => { if (confirm("この施策を削除しますか？")) deleteMutation.mutate(ev.id); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : focusDate ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">この日の施策はありません</p>
          ) : null}
        </CardContent>
      </Card>

      {/* Create event dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader>
          <DialogTitle>施策を追加</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate({
              startDate: selectedDate,
              endDate: form.endDate || selectedDate,
              productGroups: form.selectedGroups,
              event_type: form.event_type,
              memo: form.memo,
              product_id: form.product_id || null,
            });
          }}
          className="space-y-4"
        >
          {/* Date range */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-[hsl(var(--muted-foreground))]">開始日</label>
              <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-[hsl(var(--muted-foreground))]">終了日</label>
              <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} min={selectedDate} />
            </div>
          </div>

          {/* Product group multi-select */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-[hsl(var(--muted-foreground))]">
                商品グループ ({form.selectedGroups.length}/{groupOptions.length})
              </label>
              <button
                type="button"
                className="text-xs text-[hsl(var(--primary))] hover:underline"
                onClick={toggleAllGroups}
              >
                {form.selectedGroups.length === groupOptions.length ? "すべて解除" : "すべて選択"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto rounded-md border border-[hsl(var(--border))] p-2">
              {groupOptions.map((opt) => {
                const checked = form.selectedGroups.includes(opt.value);
                return (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer transition-colors ${
                      checked ? "bg-[hsl(var(--primary))/0.15] text-[hsl(var(--primary))]" : "hover:bg-[hsl(var(--muted))]"
                    }`}
                  >
                    <div className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${
                      checked ? "bg-[hsl(var(--primary))] border-[hsl(var(--primary))]" : "border-[hsl(var(--border))]"
                    }`}>
                      {checked && <Check className="h-3 w-3 text-white" />}
                    </div>
                    <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleGroup(opt.value)} />
                    <span className="truncate">{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Event type & memo */}
          <div>
            <label className="text-sm text-[hsl(var(--muted-foreground))]">施策タイプ</label>
            <Select
              options={EVENT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
              value={form.event_type}
              onChange={(e) => setForm({ ...form, event_type: e.target.value })}
            />
          </div>
          <div>
            <label className="text-sm text-[hsl(var(--muted-foreground))]">メモ</label>
            <Input
              value={form.memo}
              onChange={(e) => setForm({ ...form, memo: e.target.value })}
              placeholder="例: タイムセール3日間 / メイン画像変更"
            />
          </div>
          <div>
            <label className="text-sm text-[hsl(var(--muted-foreground))]">商品ID（個別指定・任意）</label>
            <Input
              value={form.product_id}
              onChange={(e) => setForm({ ...form, product_id: e.target.value })}
              placeholder="例: sage30（空欄ならグループ全体に適用）"
            />
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
              特定商品だけ割引率を変えたい場合に指定
            </p>
          </div>

          {/* Summary & submit */}
          {form.selectedGroups.length > 0 && (
            <div className="rounded-md bg-[hsl(var(--muted))] p-2 text-xs text-[hsl(var(--muted-foreground))]">
              {(() => {
                const start = new Date(selectedDate + "T00:00:00Z");
                const end = new Date((form.endDate || selectedDate) + "T00:00:00Z");
                const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
                return `${days}日間 × ${form.selectedGroups.length}グループ = ${days * form.selectedGroups.length}件 のイベントを登録`;
              })()}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>キャンセル</Button>
            <Button type="submit" disabled={form.selectedGroups.length === 0 || createMutation.isPending}>
              {createMutation.isPending ? "保存中..." : "保存"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
