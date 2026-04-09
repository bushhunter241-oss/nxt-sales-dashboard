"use client";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodFilter } from "@/components/layout/period-filter";
import { KPICard } from "@/components/layout/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatNumber, formatPercent, getDateRange } from "@/lib/utils";
import { getMetaAdDaily } from "@/lib/api/shopify-sales";
import { Eye, MousePointerClick, ShoppingBag, ShoppingCart, TrendingUp, DollarSign, Megaphone } from "lucide-react";
import { Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Cell } from "recharts";

const FUNNEL_COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#22c55e"];

export default function ShopifyFunnelPage() {
  const [period, setPeriod] = useState("this_month");
  const dateRange = getDateRange(period);

  const { data: adData = [] } = useQuery({
    queryKey: ["metaAdDaily", dateRange],
    queryFn: () => getMetaAdDaily(dateRange),
  });

  // 全体集計
  const totals = useMemo(() => {
    const t = { impressions: 0, clicks: 0, add_to_cart: 0, purchases: 0, spend: 0, purchase_value: 0 };
    for (const r of adData as any[]) {
      t.impressions += r.impressions || 0;
      t.clicks += r.clicks || 0;
      t.add_to_cart += r.add_to_cart || 0;
      t.purchases += r.purchases || 0;
      t.spend += r.spend || 0;
      t.purchase_value += r.purchase_value || 0;
    }
    return t;
  }, [adData]);

  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const cartRate = totals.clicks > 0 ? (totals.add_to_cart / totals.clicks) * 100 : 0;
  const purchaseRate = totals.add_to_cart > 0 ? (totals.purchases / totals.add_to_cart) * 100 : 0;
  const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  const cpa = totals.purchases > 0 ? totals.spend / totals.purchases : 0;
  const roas = totals.spend > 0 ? totals.purchase_value / totals.spend : 0;

  // ファネルチャートデータ
  const funnelData = [
    { name: "IMP", value: totals.impressions, rate: "100%" },
    { name: "クリック", value: totals.clicks, rate: formatPercent(ctr) },
    { name: "カート追加", value: totals.add_to_cart, rate: formatPercent(cartRate) },
    { name: "購入", value: totals.purchases, rate: formatPercent(purchaseRate) },
  ];

  // キャンペーン別集計
  const campaigns = useMemo(() => {
    const map: Record<string, { name: string; impressions: number; clicks: number; add_to_cart: number; purchases: number; spend: number; purchase_value: number }> = {};
    for (const r of adData as any[]) {
      const name = r.campaign_name || "不明";
      if (!map[name]) map[name] = { name, impressions: 0, clicks: 0, add_to_cart: 0, purchases: 0, spend: 0, purchase_value: 0 };
      map[name].impressions += r.impressions || 0;
      map[name].clicks += r.clicks || 0;
      map[name].add_to_cart += r.add_to_cart || 0;
      map[name].purchases += r.purchases || 0;
      map[name].spend += r.spend || 0;
      map[name].purchase_value += r.purchase_value || 0;
    }
    return Object.values(map).sort((a, b) => b.spend - a.spend);
  }, [adData]);

  return (
    <div>
      <PageHeader title="【Shopify】広告ファネル分析" description="Meta広告の IMP → クリック → カート追加 → 購入 を可視化">
        <PeriodFilter value={period} onChange={setPeriod} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-8">
        <KPICard title="IMP" value={formatNumber(totals.impressions)} icon={Eye} />
        <KPICard title="クリック" value={formatNumber(totals.clicks)} icon={MousePointerClick} />
        <KPICard title="カート追加" value={formatNumber(totals.add_to_cart)} icon={ShoppingBag} />
        <KPICard title="購入" value={formatNumber(totals.purchases)} icon={ShoppingCart} />
        <KPICard title="CTR" value={formatPercent(ctr)} icon={TrendingUp} />
        <KPICard title="CPC" value={`¥${Math.round(cpc)}`} icon={DollarSign} />
        <KPICard title="CPA" value={`¥${Math.round(cpa)}`} icon={Megaphone} />
        <KPICard title="ROAS" value={`${(roas * 100).toFixed(0)}%`} icon={TrendingUp} valueClassName={roas > 3 ? "text-green-400" : ""} />
      </div>

      {/* ファネルチャート */}
      <Card className="mt-6">
        <CardHeader><CardTitle>広告ファネル</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={funnelData} layout="vertical" margin={{ left: 20, right: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" horizontal={false} />
              <XAxis type="number" stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
              <YAxis type="category" dataKey="name" stroke="hsl(0 0% 50%)" fontSize={13} width={80} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px", color: "#fff" }}
                formatter={(value: number) => [formatNumber(value), ""]}
              />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={40}>
                {funnelData.map((_, idx) => (
                  <Cell key={idx} fill={FUNNEL_COLORS[idx]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {/* 転換率表示 */}
          <div className="mt-4 flex items-center justify-center gap-2 text-sm">
            <span className="text-muted-foreground">IMP</span>
            <span className="rounded bg-blue-500/20 px-2 py-0.5 text-blue-400 font-medium">{formatPercent(ctr)}</span>
            <span className="text-muted-foreground">→ クリック</span>
            <span className="rounded bg-purple-500/20 px-2 py-0.5 text-purple-400 font-medium">{formatPercent(cartRate)}</span>
            <span className="text-muted-foreground">→ カート</span>
            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-amber-400 font-medium">{formatPercent(purchaseRate)}</span>
            <span className="text-muted-foreground">→ 購入</span>
          </div>
        </CardContent>
      </Card>

      {/* キャンペーン別テーブル */}
      <Card className="mt-6">
        <CardHeader><CardTitle>キャンペーン別ファネル</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>キャンペーン</TableHead>
                <TableHead className="text-right">IMP</TableHead>
                <TableHead className="text-right">クリック</TableHead>
                <TableHead className="text-right">CTR</TableHead>
                <TableHead className="text-right">カート追加</TableHead>
                <TableHead className="text-right">カート率</TableHead>
                <TableHead className="text-right">購入</TableHead>
                <TableHead className="text-right">CVR</TableHead>
                <TableHead className="text-right">広告費</TableHead>
                <TableHead className="text-right">CPC</TableHead>
                <TableHead className="text-right">CPA</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c, i) => {
                const cCtr = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
                const cCartRate = c.clicks > 0 ? (c.add_to_cart / c.clicks) * 100 : 0;
                const cCvr = c.add_to_cart > 0 ? (c.purchases / c.add_to_cart) * 100 : 0;
                const cCpc = c.clicks > 0 ? c.spend / c.clicks : 0;
                const cCpa = c.purchases > 0 ? c.spend / c.purchases : 0;
                const cRoas = c.spend > 0 ? c.purchase_value / c.spend : 0;
                return (
                  <TableRow key={i}>
                    <TableCell className="font-medium max-w-[200px] truncate">{c.name}</TableCell>
                    <TableCell className="text-right">{formatNumber(c.impressions)}</TableCell>
                    <TableCell className="text-right">{formatNumber(c.clicks)}</TableCell>
                    <TableCell className="text-right">{formatPercent(cCtr)}</TableCell>
                    <TableCell className="text-right">{formatNumber(c.add_to_cart)}</TableCell>
                    <TableCell className="text-right">{formatPercent(cCartRate)}</TableCell>
                    <TableCell className="text-right">{formatNumber(c.purchases)}</TableCell>
                    <TableCell className="text-right">{formatPercent(cCvr)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(c.spend)}</TableCell>
                    <TableCell className="text-right">¥{Math.round(cCpc)}</TableCell>
                    <TableCell className="text-right">¥{Math.round(cCpa)}</TableCell>
                    <TableCell className={`text-right font-medium ${cRoas > 3 ? "text-green-500" : ""}`}>{(cRoas * 100).toFixed(0)}%</TableCell>
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
