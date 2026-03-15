"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodFilter } from "@/components/layout/period-filter";
import { KPICard } from "@/components/layout/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatPercent, formatNumber, getDateRange } from "@/lib/utils";
import { getRakutenProductSalesSummary } from "@/lib/api/rakuten-sales";
import { DollarSign, TrendingUp, TrendingDown, Package } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from "recharts";

const RAKUTEN_RED = "#bf0000";

export default function RakutenProductsPage() {
  const [period, setPeriod] = useState("30days");
  const dateRange = getDateRange(period);

  const { data: productSummary = [] } = useQuery({
    queryKey: ["rakutenProductSummary", dateRange],
    queryFn: () => getRakutenProductSalesSummary(dateRange),
  });

  const sorted = (productSummary as any[]).sort((a: any, b: any) => b.total_sales - a.total_sales);
  const totalSales = sorted.reduce((s: number, p: any) => s + p.total_sales, 0);
  const totalProfit = sorted.reduce((s: number, p: any) => s + (p.net_profit || 0), 0);
  const profitRate = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;
  const totalCost = sorted.reduce((s: number, p: any) => s + (p.total_cost || 0), 0);
  const totalFee = sorted.reduce((s: number, p: any) => s + (p.total_fee || 0), 0);
  const totalAdSpend = sorted.reduce((s: number, p: any) => s + (p.total_ad_spend || 0), 0);

  // Profit breakdown chart
  const profitChartData = sorted.slice(0, 8).map((p: any) => ({
    name: (p.product?.name || "不明").slice(0, 12),
    純利益: p.net_profit || 0,
    原価: p.total_cost || 0,
    手数料: p.total_fee || 0,
    広告費: p.total_ad_spend || 0,
  }));

  return (
    <div>
      <PageHeader title="🔴 楽天 商品別分析" description="楽天市場の商品別収益性分析">
        <PeriodFilter value={period} onChange={setPeriod} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <KPICard title="総売上" value={formatCurrency(totalSales)} icon={DollarSign} />
        <KPICard title="純利益" value={formatCurrency(totalProfit)} icon={totalProfit >= 0 ? TrendingUp : TrendingDown} valueClassName={totalProfit >= 0 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--destructive))]"} />
        <KPICard title="利益率" value={formatPercent(profitRate)} icon={TrendingUp} valueClassName={profitRate >= 20 ? "text-[hsl(var(--success))]" : profitRate >= 10 ? "" : "text-[hsl(var(--warning))]"} />
        <KPICard title="原価合計" value={formatCurrency(totalCost)} icon={Package} />
        <KPICard title="楽天手数料" value={formatCurrency(totalFee)} icon={DollarSign} />
        <KPICard title="RPP広告費" value={formatCurrency(totalAdSpend)} icon={DollarSign} />
      </div>

      {profitChartData.length > 0 && (
        <Card className="mt-6">
          <CardHeader><CardTitle>商品別コスト内訳</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={profitChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                <XAxis type="number" stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" stroke="hsl(0 0% 50%)" fontSize={11} width={100} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }} formatter={(value: any) => formatCurrency(value)} />
                <Legend />
                <Bar dataKey="原価" stackId="a" fill="#f97316" />
                <Bar dataKey="手数料" stackId="a" fill="#eab308" />
                <Bar dataKey="広告費" stackId="a" fill="#ec4899" />
                <Bar dataKey="純利益" stackId="a" fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader><CardTitle>商品別損益テーブル</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>商品名</TableHead>
                <TableHead className="text-right">売上</TableHead>
                <TableHead className="text-right">注文数</TableHead>
                <TableHead className="text-right">原価</TableHead>
                <TableHead className="text-right">手数料</TableHead>
                <TableHead className="text-right">広告費</TableHead>
                <TableHead className="text-right">純利益</TableHead>
                <TableHead className="text-right">利益率</TableHead>
                <TableHead className="text-right">個あたり利益</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((p: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-medium max-w-[200px] truncate">{p.product?.name || "不明"}</TableCell>
                  <TableCell className="text-right text-red-500">{formatCurrency(p.total_sales)}</TableCell>
                  <TableCell className="text-right">{formatNumber(p.total_orders)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(p.total_cost || 0)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(p.total_fee || 0)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(p.total_ad_spend || 0)}</TableCell>
                  <TableCell className={`text-right font-medium ${(p.net_profit || 0) >= 0 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--destructive))]"}`}>
                    {formatCurrency(p.net_profit || 0)}
                  </TableCell>
                  <TableCell className={`text-right ${(p.profit_rate || 0) >= 20 ? "text-[hsl(var(--success))]" : (p.profit_rate || 0) >= 10 ? "" : "text-[hsl(var(--warning))]"}`}>
                    {formatPercent(p.profit_rate || 0)}
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(p.unit_profit || 0)}</TableCell>
                </TableRow>
              ))}
              {sorted.length > 0 && (
                <TableRow className="bg-[hsl(var(--muted))] font-bold">
                  <TableCell>合計</TableCell>
                  <TableCell className="text-right">{formatCurrency(totalSales)}</TableCell>
                  <TableCell className="text-right">{formatNumber(sorted.reduce((s: number, p: any) => s + p.total_orders, 0))}</TableCell>
                  <TableCell className="text-right">{formatCurrency(totalCost)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(totalFee)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(totalAdSpend)}</TableCell>
                  <TableCell className={`text-right ${totalProfit >= 0 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--destructive))]"}`}>{formatCurrency(totalProfit)}</TableCell>
                  <TableCell className="text-right">{formatPercent(profitRate)}</TableCell>
                  <TableCell className="text-right">-</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
