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
import { getRakutenProducts } from "@/lib/api/rakuten-products";
import { getProductEvents, createProductEventsBulk, deleteProductEvent } from "@/lib/api/events";
import { ChevronLeft, ChevronRight, Plus, Trash2, Check } from "lucide-react";

const EVENT_TYPES = [
  { value: "coupon", label: "クーポン", icon: "🏷️", color: "#ef4444" },
  { value: "time_sale", label: "タイムセール", icon: "⚡", color: "#f97316" },
  { value: "point", label: "ポイント", icon: "💰", color: "#eab308" },
  { value: "price_change", label: "価格改定", icon: "💲", color: "#8b5cf6" },
  { value: "ad_change", label: "広告変更", icon: "📢", color: "#22c55e" },
  { value: "image_change", label: "画像変更", icon: "🖼️", color: "#3b82f6" },
  { value: "other", label: "その他", icon: "📌", color: "#6b7280" },
  // 旧互換
  { value: "sale", label: "セール", icon: "🏷️", color: "#ef4444" },
  { value: "ad_campaign", label: "広告施策", icon: "📢", color: "#22c55e" },
  { value: "listing_update", label: "出品更新", icon: "📌", color: "#6b7280" },
];

const DISCOUNT_TYPES = ["coupon", "time_sale", "point", "sale"];

const CHANNEL_OPTIONS = [
  { value: "both", label: "両方" },
  { value: "amazon", label: "Amazon" },
  { value: "rakuten", label: "楽天" },
];

function getEventMeta(type: string) {
  return EVENT_TYPES.find(t => t.value === type) || EVENT_TYPES[EVENT_TYPES.length - 1];
}

export default function EventsPage() {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [focusDate, setFocusDate] = useState("");
  const [form, setForm] = useState({
    title: "",
    selectedGroups: [] as string[],
    endDate: "",
    event_type: "coupon",
    discount_rate: 0,
    channel: "both",
    memo: "",
    product_id: "",
  });
  const queryClient = useQueryClient();

  const monthStart = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
  const monthEnd = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => getProducts() });
  const { data: rktProducts = [] } = useQuery({ queryKey: ["rakutenProducts"], queryFn: () => getRakutenProducts() });
  const { data: events = [] } = useQuery({
    queryKey: ["productEvents", monthStart, monthEnd],
    queryFn: () => getProductEvents({ startDate: monthStart, endDate: monthEnd }),
  });

  // 全商品グループ（Amazon + 楽天統合）
  const groupOptions = useMemo(() => {
    const groups = new Set<string>();
    for (const p of products as any[]) { if (!p.is_archived && p.product_group) groups.add(p.product_group); }
    for (const p of rktProducts as any[]) { if (!p.is_archived && p.product_group) groups.add(p.product_group); }
    return Array.from(groups).sort().map(g => ({ value: g, label: g }));
  }, [products, rktProducts]);

  const createMutation = useMutation({
    mutationFn: createProductEventsBulk,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["productEvents"] }); setDialogOpen(false); },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteProductEvent,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["productEvents"] }),
  });

  // Calendar grid
  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastD = new Date(viewYear, viewMonth + 1, 0);
    const startDow = firstDay.getDay();
    const totalDays = lastD.getDate();
    const days: Array<{ date: string; day: number; isCurrentMonth: boolean }> = [];
    const fmtDate = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    for (let i = 0; i < startDow; i++) { const d = new Date(viewYear, viewMonth, -startDow + i + 1); days.push({ date: fmtDate(d), day: d.getDate(), isCurrentMonth: false }); }
    for (let d = 1; d <= totalDays; d++) { days.push({ date: `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`, day: d, isCurrentMonth: true }); }
    while (days.length % 7 !== 0) { const d = new Date(viewYear, viewMonth + 1, days.length - startDow - totalDays + 1); days.push({ date: fmtDate(d), day: d.getDate(), isCurrentMonth: false }); }
    return days;
  }, [viewYear, viewMonth]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const e of events as any[]) { if (!map[e.date]) map[e.date] = []; map[e.date].push(e); }
    return map;
  }, [events]);

  // Grouped display for calendar cells
  const groupedEventsByDate = useMemo(() => {
    const result: Record<string, Array<{ event_type: string; title: string; memo: string; discount_rate: number; count: number; groups: string[] }>> = {};
    for (const [date, evts] of Object.entries(eventsByDate)) {
      const buckets = new Map<string, { event_type: string; title: string; memo: string; discount_rate: number; count: number; groups: string[] }>();
      for (const ev of evts) {
        const key = `${ev.event_type}||${ev.title || ev.memo || ""}`;
        if (!buckets.has(key)) buckets.set(key, { event_type: ev.event_type, title: ev.title || "", memo: ev.memo || "", discount_rate: ev.discount_rate || 0, count: 0, groups: [] });
        const b = buckets.get(key)!;
        b.count++;
        if (!b.groups.includes(ev.product_group)) b.groups.push(ev.product_group);
      }
      result[date] = Array.from(buckets.values());
    }
    return result;
  }, [eventsByDate]);

  const todayStr = now.toISOString().split("T")[0];
  const prevMonth = () => { if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11); } else setViewMonth(viewMonth - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0); } else setViewMonth(viewMonth + 1); };

  const openCreateDialog = (date: string) => {
    setSelectedDate(date);
    setForm({ title: "", selectedGroups: [], endDate: date, event_type: "coupon", discount_rate: 0, channel: "both", memo: "", product_id: "" });
    setDialogOpen(true);
  };

  const toggleGroup = (group: string) => setForm(f => ({ ...f, selectedGroups: f.selectedGroups.includes(group) ? f.selectedGroups.filter(g => g !== group) : [...f.selectedGroups, group] }));
  const toggleAllGroups = () => setForm(f => ({ ...f, selectedGroups: f.selectedGroups.length === groupOptions.length ? [] : groupOptions.map(g => g.value) }));

  const focusEvents = focusDate ? (eventsByDate[focusDate] || []) : [];
  const showDiscount = DISCOUNT_TYPES.includes(form.event_type);

  return (
    <div>
      <PageHeader title="施策カレンダー" description="マーケティング施策・イベントの管理" />

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <Button variant="ghost" size="sm" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
            <h2 className="text-lg font-bold">{viewYear}年{viewMonth + 1}月</h2>
            <Button variant="ghost" size="sm" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
          </div>

          <div className="grid grid-cols-7 gap-px bg-[hsl(var(--border))] rounded-lg overflow-hidden">
            {["日", "月", "火", "水", "木", "金", "土"].map(dow => (
              <div key={dow} className="bg-[hsl(var(--muted))] p-2 text-center text-xs font-medium text-[hsl(var(--muted-foreground))]">{dow}</div>
            ))}
            {calendarDays.map((cell, i) => {
              const grouped = groupedEventsByDate[cell.date] || [];
              const isToday = cell.date === todayStr;
              const isFocused = cell.date === focusDate;
              return (
                <div key={i} className={`bg-[hsl(var(--card))] min-h-[80px] p-1 cursor-pointer transition-colors hover:bg-[hsl(var(--muted))/0.5] ${!cell.isCurrentMonth ? "opacity-30" : ""} ${isFocused ? "ring-2 ring-[hsl(var(--primary))] ring-inset" : ""}`} onClick={() => setFocusDate(cell.date)}>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-medium ${isToday ? "bg-[hsl(var(--primary))] text-white rounded-full w-5 h-5 flex items-center justify-center" : ""}`}>{cell.day}</span>
                    {cell.isCurrentMonth && (
                      <button className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] opacity-30 hover:opacity-100" onClick={(e) => { e.stopPropagation(); openCreateDialog(cell.date); }}>
                        <Plus className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <div className="mt-0.5 space-y-0.5">
                    {grouped.slice(0, 2).map((g, gi) => {
                      const meta = getEventMeta(g.event_type);
                      return (
                        <div key={gi} className="rounded px-1 py-0.5 text-white" style={{ backgroundColor: meta.color }}
                          title={`${meta.icon} ${g.title || meta.label} ${g.discount_rate > 0 ? g.discount_rate + "%OFF" : ""} (${g.groups.length}グループ)`}>
                          <div className="flex items-center gap-0.5 text-[10px]">
                            <span>{meta.icon}</span>
                            <span className="font-bold truncate">{g.title || meta.label}</span>
                            {g.discount_rate > 0 && <span className="text-[8px]">{g.discount_rate}%</span>}
                            {g.groups.length > 1 && <span className="shrink-0 text-[8px] opacity-80">({g.groups.length})</span>}
                          </div>
                        </div>
                      );
                    })}
                    {grouped.length > 2 && <div className="text-[10px] text-[hsl(var(--muted-foreground))]">+{grouped.length - 2}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Day detail */}
      <Card className="mt-4">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm">{focusDate ? `${focusDate} の施策` : "日付を選択してください"}</h3>
            {focusDate && <Button size="sm" onClick={() => openCreateDialog(focusDate)}><Plus className="h-3 w-3 mr-1" />追加</Button>}
          </div>
          {focusEvents.length > 0 ? (
            <div className="space-y-2">
              {focusEvents.map((ev: any) => {
                const meta = getEventMeta(ev.event_type);
                const chLabel = ev.channel === "amazon" ? "Amazon" : ev.channel === "rakuten" ? "楽天" : "両方";
                return (
                  <div key={ev.id} className="flex items-start gap-3 rounded-lg border border-[hsl(var(--border))] p-3">
                    <div className="mt-0.5 rounded px-2 py-0.5 text-xs text-white font-medium whitespace-nowrap" style={{ backgroundColor: meta.color }}>
                      {meta.icon} {meta.label}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">
                        {ev.title && <span className="mr-2">{ev.title}</span>}
                        {ev.discount_rate > 0 && <span className="text-xs text-[hsl(var(--primary))]">{ev.discount_rate}%OFF</span>}
                      </p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        {ev.product_group}
                        <span className="ml-2">{chLabel}</span>
                        {ev.product_id && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-[hsl(var(--muted))]">{ev.product_id}</span>}
                      </p>
                      {ev.memo && <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{ev.memo}</p>}
                    </div>
                    <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-500" onClick={() => { if (confirm("削除しますか？")) deleteMutation.mutate(ev.id); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : focusDate ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">この日の施策はありません</p>
          ) : null}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader>
          <DialogTitle>施策を追加</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate({
            startDate: selectedDate,
            endDate: form.endDate || selectedDate,
            productGroups: form.selectedGroups,
            event_type: form.event_type,
            title: form.title,
            discount_rate: form.discount_rate,
            channel: form.channel,
            memo: form.memo,
            product_id: form.product_id || null,
          });
        }} className="space-y-4">
          {/* Title */}
          <div>
            <label className="text-sm text-[hsl(var(--muted-foreground))]">タイトル</label>
            <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="例: 新生活セール" />
          </div>

          {/* Type + Discount + Channel */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-sm text-[hsl(var(--muted-foreground))]">施策種別</label>
              <Select
                options={EVENT_TYPES.filter(t => !["sale", "ad_campaign", "listing_update"].includes(t.value)).map(t => ({ value: t.value, label: `${t.icon} ${t.label}` }))}
                value={form.event_type}
                onChange={e => setForm({ ...form, event_type: e.target.value })}
              />
            </div>
            {showDiscount && (
              <div>
                <label className="text-sm text-[hsl(var(--muted-foreground))]">割引率 (%)</label>
                <Input type="number" min={0} max={100} value={form.discount_rate} onChange={e => setForm({ ...form, discount_rate: Number(e.target.value) })} />
              </div>
            )}
            <div>
              <label className="text-sm text-[hsl(var(--muted-foreground))]">チャネル</label>
              <div className="flex gap-2 mt-1">
                {CHANNEL_OPTIONS.map(opt => (
                  <label key={opt.value} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs cursor-pointer border transition-colors ${form.channel === opt.value ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))/0.15] text-[hsl(var(--primary))]" : "border-[hsl(var(--border))]"}`}>
                    <input type="radio" name="channel" value={opt.value} checked={form.channel === opt.value} onChange={() => setForm({ ...form, channel: opt.value })} className="sr-only" />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Product groups */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-[hsl(var(--muted-foreground))]">商品グループ ({form.selectedGroups.length}/{groupOptions.length})</label>
              <button type="button" className="text-xs text-[hsl(var(--primary))] hover:underline" onClick={toggleAllGroups}>
                {form.selectedGroups.length === groupOptions.length ? "全解除" : "全選択"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto rounded-md border border-[hsl(var(--border))] p-2">
              {groupOptions.map(opt => {
                const checked = form.selectedGroups.includes(opt.value);
                return (
                  <label key={opt.value} className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer transition-colors ${checked ? "bg-[hsl(var(--primary))/0.15] text-[hsl(var(--primary))]" : "hover:bg-[hsl(var(--muted))]"}`}>
                    <div className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${checked ? "bg-[hsl(var(--primary))] border-[hsl(var(--primary))]" : "border-[hsl(var(--border))]"}`}>
                      {checked && <Check className="h-3 w-3 text-white" />}
                    </div>
                    <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleGroup(opt.value)} />
                    <span className="truncate">{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">開始日</label><Input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">終了日</label><Input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} min={selectedDate} /></div>
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

          {/* Memo & product_id */}
          <div>
            <label className="text-sm text-[hsl(var(--muted-foreground))]">メモ</label>
            <Input value={form.memo} onChange={e => setForm({ ...form, memo: e.target.value })} placeholder="例: 新生活セール。全商品5%OFFクーポン配布" />
          </div>
          <div>
            <label className="text-sm text-[hsl(var(--muted-foreground))]">商品ID（個別指定・任意）</label>
            <Input value={form.product_id} onChange={e => setForm({ ...form, product_id: e.target.value })} placeholder="空欄ならグループ全体に適用" />
          </div>

          {/* Summary */}
          {form.selectedGroups.length > 0 && (
            <div className="rounded-md bg-[hsl(var(--muted))] p-2 text-xs text-[hsl(var(--muted-foreground))]">
              {(() => {
                const start = new Date(selectedDate + "T00:00:00Z");
                const end = new Date((form.endDate || selectedDate) + "T00:00:00Z");
                const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
                const meta = getEventMeta(form.event_type);
                return `${meta.icon} ${form.title || meta.label}${form.discount_rate > 0 ? ` ${form.discount_rate}%OFF` : ""} × ${days}日間 × ${form.selectedGroups.length}グループ = ${days * form.selectedGroups.length}件`;
              })()}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>キャンセル</Button>
            <Button type="submit" disabled={form.selectedGroups.length === 0 || createMutation.isPending}>
              {createMutation.isPending ? "保存中..." : "登録する"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
