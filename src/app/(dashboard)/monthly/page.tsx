"use client";
// Monthly analysis - updated 2026-03-15
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import { getDailySales } from "@/lib/api/sales";
import { getDailyAdvertising } from "@/lib/api/advertising";
import { getMonthlyOverrides, getMonthlyAdOverrides } from "@/lib/api/amazon-monthly-overrides";
import { supabase } from "@/lib/supabase";
import { BarChart, Bar, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import { CHART_COLORS } from "@/lib/constants";

export default function MonthlyAnalysisPage() {
  const { data: salesData = [] } = useQuery({
    queryKey: ["allSales"],
    queryFn: () => getDailySales({}),
  });

  const { data: adData = [] } = useQuery({
    queryKey: ["allAds"],
    queryFn: () => getDailyAdvertising({}),
  });

  const { data: overrides = {} } = useQuery({
    queryKey: ["monthlyOverrides"],
    queryFn: () => getMonthlyOverrides(),
  });

  const { data: adOverrides = {} } = useQuery({
    queryKey: ["monthlyAdOverrides"],
    queryFn: () => getMonthlyAdOverrides(),
  });

  // 施策カレンダーのポイント施策（イベント型ポイント原資）
  const { data: pointEvents = [] } = useQuery({
    queryKey: ["pointEventsAll"],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_events")
        .select("date, product_group, discount_rate")
        .eq("event_type", "point");
      return data || [];
    },
  });

  // ポイント施策ルックアップ: "date|product_group" → discount_rate
  const pointEventMap: Record<string, number> = {};
  for (const ev of pointEvents as any[]) {
    if (!ev.discount_rate || !ev.product_group) continue;
    const key = `${ev.date}|${ev.product_group}`;
    pointEventMap[key] = Math.max(pointEventMap[key] || 0, ev.discount_rate);
  }

  // Aggregate sales by month (with profit calculation)
  const monthly = (salesData as any[]).reduce((acc: Record<string, any>, row: any) => {
    const month = row.date.slice(0, 7);
    if (!acc[month]) acc[month] = { month, sales_amount: 0, orders: 0, sessions: 0, units_sold: 0, cost: 0, fba_fee: 0, point_cost: 0 };
    acc[month].sales_amount += row.sales_amount;
    acc[month].orders += row.orders;
    acc[month].sessions += row.sessions;
    acc[month].units_sold += row.units_sold;
    // Per-product cost calculation
    const product = row.product;
    if (product) {
      const units = row.units_sold || 0;
      acc[month].cost += (product.cost_price || 0) * units;
      acc[month].fba_fee += Math.round(row.sales_amount * ((product.fba_fee_rate || 15) / 100)) + (product.fba_shipping_fee || 0) * units;
      acc[month].point_cost += Math.round(row.sales_amount * ((product.point_rate || 0) / 100));

      // 施策カレンダーのイベント型ポイント施策（該当日×商品グループ）
      const productGroup = product.product_group;
      if (productGroup && row.date) {
        const eventRate = pointEventMap[`${row.date}|${productGroup}`];
        if (eventRate) {
          acc[month].point_cost += Math.round(row.sales_amount * (eventRate / 100));
        }
      }
    }
    return acc;
  }, {});

  // Aggregate ad data by month
  const monthlyAd = (adData as any[]).reduce((acc: Record<string, any>, row: any) => {
    const month = row.date.slice(0, 7);
    if (!acc[month]) acc[month] = { ad_spend: 0, ad_sales: 0, ad_orders: 0 };
    acc[month].ad_spend += row.ad_spend;
    acc[month].ad_sales += row.ad_sales;
    acc[month].ad_orders += row.ad_orders || 0;
    return acc;
  }, {} as Record<string, any>);

  // Filter: only keep last 12 months (exclude old/test data like 2025-01)
  const now = new Date();
  const cutoff = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthlyData = Object.values(monthly)
    .filter((m: any) => m.month >= cutoff)
    .sort((a: any, b: any) => b.month.localeCompare(a.month))
    .map((row: any) => {
      const override = (overrides as Record<string, any>)[row.month];
      const adAgg = (monthlyAd as Record<string, any>)[row.month];
      const adOverride = (adOverrides as Record<string, any>)[row.month];

      // Apply sales overrides
      const result = override ? {
        ...row,
        sales_amount: override.total_sales,
        orders: override.total_orders || row.orders,
        units_sold: override.total_units || row.units_sold,
        sessions: override.sessions || row.sessions,
        cvr: override.cvr || row.cvr,
        _overridden: true,
      } : { ...row };

      // CSV補正で売上が上書きされた月は、原価・FBA手数料・ポイント原資も
      // 売上比率でスケーリングして整合性を保つ（補正前売上が0の月は補正なし扱い）。
      if (override && row.sales_amount > 0 && override.total_sales > 0) {
        const scale = override.total_sales / row.sales_amount;
        result.cost = Math.round((row.cost || 0) * scale);
        result.fba_fee = Math.round((row.fba_fee || 0) * scale);
        result.point_cost = Math.round((row.point_cost || 0) * scale);
      }

      // Apply ad data (override takes priority over aggregated)
      if (adOverride) {
        result.ad_spend = adOverride.total_ad_spend;
        result.ad_sales = adOverride.total_ad_sales;
        result._adOverridden = true;
      } else if (adAgg) {
        result.ad_spend = adAgg.ad_spend;
        result.ad_sales = adAgg.ad_sales;
      } else {
        result.ad_spend = 0;
        result.ad_sales = 0;
      }

      // Profit calculation
      const profit = result.sales_amount - (result.cost || 0) - (result.fba_fee || 0) - (result.point_cost || 0) - (result.ad_spend || 0);
      result.profit = profit;
      result.profit_rate = result.sales_amount > 0 ? (profit / result.sales_amount) * 100 : 0;

      return result;
    });
  const chartData = [...monthlyData].reverse().slice(-12).map((d: any) => ({
    month: d.month.slice(2),
    売上: d.sales_amount,
    利益: d.profit || 0,
    広告費: d.ad_spend || 0,
  }));

  return (
    <div>
      <PageHeader title="月別分析" description="月別の売上推移" />

      <Card>
        <CardHeader>
          <CardTitle>月別売上推移</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
              <XAxis dataKey="month" stroke="hsl(0 0% 50%)" fontSize={12} />
              <YAxis stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px", color: "#fff" }} formatter={(value: any) => formatCurrency(value)} />
              <Legend />
              <ReferenceLine y={0} stroke="hsl(0 0% 30%)" />
              <Bar dataKey="売上" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
              <Bar dataKey="広告費" fill={CHART_COLORS[4]} radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="利益" stroke={CHART_COLORS[1]} strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>月</TableHead>
                <TableHead className="text-right">売上合計</TableHead>
                <TableHead className="text-right">注文件数</TableHead>
                <TableHead className="text-right">販売個数</TableHead>
                <TableHead className="text-right">セッション</TableHead>
                <TableHead className="text-right">CVR</TableHead>
                <TableHead className="text-right">広告費</TableHead>
                <TableHead className="text-right">利益</TableHead>
                <TableHead className="text-right">利益率</TableHead>
                <TableHead className="text-right">ACoS</TableHead>
                <TableHead className="text-right">前月比</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monthlyData.map((m: any, i: number) => {
                const prev = monthlyData[i + 1];
                const momChange = prev ? ((m.sales_amount - prev.sales_amount) / prev.sales_amount) * 100 : 0;
                return (
                  <TableRow key={m.month}>
                    <TableCell className="font-medium">
                      {m.month}
                      {m._overridden && (
                        <span className="ml-2 text-xs text-yellow-400 border border-yellow-400/30 rounded px-1">CSV補正</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(m.sales_amount)}</TableCell>
                    <TableCell className="text-right">{formatNumber(m.orders)}</TableCell>
                    <TableCell className="text-right">{formatNumber(m.units_sold)}</TableCell>
                    <TableCell className="text-right">{formatNumber(m.sessions)}</TableCell>
                    <TableCell className="text-right">{m.sessions > 0 && m.sessions >= m.orders * 0.5 ? formatPercent((m.orders / m.sessions) * 100) : "-"}</TableCell>
                    <TableCell className="text-right">
                      {m.ad_spend > 0 ? formatCurrency(m.ad_spend) : "-"}
                      {m._adOverridden && (
                        <span className="ml-1 text-xs text-yellow-400 border border-yellow-400/30 rounded px-1">CSV</span>
                      )}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${(m.profit || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {formatCurrency(m.profit || 0)}
                    </TableCell>
                    <TableCell className={`text-right ${(m.profit_rate || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {formatPercent(m.profit_rate || 0)}
                    </TableCell>
                    <TableCell className={`text-right ${m.ad_sales > 0 && (m.ad_spend / m.ad_sales) * 100 < 30 ? "text-[hsl(var(--success))]" : m.ad_spend > 0 ? "text-[hsl(var(--warning))]" : ""}`}>
                      {m.ad_sales > 0 ? formatPercent((m.ad_spend / m.ad_sales) * 100) : "-"}
                    </TableCell>
                    <TableCell className={`text-right ${momChange >= 0 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--destructive))]"}`}>
                      {prev ? `${momChange >= 0 ? "+" : ""}${momChange.toFixed(1)}%` : "-"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
