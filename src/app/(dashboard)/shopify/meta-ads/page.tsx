"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodFilter } from "@/components/layout/period-filter";
import { KPICard } from "@/components/layout/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatNumber, formatPercent, getDateRange } from "@/lib/utils";
import { getMetaAdDaily, getMetaAdSummary } from "@/lib/api/shopify-sales";
import { Megaphone, DollarSign, MousePointerClick, TrendingUp } from "lucide-react";
import { Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart } from "recharts";
import { CHART_COLORS } from "@/lib/constants";

export default function MetaAdsPage() {
  const [period, setPeriod] = useState("30days");
  const dateRange = getDateRange(period);

  const { data: adData = [] } = useQuery({ queryKey: ["metaAdDaily", dateRange], queryFn: () => getMetaAdDaily(dateRange) });
  const { data: adSummary } = useQuery({ queryKey: ["metaAdSummary", dateRange], queryFn: () => getMetaAdSummary(dateRange) });

  const totalSpend = adSummary?.total_spend || 0;
  const totalPurchaseValue = adSummary?.total_purchase_value || 0;
  const totalPurchases = adSummary?.total_purchases || 0;
  const totalClicks = adSummary?.total_clicks || 0;
  const totalImpressions = adSummary?.total_impressions || 0;
  const roas = totalSpend > 0 ? totalPurchaseValue / totalSpend : 0;
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;

  // 日別集計
  const dailyAgg = (adData as any[]).reduce((acc: Record<string, any>, row: any) => {
    const d = row.date;
    if (!acc[d]) acc[d] = { date: d, spend: 0, purchase_value: 0, clicks: 0, impressions: 0 };
    acc[d].spend += row.spend || 0;
    acc[d].purchase_value += row.purchase_value || 0;
    acc[d].clicks += row.clicks || 0;
    acc[d].impressions += row.impressions || 0;
    return acc;
  }, {});

  const chartData = Object.values(dailyAgg)
    .sort((a: any, b: any) => a.date.localeCompare(b.date))
    .map((d: any) => ({
      date: d.date.slice(5),
      広告費: d.spend,
      売上: d.purchase_value,
      ROAS: d.spend > 0 ? ((d.purchase_value / d.spend) * 100).toFixed(0) : 0,
    }));

  // キャンペーン別集計
  const campaignAgg = (adData as any[]).reduce((acc: Record<string, any>, row: any) => {
    const key = row.campaign_name || "不明";
    if (!acc[key]) acc[key] = { name: key, spend: 0, purchase_value: 0, purchases: 0, clicks: 0, impressions: 0 };
    acc[key].spend += row.spend || 0;
    acc[key].purchase_value += row.purchase_value || 0;
    acc[key].purchases += row.purchases || 0;
    acc[key].clicks += row.clicks || 0;
    acc[key].impressions += row.impressions || 0;
    return acc;
  }, {});

  const campaigns = Object.values(campaignAgg).sort((a: any, b: any) => b.spend - a.spend);

  return (
    <div>
      <PageHeader title="【Shopify】Meta広告管理" description="Facebook/Instagram広告の分析">
        <PeriodFilter value={period} onChange={setPeriod} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
        <KPICard title="広告費合計" value={formatCurrency(totalSpend)} icon={Megaphone} />
        <KPICard title="広告売上" value={formatCurrency(totalPurchaseValue)} icon={DollarSign} />
        <KPICard title="ROAS" value={`${(roas * 100).toFixed(0)}%`} icon={TrendingUp} valueClassName={roas > 3 ? "text-green-400" : ""} />
        <KPICard title="購入数" value={formatNumber(totalPurchases)} icon={DollarSign} />
        <KPICard title="CPC" value={`¥${Math.round(cpc)}`} icon={MousePointerClick} />
        <KPICard title="CTR" value={formatPercent(ctr)} icon={MousePointerClick} />
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle>広告費・売上推移</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
              <XAxis dataKey="date" stroke="hsl(0 0% 50%)" fontSize={12} />
              <YAxis yAxisId="left" stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
              <YAxis yAxisId="right" orientation="right" stroke="hsl(0 0% 50%)" fontSize={12} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }} />
              <Legend />
              <Bar yAxisId="left" dataKey="広告費" fill={CHART_COLORS[4]} radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="売上" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="ROAS" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle>キャンペーン別</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>キャンペーン</TableHead>
                <TableHead className="text-right">広告費</TableHead>
                <TableHead className="text-right">売上</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
                <TableHead className="text-right">購入数</TableHead>
                <TableHead className="text-right">クリック</TableHead>
                <TableHead className="text-right">CTR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c: any, i: number) => {
                const cRoas = c.spend > 0 ? c.purchase_value / c.spend : 0;
                const cCtr = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
                return (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-right">{formatCurrency(c.spend)}</TableCell>
                    <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(c.purchase_value)}</TableCell>
                    <TableCell className={`text-right ${cRoas > 3 ? "text-green-500" : ""}`}>{(cRoas * 100).toFixed(0)}%</TableCell>
                    <TableCell className="text-right">{formatNumber(c.purchases)}</TableCell>
                    <TableCell className="text-right">{formatNumber(c.clicks)}</TableCell>
                    <TableCell className="text-right">{formatPercent(cCtr)}</TableCell>
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
