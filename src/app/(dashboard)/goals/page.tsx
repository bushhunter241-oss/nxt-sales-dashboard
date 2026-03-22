"use client";
import { useState, useMemo, useCallback } from "react";
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
import { Target, ChevronRight, ChevronDown } from "lucide-react";

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

interface GroupData {
  groupName: string;
  products: any[];
  totalSales: number;
  totalOrders: number;
  totalUnits: number;
  totalProfit: number;
  totalGrossProfit: number;
  avgPricePerUnit: number;
  avgProfitPerUnit: number;
  avgGrossProfitPerUnit: number;
  goal: any | null;
}

export default function GoalsPage() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [form, setForm] = useState({ target_sales: 0, target_orders: 0, target_profit: 0, target_tacos: 15, target_ad_budget: 0 });
  const queryClient = useQueryClient();

  const monthStart = `${selectedMonth}-01`;
  const monthEnd = new Date(parseInt(selectedMonth.split("-")[0]), parseInt(selectedMonth.split("-")[1]), 0).toISOString().split("T")[0];

  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => getProducts() });
  const { data: goals = [] } = useQuery({ queryKey: ["goals", selectedMonth], queryFn: () => getMonthlyGoals(selectedMonth) });
  const { data: productSummary = [] } = useQuery({
    queryKey: ["productSummaryMonth", monthStart, monthEnd],
    queryFn: () => getProductSalesSummary({ startDate: monthStart, endDate: monthEnd }),
  });

  const goalMutation = useMutation({
    mutationFn: (data: { groupName: string; target_sales: number; target_orders: number; target_profit: number; target_ad_budget: number }) =>
      upsertGroupGoal({
        product_group: data.groupName,
        year_month: selectedMonth,
        target_sales: data.target_sales,
        target_orders: data.target_orders,
        target_profit: data.target_profit,
        target_ad_budget: data.target_ad_budget,
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["goals"] }); setDialogOpen(false); },
  });

  // Group products by product_group
  const groupedData = useMemo(() => {
    const groups = new Map<string, GroupData>();

    for (const product of products as any[]) {
      if (product.is_archived) continue;
      const groupName = product.product_group || product.name;
      if (!groups.has(groupName)) {
        groups.set(groupName, {
          groupName, products: [], totalSales: 0, totalOrders: 0,
          totalUnits: 0, totalProfit: 0, totalGrossProfit: 0,
          avgPricePerUnit: 0, avgProfitPerUnit: 0, avgGrossProfitPerUnit: 0, goal: null,
        });
      }
      const group = groups.get(groupName)!;
      const actual = (productSummary as any[]).find((p: any) => p.product?.id === product.id);
      group.products.push({
        ...product,
        actualSales: actual?.total_sales || 0,
        actualOrders: actual?.total_orders || 0,
      });
      group.totalSales += actual?.total_sales || 0;
      group.totalOrders += actual?.total_orders || 0;
      group.totalUnits += actual?.total_units || 0;
      group.totalProfit += actual?.net_profit || 0;
      group.totalGrossProfit += actual?.gross_profit || 0;
    }

    for (const group of groups.values()) {
      if (group.totalUnits > 0) {
        group.avgPricePerUnit = Math.round(group.totalSales / group.totalUnits);
        group.avgProfitPerUnit = Math.round(group.totalProfit / group.totalUnits);
        group.avgGrossProfitPerUnit = Math.round(group.totalGrossProfit / group.totalUnits);
      }
    }

    for (const goal of goals as any[]) {
      if (goal.product_group && !goal.product_id) {
        const group = groups.get(goal.product_group);
        if (group) group.goal = goal;
      }
    }

    return Array.from(groups.values()).sort((a, b) => b.totalSales - a.totalSales);
  }, [products, productSummary, goals]);

  // Helper: get metrics for a group name (computed fresh, no stale closure)
  // Falls back to gross profit per unit when net profit is <= 0 (ad spend causing loss)
  const getGroupMetrics = useCallback((groupName: string | null): {
    avgPrice: number; avgProfit: number; useGross: boolean; canCalc: boolean;
  } => {
    if (!groupName) return { avgPrice: 0, avgProfit: 0, useGross: false, canCalc: false };
    const found = groupedData.find((g) => g.groupName === groupName);
    if (!found || found.avgPricePerUnit <= 0) return { avgPrice: 0, avgProfit: 0, useGross: false, canCalc: false };

    // Use net profit if positive
    if (found.avgProfitPerUnit > 0) {
      return { avgPrice: found.avgPricePerUnit, avgProfit: found.avgProfitPerUnit, useGross: false, canCalc: true };
    }
    // Fallback to gross profit (excludes ad spend)
    if (found.avgGrossProfitPerUnit > 0) {
      return { avgPrice: found.avgPricePerUnit, avgProfit: found.avgGrossProfitPerUnit, useGross: true, canCalc: true };
    }
    // Both negative — cannot auto-calculate
    return { avgPrice: found.avgPricePerUnit, avgProfit: 0, useGross: false, canCalc: false };
  }, [groupedData]);

  const toggleGroup = (groupName: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(groupName) ? next.delete(groupName) : next.add(groupName);
      return next;
    });
  };

  const openGroupGoalDialog = (groupName: string) => {
    const group = groupedData.find((g) => g.groupName === groupName);
    const savedSales = group?.goal?.target_sales || 0;
    // Derive TACoS from saved ad_budget/sales, or use actual TACoS, or default 15%
    const savedAdBudget = group?.goal?.target_ad_budget || 0;
    const actualTacos = group && group.totalSales > 0
      ? (productSummary as any[])
          .filter((ps: any) => group.products.some((p: any) => p.id === ps.product?.id))
          .reduce((s: number, ps: any) => s + (ps.total_ad_spend || 0), 0) / group.totalSales * 100
      : 0;
    const tacos = savedAdBudget > 0 && savedSales > 0
      ? Math.round((savedAdBudget / savedSales) * 100 * 10) / 10
      : actualTacos > 0 ? Math.round(actualTacos * 10) / 10 : 15;
    setEditingGroup(groupName);
    setForm({
      target_sales: savedSales,
      target_orders: group?.goal?.target_orders || 0,
      target_profit: group?.goal?.target_profit || 0,
      target_tacos: tacos,
      target_ad_budget: savedAdBudget || (savedSales > 0 ? Math.round(savedSales * tacos / 100) : 0),
    });
    setDialogOpen(true);
  };

  // Auto-fill handlers: compute from editingGroup directly via getGroupMetrics
  const handleProfitChange = (profit: number) => {
    const m = getGroupMetrics(editingGroup);
    if (m.canCalc && profit > 0) {
      const orders = Math.round(profit / m.avgProfit);
      const sales = orders * m.avgPrice;
      setForm((f) => ({ ...f, target_profit: profit, target_orders: orders, target_sales: sales, target_ad_budget: Math.round(sales * f.target_tacos / 100) }));
    } else {
      setForm((f) => ({ ...f, target_profit: profit }));
    }
  };

  const handleSalesChange = (sales: number) => {
    const m = getGroupMetrics(editingGroup);
    if (m.canCalc && sales > 0) {
      const orders = Math.round(sales / m.avgPrice);
      const profit = orders * m.avgProfit;
      setForm((f) => ({ ...f, target_sales: sales, target_orders: orders, target_profit: profit, target_ad_budget: Math.round(sales * f.target_tacos / 100) }));
    } else {
      setForm((f) => ({ ...f, target_sales: sales, target_ad_budget: Math.round(sales * f.target_tacos / 100) }));
    }
  };

  const handleOrdersChange = (orders: number) => {
    const m = getGroupMetrics(editingGroup);
    if (m.canCalc && orders > 0) {
      const sales = orders * m.avgPrice;
      const profit = orders * m.avgProfit;
      setForm((f) => ({ ...f, target_orders: orders, target_sales: sales, target_profit: profit, target_ad_budget: Math.round(sales * f.target_tacos / 100) }));
    } else {
      setForm((f) => ({ ...f, target_orders: orders }));
    }
  };

  const handleTacosChange = (tacos: number) => {
    setForm((f) => ({
      ...f,
      target_tacos: tacos,
      target_ad_budget: f.target_sales > 0 ? Math.round(f.target_sales * tacos / 100) : f.target_ad_budget,
    }));
  };

  const handleAdBudgetChange = (adBudget: number) => {
    setForm((f) => {
      if (f.target_tacos > 0 && adBudget > 0) {
        const sales = Math.round(adBudget / (f.target_tacos / 100));
        const m = getGroupMetrics(editingGroup);
        if (m.canCalc && sales > 0) {
          const orders = Math.round(sales / m.avgPrice);
          const profit = orders * m.avgProfit;
          return { ...f, target_ad_budget: adBudget, target_sales: sales, target_orders: orders, target_profit: profit };
        }
        return { ...f, target_ad_budget: adBudget, target_sales: sales };
      }
      return { ...f, target_ad_budget: adBudget };
    });
  };

  // Overall = sum of all group goals
  const totalActualSales = groupedData.reduce((s, g) => s + g.totalSales, 0);
  const totalActualOrders = groupedData.reduce((s, g) => s + g.totalOrders, 0);
  const overallSalesTarget = groupedData.reduce((s, g) => s + (g.goal?.target_sales || 0), 0);
  const overallOrdersTarget = groupedData.reduce((s, g) => s + (g.goal?.target_orders || 0), 0);
  const overallProfitTarget = groupedData.reduce((s, g) => s + (g.goal?.target_profit || 0), 0);

  const daysInMonth = new Date(parseInt(selectedMonth.split("-")[0]), parseInt(selectedMonth.split("-")[1]), 0).getDate();
  const daysPassed = selectedMonth === currentMonth ? now.getDate() : (selectedMonth < currentMonth ? daysInMonth : 0);
  const dailyPace = daysPassed > 0 ? totalActualSales / daysPassed : 0;
  const projectedSales = Math.round(dailyPace * daysInMonth);
  const overallAchievement = overallSalesTarget > 0 ? (totalActualSales / overallSalesTarget) * 100 : 0;

  const monthOptions = getYearMonthOptions();

  // Current dialog metrics (for display in dialog)
  const dialogMetrics = getGroupMetrics(editingGroup);

  return (
    <div>
      <PageHeader title="目標・進捗管理" description="月間目標の設定と達成率の確認">
        <Select options={monthOptions} value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="w-40" />
      </PageHeader>

      {/* Overall summary card (aggregated from group goals) */}
      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <Target className="h-6 w-6 text-[hsl(var(--primary))]" />
            <h3 className="text-lg font-bold">
              全体目標: {overallSalesTarget > 0 ? formatCurrency(overallSalesTarget) : "未設定"}
              {overallProfitTarget > 0 && (
                <span className="ml-3 text-sm font-normal text-[hsl(var(--muted-foreground))]">
                  (利益目標: {formatCurrency(overallProfitTarget)})
                </span>
              )}
            </h3>
          </div>
          {overallSalesTarget > 0 ? (
            <>
              <div className="mb-2 flex justify-between text-sm">
                <span>売上達成: {formatCurrency(totalActualSales)}</span>
                <span>{formatPercent(overallAchievement)}</span>
              </div>
              <div className="h-4 w-full rounded-full bg-[hsl(var(--muted))]">
                <div
                  className={`h-4 rounded-full transition-all ${overallAchievement >= 100 ? "bg-[hsl(var(--success))]" : "bg-[hsl(var(--primary))]"}`}
                  style={{ width: `${Math.min(100, overallAchievement)}%` }}
                />
              </div>
              <div className="mt-3 grid grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-[hsl(var(--muted-foreground))]">経過日数</span>
                  <p className="font-medium">{daysPassed} / {daysInMonth}日</p>
                </div>
                <div>
                  <span className="text-[hsl(var(--muted-foreground))]">日次ペース</span>
                  <p className="font-medium">{formatCurrency(Math.round(dailyPace))}/日</p>
                </div>
                <div>
                  <span className="text-[hsl(var(--muted-foreground))]">月末予測</span>
                  <p className={`font-medium ${projectedSales >= overallSalesTarget ? "text-[hsl(var(--success))]" : "text-[hsl(var(--warning))]"}`}>
                    {formatCurrency(projectedSales)}
                  </p>
                </div>
                <div>
                  <span className="text-[hsl(var(--muted-foreground))]">注文 (実績/目標)</span>
                  <p className="font-medium">{formatNumber(totalActualOrders)} / {overallOrdersTarget > 0 ? formatNumber(overallOrdersTarget) : "-"}</p>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">下のテーブルから各商品グループの目標を設定すると、ここに合計値が表示されます。</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>グループ / 商品名</TableHead>
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
                const isExpanded = expandedGroups.has(group.groupName);
                const salesTarget = group.goal?.target_sales || 0;
                const ordersTarget = group.goal?.target_orders || 0;
                const achievement = salesTarget > 0 ? (group.totalSales / salesTarget) * 100 : 0;

                return (
                  <>
                    <TableRow
                      key={group.groupName}
                      className="cursor-pointer hover:bg-[hsl(var(--muted))/0.5] font-medium"
                      onClick={() => toggleGroup(group.groupName)}
                    >
                      <TableCell className="px-3">
                        {isExpanded
                          ? <ChevronDown className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                          : <ChevronRight className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                        }
                      </TableCell>
                      <TableCell className="font-bold">{group.groupName}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className={salesTarget > 0 ? "" : "text-[hsl(var(--muted-foreground))]"}
                          onClick={(e) => { e.stopPropagation(); openGroupGoalDialog(group.groupName); }}
                        >
                          {salesTarget > 0 ? formatCurrency(salesTarget) : "設定"}
                        </Button>
                      </TableCell>
                      <TableCell className="text-right text-[hsl(var(--primary))] font-bold">{formatCurrency(group.totalSales)}</TableCell>
                      <TableCell className={`text-right font-bold ${achievement >= 100 ? "text-[hsl(var(--success))]" : ""}`}>
                        {salesTarget > 0 ? formatPercent(achievement) : "-"}
                      </TableCell>
                      <TableCell>
                        {salesTarget > 0 && (
                          <div className="h-2.5 w-full rounded-full bg-[hsl(var(--muted))]">
                            <div
                              className={`h-2.5 rounded-full transition-all ${achievement >= 100 ? "bg-[hsl(var(--success))]" : achievement >= 70 ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--warning))]"}`}
                              style={{ width: `${Math.min(100, achievement)}%` }}
                            />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{ordersTarget > 0 ? formatNumber(ordersTarget) : "-"}</TableCell>
                      <TableCell className="text-right font-bold">{formatNumber(group.totalOrders)}</TableCell>
                    </TableRow>

                    {isExpanded && group.products.map((product: any) => {
                      const salesShare = group.totalSales > 0 ? product.actualSales / group.totalSales : 0;
                      const ordersShare = group.totalOrders > 0 ? product.actualOrders / group.totalOrders : 0;
                      const prodSalesTarget = salesTarget > 0 ? Math.round(salesTarget * salesShare) : 0;
                      const prodOrdersTarget = ordersTarget > 0 ? Math.round(ordersTarget * ordersShare) : 0;
                      const prodAchievement = prodSalesTarget > 0 ? (product.actualSales / prodSalesTarget) * 100 : 0;
                      return (
                        <TableRow key={product.id} className="bg-[hsl(var(--muted))/0.15]">
                          <TableCell></TableCell>
                          <TableCell className="pl-10 text-sm text-[hsl(var(--muted-foreground))]">
                            {product.name}
                            {product.asin && <span className="ml-2 text-xs opacity-60">({product.asin})</span>}
                          </TableCell>
                          <TableCell className="text-right text-sm text-[hsl(var(--muted-foreground))]">
                            {prodSalesTarget > 0 ? formatCurrency(prodSalesTarget) : "-"}
                          </TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(product.actualSales)}</TableCell>
                          <TableCell className={`text-right text-sm ${prodAchievement >= 100 ? "text-[hsl(var(--success))]" : ""}`}>
                            {prodSalesTarget > 0 ? formatPercent(prodAchievement) : group.totalSales > 0 ? formatPercent(salesShare * 100) : "-"}
                          </TableCell>
                          <TableCell>
                            {prodSalesTarget > 0 && (
                              <div className="h-1.5 w-full rounded-full bg-[hsl(var(--muted))]">
                                <div
                                  className={`h-1.5 rounded-full transition-all ${prodAchievement >= 100 ? "bg-[hsl(var(--success))]" : prodAchievement >= 70 ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--warning))]"}`}
                                  style={{ width: `${Math.min(100, prodAchievement)}%` }}
                                />
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm text-[hsl(var(--muted-foreground))]">
                            {prodOrdersTarget > 0 ? formatNumber(prodOrdersTarget) : "-"}
                          </TableCell>
                          <TableCell className="text-right text-sm">{formatNumber(product.actualOrders)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader>
          <DialogTitle>{editingGroup} の目標設定 ({selectedMonth})</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (editingGroup) goalMutation.mutate({ groupName: editingGroup, target_sales: form.target_sales, target_orders: form.target_orders, target_profit: form.target_profit, target_ad_budget: form.target_ad_budget });
          }}
          className="space-y-4"
        >
          {dialogMetrics.canCalc ? (
            <div className="rounded-md bg-[hsl(var(--muted))] p-3 text-xs text-[hsl(var(--muted-foreground))]">
              直近実績: 平均単価 {formatCurrency(dialogMetrics.avgPrice)}/個 ・ {dialogMetrics.useGross ? "平均粗利" : "平均利益"} {formatCurrency(dialogMetrics.avgProfit)}/個
              {dialogMetrics.useGross && (
                <span className="ml-1 text-[hsl(var(--warning))]">（※現在赤字のため粗利で計算）</span>
              )}
              <span className="ml-2 opacity-70">（いずれかを入力 → 他を自動計算）</span>
            </div>
          ) : dialogMetrics.avgPrice > 0 ? (
            <div className="rounded-md bg-[hsl(var(--muted))] p-3 text-xs text-[hsl(var(--warning))]">
              このグループは粗利もマイナスのため自動計算できません。手動で入力してください。
            </div>
          ) : null}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-sm text-[hsl(var(--muted-foreground))]">利益目標 (円)</label>
              <Input type="number" value={form.target_profit} onChange={(e) => handleProfitChange(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-sm text-[hsl(var(--muted-foreground))]">売上目標 (円)</label>
              <Input type="number" value={form.target_sales} onChange={(e) => handleSalesChange(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-sm text-[hsl(var(--muted-foreground))]">注文数目標</label>
              <Input type="number" value={form.target_orders} onChange={(e) => handleOrdersChange(Number(e.target.value))} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-sm text-[hsl(var(--muted-foreground))]">目標TACoS (%)</label>
              <Input type="number" step="0.1" value={form.target_tacos} onChange={(e) => handleTacosChange(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-sm text-[hsl(var(--muted-foreground))]">広告予算 (円)</label>
              <Input type="number" value={form.target_ad_budget} onChange={(e) => handleAdBudgetChange(Number(e.target.value))} />
            </div>
            <div className="flex items-end pb-1">
              <span className="text-xs text-[hsl(var(--muted-foreground))]">
                広告予算 = 売上目標 × TACoS
              </span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>キャンセル</Button>
            <Button type="submit">保存</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
