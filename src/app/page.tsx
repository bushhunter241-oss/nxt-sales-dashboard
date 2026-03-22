"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { KPICard } from "@/components/layout/kpi-card";
import { PeriodFilter } from "@/components/layout/period-filter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatPercent, formatNumber, getDateRange } from "@/lib/utils";
import { getAggregatedDailySales, getProductSalesSummary } from "@/lib/api/sales";
import { getAdSummary } from "@/lib/api/advertising";
import { getAggregatedRakutenDailySales, getRakutenProductSalesSummary } from "@/lib/api/rakuten-sales";
import { getRakutenAdSummary } from "@/lib/api/rakuten-advertising";
import { getProducts } from "@/lib/api/products";
import { getInventory } from "@/lib/api/inventory";
import { DollarSign, ShoppingCart, Megaphone, AlertTriangle, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";

export default function DashboardPage() {
  const [period, setPeriod] = useState("30days");
  const dateRange = getDateRange(period);

  const { data: dailySales = [] } = useQuery({
    queryKey: ["aggregatedSales", dateRange],
    queryFn: () => getAggregatedDailySales(dateRange),
  });

  const { data: productSummary = [] } = useQuery({
    queryKey: ["productSummary", dateRange],
    queryFn: () => getProductSalesSummary(dateRange),
  });

  const { data: adSummary = { total_ad_spend: 0, total_ad_sales: 0, total_impressions: 0, total_clicks: 0 } } = useQuery({
    queryKey: ["adSummary", dateRange],
    queryFn: () => getAdSummary(dateRange),
  });

  const { data: rakutenDailySales = [] } = useQuery({
    queryKey: ["aggregatedRakutenSales", dateRange],
    queryFn: () => getAggregatedRakutenDailySales(dateRange),
  });

  const { data: rakutenProductSummary = [] } = useQuery({
    queryKey: ["rakutenProductSummary", dateRange],
    queryFn: () => getRakutenProductSalesSummary(dateRange),
  });

  const { data: rakutenAdSummary = { total_ad_spend: 0, total_ad_sales: 0, total_impressions: 0, total_clicks: 0 } } = useQuery({
    queryKey: ["rakutenAdSummary", dateRange],
    queryFn: () => getRakutenAdSummary(dateRange),
  });

  const { data: inventory = [] } = useQuery({
    queryKey: ["inventory"],
    queryFn: getInventory,
  });

  // Amazon 集計
  const amazonSales = (dailySales as any[]).reduce((sum: number, d: any) => sum + d.sales_amount, 0);
  const amazonOrders = (dailySales as any[]).reduce((sum: number, d: any) => sum + d.orders, 0);
  const amazonAdSpend = adSummary?.total_ad_spend || 0;
  const amazonProfit = (productSummary as any[]).reduce((sum: number, p: any) => sum + (p.net_profit || 0), 0);

  // 楽天 集計
  const rakutenSales = (rakutenDailySales as any[]).reduce((sum: number, d: any) => sum + d.sales_amount, 0);
  const rakutenOrders = (rakutenDailySales as any[]).reduce((sum: number, d: any) => sum + d.orders, 0);
  const rakutenAdSpend = rakutenAdSummary?.total_ad_spend || 0;
  const rakutenProfit = (rakutenProductSummary as any[]).reduce((sum: number, p: any) => sum + (p.net_profit || 0), 0);

  // 統合合計
  const totalSales = amazonSales + rakutenSales;
  const totalOrders = amazonOrders + rakutenOrders;
  const totalAdSpend = amazonAdSpend + rakutenAdSpend;
  const totalProfit = amazonProfit + rakutenProfit;
  const totalProfitRate = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;

  const lowStockItems = (inventory as any[]).filter((inv: any) => inv.current_stock <= inv.reorder_point);

  // Amazon + 楽天 の日別売上をマージ（積み上げ棒グラフ用）
  const mergedChartData = (() => {
    const dateMap: Record<string, { amazon: number; rakuten: number }> = {};
    for (const d of dailySales as any[]) {
      if (!dateMap[d.date]) dateMap[d.date] = { amazon: 0, rakuten: 0 };
      dateMap[d.date].amazon += d.sales_amount;
    }
    for (const d of rakutenDailySales as any[]) {
      if (!dateMap[d.date]) dateMap[d.date] = { amazon: 0, rakuten: 0 };
      dateMap[d.date].rakuten += d.sales_amount;
    }
    return Object.entries(dateMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({
        date: date.slice(5),
        Amazon: vals.amazon,
        楽天: vals.rakuten,
      }));
  })();

  // チャネル別売上比率（円グラフ用）
  const channelPieData = [
    { name: "Amazon", value: amazonSales, color: "#f97316" },
    { name: "楽天", value: rakutenSales, color: "#ef4444" },
  ];

  // Amazon + 楽天 統合商品ランキング
  const combinedProductRanking = [
    ...(productSummary as any[]).map((p: any) => ({
      name: p.product?.name || "不明",
      channel: "Amazon" as const,
      total_sales: p.total_sales,
      total_orders: p.total_orders,
      net_profit: p.net_profit || 0,
    })),
    ...(rakutenProductSummary as any[]).map((p: any) => ({
      name: p.product?.name || "不明",
      channel: "楽天" as const,
      total_sales: p.total_sales,
      total_orders: p.total_orders,
      net_profit: p.net_profit || 0,
    })),
  ].sort((a, b) => b.total_sales - a.total_sales);

  return (
    <div>
      <PageHeader title="ダッシュボード" description="売上・利益の概要">
        <PeriodFilter value={period} onChange={setPeriod} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <KPICard title="売上合計" value={formatCurrency(totalSales)} icon={DollarSign} />
        <KPICard title="注文件数" value={formatNumber(totalOrders)} icon={ShoppingCart} />
        <KPICard title="広告費合計" value={formatCurrency(totalAdSpend)} icon={Megaphone} />
        <KPICard title="利益合計" value={formatCurrency(totalProfit)} icon={TrendingUp} />
        <KPICard
          title="利益率"
          value={formatPercent(totalProfitRate)}
          icon={TrendingUp}
          valueClassName={totalProfitRate >= 20 ? "text-green-400" : totalProfitRate >= 10 ? "text-yellow-400" : "text-red-400"}
        />
      </div>

      {lowStockItems.length > 0 && (
        <Card className="mt-4 border-[hsl(var(--warning))]">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="h-5 w-5 text-[hsl(var(--warning))]" />
            <div>
              <span className="font-medium">在庫アラート:</span>{" "}
              {lowStockItems.map((inv: any) => inv.product?.name).join(", ")} の在庫が少なくなっています
            </div>
          </CardContent>
        </Card>
      )}

      {/* チャネル別サマリー */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>チャネル別サマリー</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>チャネル</TableHead>
                <TableHead className="text-right">売上</TableHead>
                <TableHead className="text-right">注文数</TableHead>
                <TableHead className="text-right">広告費</TableHead>
                <TableHead className="text-right">利益</TableHead>
                <TableHead className="text-right">利益率</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-orange-500" />
                    <span className="font-medium">Amazon</span>
                  </div>
                </TableCell>
                <TableCell className="text-right">{formatCurrency(amazonSales)}</TableCell>
                <TableCell className="text-right">{formatNumber(amazonOrders)}</TableCell>
                <TableCell className="text-right">{formatCurrency(amazonAdSpend)}</TableCell>
                <TableCell className="text-right">{formatCurrency(amazonProfit)}</TableCell>
                <TableCell className="text-right">{amazonSales > 0 ? formatPercent((amazonProfit / amazonSales) * 100) : "0%"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-red-500" />
                    <span className="font-medium">楽天</span>
                  </div>
                </TableCell>
                <TableCell className="text-right">{formatCurrency(rakutenSales)}</TableCell>
                <TableCell className="text-right">{formatNumber(rakutenOrders)}</TableCell>
                <TableCell className="text-right">{formatCurrency(rakutenAdSpend)}</TableCell>
                <TableCell className="text-right">{formatCurrency(rakutenProfit)}</TableCell>
                <TableCell className="text-right">{rakutenSales > 0 ? formatPercent((rakutenProfit / rakutenSales) * 100) : "0%"}</TableCell>
              </TableRow>
              <TableRow className="border-t-2 font-bold">
                <TableCell>合計</TableCell>
                <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(totalSales)}</TableCell>
                <TableCell className="text-right">{formatNumber(totalOrders)}</TableCell>
                <TableCell className="text-right">{formatCurrency(totalAdSpend)}</TableCell>
                <TableCell className="text-right">{formatCurrency(totalProfit)}</TableCell>
                <TableCell className="text-right">{formatPercent(totalProfitRate)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>売上推移（Amazon + 楽天）</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={mergedChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                <XAxis dataKey="date" stroke="hsl(0 0% 50%)" fontSize={12} />
                <YAxis stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }}
                  labelStyle={{ color: "hsl(0 0% 70%)" }}
                  formatter={(value: any) => formatCurrency(value)}
                />
                <Legend />
                <Bar dataKey="Amazon" stackId="sales" fill="#f97316" radius={[0, 0, 0, 0]} />
                <Bar dataKey="楽天" stackId="sales" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* チャネル別売上比率（円グラフ） */}
          <Card>
            <CardHeader>
              <CardTitle>チャネル別売上比率</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={channelPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {channelPieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: any) => formatCurrency(value)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1">
                {channelPieData.map((ch) => (
                  <div key={ch.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: ch.color }} />
                      <span>{ch.name}</span>
                    </div>
                    <span className="font-medium">{formatCurrency(ch.value)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 商品ランキング TOP5（全チャネル統合） */}
          <Card>
            <CardHeader>
              <CardTitle>商品ランキング</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {combinedProductRanking.slice(0, 5).map((p, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${i < 3 ? "bg-[hsl(var(--primary))] text-white" : "bg-[hsl(var(--muted))]"}`}>
                        {i + 1}
                      </span>
                      <span className="text-sm">{p.name}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        p.channel === "Amazon" ? "bg-orange-500/20 text-orange-400" : "bg-red-500/20 text-red-400"
                      }`}>
                        {p.channel}
                      </span>
                    </div>
                    <span className="text-sm font-medium">{formatCurrency(p.total_sales)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>商品別損益（全チャネル）</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>商品名</TableHead>
                <TableHead>チャネル</TableHead>
                <TableHead className="text-right">売上</TableHead>
                <TableHead className="text-right">注文数</TableHead>
                <TableHead className="text-right">利益</TableHead>
                <TableHead className="text-right">利益率</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {combinedProductRanking.map((p, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      p.channel === "Amazon" ? "bg-orange-500/20 text-orange-400" : "bg-red-500/20 text-red-400"
                    }`}>
                      {p.channel}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(p.total_sales)}</TableCell>
                  <TableCell className="text-right">{formatNumber(p.total_orders)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(p.net_profit)}</TableCell>
                  <TableCell className="text-right">
                    <span className={
                      p.total_sales > 0 && (p.net_profit / p.total_sales) * 100 >= 20 ? "text-green-400" :
                      p.total_sales > 0 && (p.net_profit / p.total_sales) * 100 >= 10 ? "text-yellow-400" : "text-red-400"
                    }>
                      {p.total_sales > 0 ? formatPercent((p.net_profit / p.total_sales) * 100) : "0%"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
