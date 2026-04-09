"use client";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodFilter } from "@/components/layout/period-filter";
import { KPICard } from "@/components/layout/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatNumber, formatPercent, formatDate, getDateRange } from "@/lib/utils";
import { getShopifyDailySummary, getShopifyDailySalesWithCost, getMetaAdByDate, getMetaAdSummary } from "@/lib/api/shopify-sales";
import { DollarSign, ShoppingCart, TrendingUp, BarChart3, Wallet, MousePointerClick, Eye, ShoppingBag } from "lucide-react";
import { Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart, ReferenceLine } from "recharts";
import { CHART_COLORS } from "@/lib/constants";

export default function ShopifyDailyPage() {
  const [period, setPeriod] = useState("this_month");
  const dateRange = getDateRange(period);

  const { data: dailySummary = [] } = useQuery({
    queryKey: ["shopifyDaily", dateRange],
    queryFn: () => getShopifyDailySummary(dateRange),
  });
  const { data: salesWithCost = [] } = useQuery({
    queryKey: ["shopifyDailyCost", dateRange],
    queryFn: () => getShopifyDailySalesWithCost(dateRange),
  });
  const { data: metaAdByDate = {} } = useQuery({
    queryKey: ["metaAdByDate", dateRange],
    queryFn: () => getMetaAdByDate(dateRange),
  });
  const { data: metaAd = { total_spend: 0 } } = useQuery({
    queryKey: ["metaAdSummary", dateRange],
    queryFn: () => getMetaAdSummary(dateRange),
  });

  // 日別の原価・手数料・配送コストを集計
  const costByDate = useMemo(() => {
    const map: Record<string, { cost: number; commission: number; shipping: number }> = {};
    for (const r of salesWithCost as any[]) {
      if (!map[r.date]) map[r.date] = { cost: 0, commission: 0, shipping: 0 };
      const costPrice = r.product?.cost_price || 0;
      const commRate = r.product?.commission_rate || 3.55;
      const shippingFee = r.product?.shopify_shipping_fee || r.product?.fba_shipping_fee || 0;
      map[r.date].cost += costPrice * (r.quantity || 0);
      map[r.date].commission += Math.round((r.net_sales || 0) * commRate / 100);
      map[r.date].shipping += shippingFee * (r.quantity || 0);
    }
    return map;
  }, [salesWithCost]);

  // 日別データにコスト・広告費・利益を付与（広告費のみの日も含める）
  const dailyData = useMemo(() => {
    const metaMap = (metaAdByDate || {}) as Record<string, { spend: number; add_to_cart: number; clicks: number; impressions: number }>;
    // 売上データの日付 + 広告データの日付をマージ
    const allDates = new Set<string>();
    for (const d of (dailySummary as any[])) allDates.add(d.date);
    for (const date of Object.keys(metaMap)) allDates.add(date);

    const summaryMap = new Map((dailySummary as any[]).map((d: any) => [d.date, d]));

    return Array.from(allDates).map((date) => {
      const d = summaryMap.get(date) || { date, net_sales: 0, total_orders: 0, total_units: 0 };
      const sales = d.net_sales || 0;
      const cost = costByDate[date]?.cost || 0;
      const commission = costByDate[date]?.commission || 0;
      const shipping = costByDate[date]?.shipping || 0;
      const meta = metaMap[date] || { spend: 0, add_to_cart: 0, clicks: 0, impressions: 0 };
      const adSpend = meta.spend;
      const fees = commission + shipping;
      const profit = sales - cost - fees - adSpend;
      const profitRate = sales > 0 ? (profit / sales) * 100 : 0;
      return { ...d, cost, commission, shipping, fees, adSpend, profit, profitRate, adClicks: meta.clicks, adAddToCart: meta.add_to_cart, adImpressions: meta.impressions };
    }).sort((a: any, b: any) => b.date.localeCompare(a.date));
  }, [dailySummary, costByDate, metaAdByDate]);

  // KPI合計
  const totalSales = dailyData.reduce((s, d) => s + (d.net_sales || 0), 0);
  const totalOrders = dailyData.reduce((s, d) => s + (d.total_orders || 0), 0);
  const totalProfit = dailyData.reduce((s, d) => s + d.profit, 0);
  const totalAdSpend = metaAd?.total_spend || 0;
  const avgProfitRate = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;
  const totalAdClicks = dailyData.reduce((s, d) => s + (d.adClicks || 0), 0);
  const totalAdImpressions = dailyData.reduce((s, d) => s + (d.adImpressions || 0), 0);
  const totalAdAddToCart = dailyData.reduce((s, d) => s + (d.adAddToCart || 0), 0);

  // チャートデータ
  const chartData = [...dailyData].reverse().map(d => ({
    date: d.date.slice(5),
    売上: d.net_sales || 0,
    利益: d.profit,
    広告費: d.adSpend,
  }));

  return (
    <div>
      <PageHeader title="【Shopify】日別分析" description="feela.co.jp の日別売上・利益推移">
        <PeriodFilter value={period} onChange={setPeriod} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-8">
        <KPICard title="売上合計" value={formatCurrency(totalSales)} icon={DollarSign} />
        <KPICard title="利益合計" value={formatCurrency(totalProfit)} icon={Wallet} />
        <KPICard title="利益率" value={formatPercent(avgProfitRate)} icon={TrendingUp} />
        <KPICard title="Meta広告費" value={formatCurrency(totalAdSpend)} icon={BarChart3} />
        <KPICard title="広告IMP" value={formatNumber(totalAdImpressions)} icon={Eye} />
        <KPICard title="広告流入" value={formatNumber(totalAdClicks)} icon={MousePointerClick} />
        <KPICard title="カート追加" value={formatNumber(totalAdAddToCart)} icon={ShoppingBag} />
        <KPICard title="注文数" value={formatNumber(totalOrders)} icon={ShoppingCart} />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>売上・利益推移</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
              <XAxis dataKey="date" stroke="hsl(0 0% 50%)" fontSize={12} />
              <YAxis stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px", color: "#fff" }}
                formatter={(value: number, name: string) => [formatCurrency(value), name]}
              />
              <Legend />
              <ReferenceLine y={0} stroke="hsl(0 0% 30%)" />
              <Bar dataKey="売上" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="利益" stroke={CHART_COLORS[1]} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="広告費" stroke={CHART_COLORS[4]} strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日付</TableHead>
                <TableHead className="text-right">売上</TableHead>
                <TableHead className="text-right">原価</TableHead>
                <TableHead className="text-right">手数料</TableHead>
                <TableHead className="text-right">広告費</TableHead>
                <TableHead className="text-right">利益</TableHead>
                <TableHead className="text-right">利益率</TableHead>
                <TableHead className="text-right">広告IMP</TableHead>
                <TableHead className="text-right">広告流入</TableHead>
                <TableHead className="text-right">カート追加</TableHead>
                <TableHead className="text-right">注文</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dailyData.map((day: any, i: number) => (
                <TableRow key={i}>
                  <TableCell>{formatDate(day.date)}</TableCell>
                  <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(day.net_sales || 0)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatCurrency(day.cost)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatCurrency(day.fees)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatCurrency(day.adSpend)}</TableCell>
                  <TableCell className={`text-right font-medium ${day.profit >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {formatCurrency(day.profit)}
                  </TableCell>
                  <TableCell className={`text-right ${day.profit >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {formatPercent(day.profitRate)}
                  </TableCell>
                  <TableCell className="text-right">{formatNumber(day.adImpressions || 0)}</TableCell>
                  <TableCell className="text-right">{formatNumber(day.adClicks || 0)}</TableCell>
                  <TableCell className="text-right">{formatNumber(day.adAddToCart || 0)}</TableCell>
                  <TableCell className="text-right">{formatNumber(day.total_orders || 0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
