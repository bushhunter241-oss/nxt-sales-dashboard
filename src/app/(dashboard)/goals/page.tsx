"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency, formatNumber, formatPercent, getDateRange } from "@/lib/utils";
import { getProducts } from "@/lib/api/products";
import { getMonthlyGoals, upsertMonthlyGoal } from "@/lib/api/goals";
import { getProductSalesSummary } from "@/lib/api/sales";
import { Plus, Target } from "lucide-react";

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

export default function GoalsPage() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ product_id: "" as string | null, target_sales: 0, target_orders: 0, target_profit: 0 });
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
    mutationFn: (data: any) => upsertMonthlyGoal({ ...data, year_month: selectedMonth }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["goals"] }); setDialogOpen(false); },
  });

  const productOptions = [{ value: "", label: "全体" }, ...(products as any[]).map((p: any) => ({ value: p.id, label: p.name }))];
  const monthOptions = getYearMonthOptions();

  // Calculate totals
  const totalActualSales = (productSummary as any[]).reduce((s: number, p: any) => s + p.total_sales, 0);
  const totalActualOrders = (productSummary as any[]).reduce((s: number, p: any) => s + p.total_orders, 0);

  // Overall goal
  const overallGoal = (goals as any[]).find((g: any) => !g.product_id);
  const overallSalesTarget = overallGoal?.target_sales || 0;
  const overallOrdersTarget = overallGoal?.target_orders || 0;

  const daysInMonth = new Date(parseInt(selectedMonth.split("-")[0]), parseInt(selectedMonth.split("-")[1]), 0).getDate();
  const daysPassed = selectedMonth === currentMonth ? now.getDate() : (selectedMonth < currentMonth ? daysInMonth : 0);
  const dailyPace = daysPassed > 0 ? totalActualSales / daysPassed : 0;
  const projectedSales = Math.round(dailyPace * daysInMonth);

  return (
    <div>
      <PageHeader title="目標・進捗管理" description="月間目標の設定と達成率の確認">
        <Select options={monthOptions} value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="w-40" />
        <Button onClick={() => { setForm({ product_id: null, target_sales: 0, target_orders: 0, target_profit: 0 }); setDialogOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" />目標設定
        </Button>
      </PageHeader>

      {overallSalesTarget > 0 && (
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <Target className="h-6 w-6 text-[hsl(var(--primary))]" />
              <h3 className="text-lg font-bold">全体目標: {formatCurrency(overallSalesTarget)}</h3>
            </div>
            <div className="mb-2 flex justify-between text-sm">
              <span>達成: {formatCurrency(totalActualSales)}</span>
              <span>{overallSalesTarget > 0 ? formatPercent((totalActualSales / overallSalesTarget) * 100) : "0%"}</span>
            </div>
            <div className="h-4 w-full rounded-full bg-[hsl(var(--muted))]">
              <div
                className="h-4 rounded-full bg-[hsl(var(--primary))] transition-all"
                style={{ width: `${Math.min(100, overallSalesTarget > 0 ? (totalActualSales / overallSalesTarget) * 100 : 0)}%` }}
              />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
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
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>商品別目標・実績</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>商品名</TableHead>
                <TableHead className="text-right">売上目標</TableHead>
                <TableHead className="text-right">実績</TableHead>
                <TableHead className="text-right">達成率</TableHead>
                <TableHead>進捗</TableHead>
                <TableHead className="text-right">注文目標</TableHead>
                <TableHead className="text-right">注文実績</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(products as any[]).map((product: any) => {
                const goal = (goals as any[]).find((g: any) => g.product_id === product.id);
                const actual = (productSummary as any[]).find((p: any) => p.product?.id === product.id);
                const salesTarget = goal?.target_sales || 0;
                const actualSales = actual?.total_sales || 0;
                const actualOrders = actual?.total_orders || 0;
                const achievement = salesTarget > 0 ? (actualSales / salesTarget) * 100 : 0;

                return (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell className="text-right">{salesTarget > 0 ? formatCurrency(salesTarget) : <Button size="sm" variant="ghost" onClick={() => { setForm({ product_id: product.id, target_sales: 0, target_orders: 0, target_profit: 0 }); setDialogOpen(true); }}>設定</Button>}</TableCell>
                    <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(actualSales)}</TableCell>
                    <TableCell className="text-right">{salesTarget > 0 ? formatPercent(achievement) : "-"}</TableCell>
                    <TableCell>
                      {salesTarget > 0 && (
                        <div className="h-2 w-24 rounded-full bg-[hsl(var(--muted))]">
                          <div className={`h-2 rounded-full transition-all ${achievement >= 100 ? "bg-[hsl(var(--success))]" : achievement >= 70 ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--warning))]"}`} style={{ width: `${Math.min(100, achievement)}%` }} />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{goal?.target_orders > 0 ? formatNumber(goal.target_orders) : "-"}</TableCell>
                    <TableCell className="text-right">{formatNumber(actualOrders)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader><DialogTitle>目標設定 ({selectedMonth})</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); goalMutation.mutate(form); }} className="space-y-4">
          <div><label className="text-sm text-[hsl(var(--muted-foreground))]">対象</label><Select options={productOptions} value={form.product_id || ""} onChange={(e) => setForm({ ...form, product_id: e.target.value || null })} /></div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">売上目標</label><Input type="number" value={form.target_sales} onChange={(e) => setForm({ ...form, target_sales: Number(e.target.value) })} /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">注文数目標</label><Input type="number" value={form.target_orders} onChange={(e) => setForm({ ...form, target_orders: Number(e.target.value) })} /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">利益目標</label><Input type="number" value={form.target_profit} onChange={(e) => setForm({ ...form, target_profit: Number(e.target.value) })} /></div>
          </div>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>キャンセル</Button><Button type="submit">保存</Button></div>
        </form>
      </Dialog>
    </div>
  );
}
