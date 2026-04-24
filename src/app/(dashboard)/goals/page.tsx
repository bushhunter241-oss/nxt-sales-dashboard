"use client";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { getProducts } from "@/lib/api/products";
import { getMonthlyGoals, upsertGroupGoal } from "@/lib/api/goals";
import { getProductSalesSummary } from "@/lib/api/sales";
import { getRakutenProductSalesSummary } from "@/lib/api/rakuten-sales";
import { getShopifyDailySummary } from "@/lib/api/shopify-sales";
import { Target, ChevronRight, ChevronDown, Sparkles, Loader2 } from "lucide-react";

function getYearMonthOptions() {
  const options = [];
  const now = new Date();
  for (let i = -3; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    options.push({ value: ym, label: ym });
  }
  return options;
}

type Channel = "amazon" | "rakuten" | "shopify" | "total";

interface GroupData {
  groupName: string;
  amazon: { sales: number; orders: number };
  rakuten: { sales: number; orders: number };
  shopify: { sales: number; orders: number };
  totalSales: number;
  totalOrders: number;
  goals: Record<Channel, { target_sales: number; target_orders: number; target_profit: number; target_ad_budget: number } | null>;
}

export default function GoalsPage() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editingChannel, setEditingChannel] = useState<Channel>("total");
  const [form, setForm] = useState({ target_sales: 0, target_orders: 0, target_profit: 0, target_ad_budget: 0 });

  // AI提案ダイアログ
  const [aiOpen, setAiOpen] = useState(false);
  const [aiGroup, setAiGroup] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiProposals, setAiProposals] = useState<any[]>([]);
  const [aiInsight, setAiInsight] = useState<string>("");
  const [aiPrevStats, setAiPrevStats] = useState<any>(null);

  const queryClient = useQueryClient();

  const monthStart = `${selectedMonth}-01`;
  const monthEnd = new Date(parseInt(selectedMonth.split("-")[0]), parseInt(selectedMonth.split("-")[1]), 0).toISOString().split("T")[0];

  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => getProducts() });
  const { data: goals = [] } = useQuery({ queryKey: ["goals", selectedMonth], queryFn: () => getMonthlyGoals(selectedMonth) });
  const { data: amazonSummary = [] } = useQuery({
    queryKey: ["productSummaryGoals", monthStart, monthEnd],
    queryFn: () => getProductSalesSummary({ startDate: monthStart, endDate: monthEnd }),
  });
  const { data: rakutenSummary = [] } = useQuery({
    queryKey: ["rakutenProductSummaryGoals", monthStart, monthEnd],
    queryFn: () => getRakutenProductSalesSummary({ startDate: monthStart, endDate: monthEnd }),
  });
  const { data: shopifySummary = [] } = useQuery({
    queryKey: ["shopifyDailySummaryGoals", monthStart, monthEnd],
    queryFn: () => getShopifyDailySummary({ startDate: monthStart, endDate: monthEnd }),
  });

  // Shopify売上合計（feela.専用）
  const shopifySales = (shopifySummary as any[]).reduce((s: number, d: any) => s + (d.net_sales || 0), 0);
  const shopifyOrders = (shopifySummary as any[]).reduce((s: number, d: any) => s + (d.total_orders || 0), 0);

  const goalMutation = useMutation({
    mutationFn: (data: { groupName: string; channel: Channel; target_sales: number; target_orders: number; target_profit: number; target_ad_budget: number }) =>
      upsertGroupGoal({
        product_group: data.groupName,
        year_month: selectedMonth,
        target_sales: data.target_sales,
        target_orders: data.target_orders,
        target_profit: data.target_profit,
        target_ad_budget: data.target_ad_budget,
        channel: data.channel,
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["goals"] }); setDialogOpen(false); },
    onError: (error: any) => { alert(`目標の保存に失敗しました: ${error.message || "不明なエラー"}`); console.error("Goal save error:", error); },
  });

  const groupedData = useMemo(() => {
    const groups = new Map<string, GroupData>();
    const empty = () => ({ sales: 0, orders: 0 });

    const ensure = (gn: string) => { if (!groups.has(gn)) groups.set(gn, { groupName: gn, amazon: empty(), rakuten: empty(), shopify: empty(), totalSales: 0, totalOrders: 0, goals: { amazon: null, rakuten: null, shopify: null, total: null } }); };

    for (const product of products as any[]) {
      if (product.is_archived || product.is_parent) continue;
      const gn = product.product_group || product.name;
      ensure(gn);
      const g = groups.get(gn)!;
      const actual = (amazonSummary as any[]).find((p: any) => p.product?.id === product.id);
      g.amazon.sales += actual?.total_sales || 0;
      g.amazon.orders += actual?.total_orders || 0;
      g.totalSales += actual?.total_sales || 0;
      g.totalOrders += actual?.total_orders || 0;
    }

    for (const ps of rakutenSummary as any[]) {
      if (ps.product?.is_archived) continue;
      const gn = ps.product?.product_group || ps.product?.name || "その他";
      ensure(gn);
      const g = groups.get(gn)!;
      g.rakuten.sales += ps.total_sales || 0;
      g.rakuten.orders += ps.total_orders || 0;
      g.totalSales += ps.total_sales || 0;
      g.totalOrders += ps.total_orders || 0;
    }

    // Shopify売上をfeelaに加算
    if (shopifySales > 0) {
      ensure("feela");
      const g = groups.get("feela")!;
      g.shopify.sales += shopifySales;
      g.shopify.orders += shopifyOrders;
      g.totalSales += shopifySales;
      g.totalOrders += shopifyOrders;
    }

    for (const goal of goals as any[]) {
      if (!goal.product_group || goal.product_id) continue;
      const g = groups.get(goal.product_group);
      if (!g) continue;
      const ch = (goal.channel || "total") as Channel;
      g.goals[ch] = { target_sales: goal.target_sales || 0, target_orders: goal.target_orders || 0, target_profit: goal.target_profit || 0, target_ad_budget: goal.target_ad_budget || 0 };
    }

    // total行が未設定 or 0の場合、チャネル別合計を自動計算
    for (const g of groups.values()) {
      const channelSum = {
        target_sales: (g.goals.amazon?.target_sales || 0) + (g.goals.rakuten?.target_sales || 0) + (g.goals.shopify?.target_sales || 0),
        target_orders: (g.goals.amazon?.target_orders || 0) + (g.goals.rakuten?.target_orders || 0) + (g.goals.shopify?.target_orders || 0),
        target_profit: (g.goals.amazon?.target_profit || 0) + (g.goals.rakuten?.target_profit || 0) + (g.goals.shopify?.target_profit || 0),
        target_ad_budget: (g.goals.amazon?.target_ad_budget || 0) + (g.goals.rakuten?.target_ad_budget || 0) + (g.goals.shopify?.target_ad_budget || 0),
      };
      if (!g.goals.total || g.goals.total.target_sales === 0) {
        if (channelSum.target_sales > 0) {
          g.goals.total = { ...channelSum, _auto: true } as any;
        }
      }
    }

    return Array.from(groups.values()).sort((a, b) => b.totalSales - a.totalSales);
  }, [products, amazonSummary, rakutenSummary, goals, shopifySales, shopifyOrders]);

  const toggleGroup = (name: string) => setExpandedGroups(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });

  // グループの実績指標を取得（自動計算用）
  const getGroupMetrics = (groupName: string | null) => {
    if (!groupName) return { profitRate: 0, avgPrice: 0, canCalc: false };
    const group = groupedData.find(g => g.groupName === groupName);
    if (!group || group.totalSales <= 0) return { profitRate: 0, avgPrice: 0, canCalc: false };
    // 実績利益率（Amazon+楽天合算のproductSummaryベース）
    const amzProfit = (amazonSummary as any[]).filter((p: any) => {
      const pg = p.product?.product_group || p.product?.name;
      return pg === groupName;
    }).reduce((s: number, p: any) => s + (p.net_profit || 0), 0);
    const rktProfit = (rakutenSummary as any[]).filter((p: any) => {
      const pg = p.product?.product_group || p.product?.name;
      return pg === groupName;
    }).reduce((s: number, p: any) => s + (p.net_profit || 0), 0);
    const totalProfit = amzProfit + rktProfit;
    const profitRate = group.totalSales > 0 ? totalProfit / group.totalSales : 0;
    const avgPrice = group.totalOrders > 0 ? Math.round(group.totalSales / group.totalOrders) : 0;
    return { profitRate, avgPrice, canCalc: avgPrice > 0 && profitRate !== 0 };
  };

  // 指定月の商品グループ実績を集計
  const fetchMonthStats = async (ym: string, groupName: string) => {
    const [y, m] = ym.split("-").map(Number);
    const start = `${ym}-01`;
    const end = new Date(y, m, 0).toISOString().split("T")[0];
    const [amz, rkt, shp] = await Promise.all([
      getProductSalesSummary({ startDate: start, endDate: end }),
      getRakutenProductSalesSummary({ startDate: start, endDate: end }),
      getShopifyDailySummary({ startDate: start, endDate: end }),
    ]);
    let sales = 0, orders = 0, profit = 0, adSpend = 0;
    for (const p of amz as any[]) {
      const gn = p.product?.product_group || p.product?.name;
      if (gn === groupName) {
        sales += p.total_sales || 0;
        orders += p.total_orders || 0;
        profit += p.net_profit || 0;
        adSpend += p.total_ad_spend || 0;
      }
    }
    for (const p of rkt as any[]) {
      const gn = p.product?.product_group || p.product?.name;
      if (gn === groupName) {
        sales += p.total_sales || 0;
        orders += p.total_orders || 0;
        profit += p.net_profit || 0;
        adSpend += p.total_ad_spend || 0;
      }
    }
    if (groupName === "feela") {
      const shpSales = (shp as any[]).reduce((s, d) => s + (d.net_sales || 0), 0);
      const shpOrders = (shp as any[]).reduce((s, d) => s + (d.total_orders || 0), 0);
      sales += shpSales;
      orders += shpOrders;
    }
    return {
      yearMonth: ym,
      sales, orders, profit, adSpend,
      profitRate: sales > 0 ? profit / sales : 0,
      avgPrice: orders > 0 ? Math.round(sales / orders) : 0,
    };
  };

  const openAiDialog = async (groupName: string) => {
    setAiOpen(true);
    setAiGroup(groupName);
    setAiLoading(true);
    setAiError(null);
    setAiProposals([]);
    setAiInsight("");
    setAiPrevStats(null);
    try {
      const [y, m] = selectedMonth.split("-").map(Number);
      const prev = new Date(y, m - 2, 1);
      const prevYm = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
      const twoPrev = new Date(y, m - 3, 1);
      const twoPrevYm = `${twoPrev.getFullYear()}-${String(twoPrev.getMonth() + 1).padStart(2, "0")}`;

      const [lastStats, twoStats] = await Promise.all([
        fetchMonthStats(prevYm, groupName),
        fetchMonthStats(twoPrevYm, groupName).catch(() => null),
      ]);
      setAiPrevStats(lastStats);

      if (lastStats.sales === 0) {
        setAiError(`${prevYm} の実績データがありません。手動で目標を設定してください。`);
        setAiLoading(false);
        return;
      }

      const res = await fetch("/api/ai/suggest-goal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupName,
          channel: "total",
          targetMonth: selectedMonth,
          lastMonth: lastStats,
          twoMonthsAgo: twoStats && twoStats.sales > 0 ? twoStats : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "AI提案の取得に失敗しました");
      }
      const json = await res.json();
      setAiProposals(json.proposals || []);
      setAiInsight(json.insight || "");
    } catch (err: any) {
      setAiError(err.message || "エラーが発生しました");
    } finally {
      setAiLoading(false);
    }
  };

  const applyAiProposal = (proposal: any) => {
    if (!aiGroup) return;
    goalMutation.mutate({
      groupName: aiGroup,
      channel: "total",
      target_sales: proposal.target_sales || 0,
      target_orders: proposal.target_orders || 0,
      target_profit: proposal.target_profit || 0,
      target_ad_budget: proposal.target_ad_budget || 0,
    }, {
      onSuccess: () => {
        setAiOpen(false);
        queryClient.invalidateQueries({ queryKey: ["goals"] });
      },
    });
  };

  const openGoalDialog = (groupName: string, channel: Channel) => {
    const group = groupedData.find(g => g.groupName === groupName);
    const goal = group?.goals[channel];
    setEditingGroup(groupName);
    setEditingChannel(channel);
    setForm({ target_sales: goal?.target_sales || 0, target_orders: goal?.target_orders || 0, target_profit: goal?.target_profit || 0, target_ad_budget: goal?.target_ad_budget || 0 });
    setDialogOpen(true);
  };

  // 自動計算ハンドラ
  const handleSalesChange = (sales: number) => {
    const m = getGroupMetrics(editingGroup);
    setForm(f => ({
      ...f,
      target_sales: sales,
      ...(m.canCalc && sales > 0 ? {
        target_profit: Math.round(sales * m.profitRate),
        target_orders: m.avgPrice > 0 ? Math.round(sales / m.avgPrice) : f.target_orders,
      } : {}),
    }));
  };

  const handleProfitChange = (profit: number) => {
    const m = getGroupMetrics(editingGroup);
    setForm(f => ({
      ...f,
      target_profit: profit,
      ...(m.canCalc && profit !== 0 && m.profitRate !== 0 ? {
        target_sales: Math.round(profit / m.profitRate),
        target_orders: m.avgPrice > 0 ? Math.round(profit / m.profitRate / m.avgPrice) : f.target_orders,
      } : {}),
    }));
  };

  const handleOrdersChange = (orders: number) => {
    const m = getGroupMetrics(editingGroup);
    setForm(f => ({
      ...f,
      target_orders: orders,
      ...(m.canCalc && orders > 0 ? {
        target_sales: orders * m.avgPrice,
        target_profit: Math.round(orders * m.avgPrice * m.profitRate),
      } : {}),
    }));
  };

  const overallTarget = groupedData.reduce((s, g) => s + (g.goals.total?.target_sales || 0), 0);
  const overallOrdersTarget = groupedData.reduce((s, g) => s + (g.goals.total?.target_orders || 0), 0);
  const totalActualSales = groupedData.reduce((s, g) => s + g.totalSales, 0);
  const totalActualOrders = groupedData.reduce((s, g) => s + g.totalOrders, 0);
  const groupsWithGoal = groupedData.filter(g => g.goals.total?.target_sales);
  const groupsWithoutGoal = groupedData.filter(g => !g.goals.total?.target_sales && g.totalSales > 0);

  const daysInMonth = new Date(parseInt(selectedMonth.split("-")[0]), parseInt(selectedMonth.split("-")[1]), 0).getDate();
  const daysPassed = selectedMonth === currentMonth ? now.getDate() : (selectedMonth < currentMonth ? daysInMonth : 0);
  const dailyPace = daysPassed > 0 ? totalActualSales / daysPassed : 0;
  const projected = Math.round(dailyPace * daysInMonth);
  const overallPct = overallTarget > 0 ? (totalActualSales / overallTarget) * 100 : 0;

  const chLabel = (ch: Channel) => ch === "amazon" ? "Amazon" : ch === "rakuten" ? "楽天" : ch === "shopify" ? "Shopify" : "合計";
  const chBadge = (ch: Channel) => ch === "amazon" ? "bg-orange-500/20 text-orange-400" : ch === "rakuten" ? "bg-red-500/20 text-red-400" : ch === "shopify" ? "bg-green-500/20 text-green-400" : "bg-blue-500/20 text-blue-400";

  return (
    <div>
      <PageHeader title="目標・進捗管理" description="月間目標の設定と達成率の確認">
        <Select options={getYearMonthOptions()} value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="w-40" />
      </PageHeader>

      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-2">
            <Target className="h-6 w-6 text-[hsl(var(--primary))]" />
            <h3 className="text-lg font-bold">
              目標設定済み: {formatCurrency(overallTarget)}
              <span className="ml-2 text-sm font-normal text-[hsl(var(--muted-foreground))]">
                ({groupsWithGoal.length}グループ)
              </span>
            </h3>
          </div>
          {groupsWithoutGoal.length > 0 && (
            <p className="text-xs text-[hsl(var(--warning))] mb-3">
              ⚠ {groupsWithoutGoal.map(g => g.groupName).join(", ")} の目標が未設定です
            </p>
          )}
          <p className="text-xs text-[hsl(var(--muted-foreground))] mb-3">
            全グループ売上実績: {formatCurrency(totalActualSales)}
          </p>
          {overallTarget > 0 ? (
            <>
              <div className="mb-2 flex justify-between text-sm">
                <span>売上達成: {formatCurrency(totalActualSales)}</span>
                <span>{formatPercent(overallPct)}</span>
              </div>
              <div className="h-4 w-full rounded-full bg-[hsl(var(--muted))]">
                <div className={`h-4 rounded-full transition-all ${overallPct >= 100 ? "bg-[hsl(var(--success))]" : "bg-[hsl(var(--primary))]"}`} style={{ width: `${Math.min(100, overallPct)}%` }} />
              </div>
              <div className="mt-3 grid grid-cols-4 gap-4 text-sm">
                <div><span className="text-[hsl(var(--muted-foreground))]">経過日数</span><p className="font-medium">{daysPassed}/{daysInMonth}日</p></div>
                <div><span className="text-[hsl(var(--muted-foreground))]">日次ペース</span><p className="font-medium">{formatCurrency(Math.round(dailyPace))}/日</p></div>
                <div><span className="text-[hsl(var(--muted-foreground))]">月末予測</span><p className={`font-medium ${projected >= overallTarget ? "text-[hsl(var(--success))]" : "text-[hsl(var(--warning))]"}`}>{formatCurrency(projected)}</p></div>
                <div><span className="text-[hsl(var(--muted-foreground))]">注文</span><p className="font-medium">{formatNumber(totalActualOrders)} / {overallOrdersTarget > 0 ? formatNumber(overallOrdersTarget) : "-"}</p></div>
              </div>
            </>
          ) : (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">下のテーブルから各商品グループの目標を設定してください。</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>グループ / チャネル</TableHead>
                <TableHead className="text-right">売上目標</TableHead>
                <TableHead className="text-right">売上実績</TableHead>
                <TableHead className="text-right">達成率</TableHead>
                <TableHead className="w-28">進捗</TableHead>
                <TableHead className="text-right">注文目標</TableHead>
                <TableHead className="text-right">注文実績</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupedData.map((group) => {
                const exp = expandedGroups.has(group.groupName);
                const tGoal = group.goals.total;
                const tTarget = tGoal?.target_sales || 0;
                const tOrdTarget = tGoal?.target_orders || 0;
                const ach = tTarget > 0 ? (group.totalSales / tTarget) * 100 : 0;

                return (
                  <tbody key={group.groupName}>
                    <TableRow className="cursor-pointer hover:bg-[hsl(var(--muted))/0.5] font-medium" onClick={() => toggleGroup(group.groupName)}>
                      <TableCell className="px-3">{exp ? <ChevronDown className="h-4 w-4 text-[hsl(var(--muted-foreground))]" /> : <ChevronRight className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />}</TableCell>
                      <TableCell className="font-bold">{group.groupName}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" className={tTarget > 0 ? "" : "text-[hsl(var(--muted-foreground))]"} onClick={(e) => { e.stopPropagation(); openGoalDialog(group.groupName, "total"); }}>
                            {tTarget > 0 ? <>{formatCurrency(tTarget)}{(tGoal as any)?._auto && <span className="ml-1 text-[10px] text-[hsl(var(--muted-foreground))]">自動</span>}</> : "設定"}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-[hsl(var(--primary))]" title="先月の実績をもとにAIが目標を提案" onClick={(e) => { e.stopPropagation(); openAiDialog(group.groupName); }}>
                            <Sparkles className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-[hsl(var(--primary))] font-bold">{formatCurrency(group.totalSales)}</TableCell>
                      <TableCell className={`text-right font-bold ${ach >= 100 ? "text-[hsl(var(--success))]" : ""}`}>{tTarget > 0 ? formatPercent(ach) : "-"}</TableCell>
                      <TableCell>{tTarget > 0 && <div className="h-2.5 w-full rounded-full bg-[hsl(var(--muted))]"><div className={`h-2.5 rounded-full transition-all ${ach >= 100 ? "bg-[hsl(var(--success))]" : ach >= 70 ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--warning))]"}`} style={{ width: `${Math.min(100, ach)}%` }} /></div>}</TableCell>
                      <TableCell className="text-right">{tOrdTarget > 0 ? formatNumber(tOrdTarget) : "-"}</TableCell>
                      <TableCell className="text-right font-bold">{formatNumber(group.totalOrders)}</TableCell>
                    </TableRow>

                    {exp && (["amazon", "rakuten", ...(group.shopify.sales > 0 ? ["shopify" as Channel] : [])] as Channel[]).map(ch => {
                      const sales = ch === "amazon" ? group.amazon.sales : ch === "rakuten" ? group.rakuten.sales : group.shopify.sales;
                      const orders = ch === "amazon" ? group.amazon.orders : ch === "rakuten" ? group.rakuten.orders : group.shopify.orders;
                      const cGoal = group.goals[ch];
                      const cTarget = cGoal?.target_sales || 0;
                      const cOrdTarget = cGoal?.target_orders || 0;
                      const cAch = cTarget > 0 ? (sales / cTarget) * 100 : 0;
                      return (
                        <TableRow key={`${group.groupName}-${ch}`} className="bg-[hsl(var(--muted)/0.15)]">
                          <TableCell></TableCell>
                          <TableCell className="pl-10"><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${chBadge(ch)}`}>{chLabel(ch)}</span></TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="ghost" className={`text-xs ${cTarget > 0 ? "" : "text-[hsl(var(--muted-foreground))]"}`} onClick={() => openGoalDialog(group.groupName, ch)}>
                              {cTarget > 0 ? formatCurrency(cTarget) : "設定"}
                            </Button>
                          </TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(sales)}</TableCell>
                          <TableCell className={`text-right text-sm ${cAch >= 100 ? "text-[hsl(var(--success))]" : ""}`}>{cTarget > 0 ? formatPercent(cAch) : "-"}</TableCell>
                          <TableCell>{cTarget > 0 && <div className="h-1.5 w-full rounded-full bg-[hsl(var(--muted))]"><div className={`h-1.5 rounded-full transition-all ${cAch >= 100 ? "bg-[hsl(var(--success))]" : cAch >= 70 ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--warning))]"}`} style={{ width: `${Math.min(100, cAch)}%` }} /></div>}</TableCell>
                          <TableCell className="text-right text-sm">{cOrdTarget > 0 ? formatNumber(cOrdTarget) : "-"}</TableCell>
                          <TableCell className="text-right text-sm">{formatNumber(orders)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </tbody>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader>
          <DialogTitle>
            {editingGroup} / <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${chBadge(editingChannel)}`}>{chLabel(editingChannel)}</span> の目標設定 ({selectedMonth})
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (editingGroup) goalMutation.mutate({ groupName: editingGroup, channel: editingChannel, ...form }); }} className="space-y-4">
          {(() => {
            const m = getGroupMetrics(editingGroup);
            return m.canCalc ? (
              <div className="rounded-md bg-[hsl(var(--muted))] p-3 text-xs text-[hsl(var(--muted-foreground))]">
                実績利益率: <span className="font-bold">{(m.profitRate * 100).toFixed(1)}%</span>
                　平均単価: <span className="font-bold">{formatCurrency(m.avgPrice)}</span>
                <span className="ml-2 opacity-70">（いずれかを入力 → 他を自動計算）</span>
              </div>
            ) : (
              <div className="rounded-md bg-[hsl(var(--muted))] p-3 text-xs text-[hsl(var(--warning))]">
                実績データが不足のため自動計算できません。手動で入力してください。
              </div>
            );
          })()}
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">売上目標 (円)</label><Input type="number" value={form.target_sales} onChange={(e) => handleSalesChange(Number(e.target.value))} /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">注文数目標</label><Input type="number" value={form.target_orders} onChange={(e) => handleOrdersChange(Number(e.target.value))} /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">利益目標 (円)</label><Input type="number" value={form.target_profit} onChange={(e) => handleProfitChange(Number(e.target.value))} /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">広告予算 (円)</label><Input type="number" value={form.target_ad_budget} onChange={(e) => setForm(f => ({ ...f, target_ad_budget: Number(e.target.value) }))} /></div>
          </div>
          {editingChannel === "total" && <p className="text-xs text-[hsl(var(--muted-foreground))]">合計目標を設定します。チャネル別はグループ展開→個別設定。</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>キャンセル</Button>
            <Button type="submit" disabled={goalMutation.isPending}>{goalMutation.isPending ? "保存中..." : "保存"}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[hsl(var(--primary))]" />
            {aiGroup} のAI目標提案 ({selectedMonth})
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto space-y-4">
          {aiLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-[hsl(var(--muted-foreground))]">
              <Loader2 className="h-8 w-8 animate-spin mb-3" />
              <p className="text-sm">先月のデータを分析中...</p>
            </div>
          )}
          {aiError && (
            <div className="rounded-md border border-[hsl(var(--warning))] bg-[hsl(var(--warning))/0.1] p-4 text-sm text-[hsl(var(--warning))]">
              {aiError}
            </div>
          )}
          {!aiLoading && !aiError && aiPrevStats && (
            <div className="rounded-md bg-[hsl(var(--muted))] p-3 text-xs space-y-1">
              <div className="font-semibold text-[hsl(var(--muted-foreground))] mb-1">先月（{aiPrevStats.yearMonth}）実績</div>
              <div className="grid grid-cols-3 gap-2">
                <div><span className="text-[hsl(var(--muted-foreground))]">売上:</span> <span className="font-medium">{formatCurrency(aiPrevStats.sales)}</span></div>
                <div><span className="text-[hsl(var(--muted-foreground))]">注文:</span> <span className="font-medium">{formatNumber(aiPrevStats.orders)}</span></div>
                <div><span className="text-[hsl(var(--muted-foreground))]">利益:</span> <span className="font-medium">{formatCurrency(aiPrevStats.profit)}</span></div>
                <div><span className="text-[hsl(var(--muted-foreground))]">広告費:</span> <span className="font-medium">{formatCurrency(aiPrevStats.adSpend)}</span></div>
                <div><span className="text-[hsl(var(--muted-foreground))]">利益率:</span> <span className="font-medium">{(aiPrevStats.profitRate * 100).toFixed(1)}%</span></div>
                <div><span className="text-[hsl(var(--muted-foreground))]">平均単価:</span> <span className="font-medium">{formatCurrency(aiPrevStats.avgPrice)}</span></div>
              </div>
            </div>
          )}
          {aiInsight && (
            <div className="rounded-md border border-[hsl(var(--primary))/0.3] bg-[hsl(var(--primary))/0.05] p-3 text-sm">
              <span className="font-semibold text-[hsl(var(--primary))]">💡 AI分析: </span>
              <span>{aiInsight}</span>
            </div>
          )}
          {aiProposals.length > 0 && (
            <div className="space-y-3">
              {aiProposals.map((p: any, idx: number) => {
                const badge = p.label === "保守" ? "bg-blue-500/20 text-blue-400" : p.label === "積極" ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400";
                return (
                  <div key={idx} className="rounded-md border border-[hsl(var(--border))] p-3 hover:border-[hsl(var(--primary))] transition">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-bold ${badge}`}>{p.label}</span>
                      <Button size="sm" onClick={() => applyAiProposal(p)} disabled={goalMutation.isPending}>この目標で保存</Button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mb-2">
                      <div><span className="text-[hsl(var(--muted-foreground))]">売上:</span> <span className="font-bold">{formatCurrency(p.target_sales)}</span></div>
                      <div><span className="text-[hsl(var(--muted-foreground))]">注文:</span> <span className="font-bold">{formatNumber(p.target_orders)}</span></div>
                      <div><span className="text-[hsl(var(--muted-foreground))]">利益:</span> <span className="font-bold">{formatCurrency(p.target_profit)}</span></div>
                      <div><span className="text-[hsl(var(--muted-foreground))]">広告費:</span> <span className="font-bold">{formatCurrency(p.target_ad_budget)}</span></div>
                    </div>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">{p.rationale}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex justify-end mt-4">
          <Button type="button" variant="outline" onClick={() => setAiOpen(false)}>閉じる</Button>
        </div>
      </Dialog>
    </div>
  );
}
