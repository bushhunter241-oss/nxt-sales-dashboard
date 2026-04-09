"use client";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodFilter } from "@/components/layout/period-filter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatNumber, formatPercent, getDateRange } from "@/lib/utils";
import { getMetaAdDaily } from "@/lib/api/shopify-sales";
import { Eye, MousePointerClick, ShoppingBag, ShoppingCart, TrendingUp, DollarSign, Megaphone, Target } from "lucide-react";
import { Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Cell } from "recharts";

const FUNNEL_COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#22c55e"];

// 目標値
const TARGETS = {
  ctr: 2.0,        // CTR 目標 2%
  cartRate: 10,    // クリック→カート 目標 10%
  purchaseRate: 30, // カート→購入 目標 30%
  roas: 300,       // ROAS 目標 300%
};

function MetricBadge({ value, target, format, lowerIsBetter = false }: {
  value: number; target: number; format: (v: number) => string; lowerIsBetter?: boolean;
}) {
  const isGood = lowerIsBetter ? value <= target : value >= target;
  const pct = target > 0 ? (value / target) * 100 : 0;
  return (
    <div className="flex flex-col gap-1">
      <span className={`text-2xl font-bold ${isGood ? "text-green-400" : "text-red-400"}`}>
        {format(value)}
      </span>
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 flex-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${isGood ? "bg-green-500" : "bg-red-500"}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          目標 {format(target)}
        </span>
      </div>
    </div>
  );
}

function KPIWithTarget({ title, icon: Icon, value, target, format, lowerIsBetter = false }: {
  title: string; icon: any; value: number; target?: number; format: (v: number) => string; lowerIsBetter?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
        <span>{title}</span>
        <Icon className="h-4 w-4" />
      </div>
      {target !== undefined ? (
        <MetricBadge value={value} target={target} format={format} lowerIsBetter={lowerIsBetter} />
      ) : (
        <span className="text-2xl font-bold">{format(value)}</span>
      )}
    </div>
  );
}

export default function ShopifyFunnelPage() {
  const [period, setPeriod] = useState("this_month");
  const dateRange = getDateRange(period);

  const { data: adData = [] } = useQuery({
    queryKey: ["metaAdDaily", dateRange],
    queryFn: () => getMetaAdDaily(dateRange),
  });

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
  const roas = totals.spend > 0 ? (totals.purchase_value / totals.spend) * 100 : 0;

  const funnelData = [
    { name: "IMP", value: totals.impressions },
    { name: "クリック", value: totals.clicks },
    { name: "カート追加", value: totals.add_to_cart },
    { name: "購入", value: totals.purchases },
  ];

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

  const pct = (v: number) => formatPercent(v);
  const yen = (v: number) => `¥${Math.round(v).toLocaleString()}`;
  const roasFmt = (v: number) => `${Math.round(v)}%`;

  return (
    <div>
      <PageHeader title="【Shopify】広告ファネル分析" description="Meta広告の IMP → クリック → カート追加 → 購入 を可視化">
        <PeriodFilter value={period} onChange={setPeriod} />
      </PageHeader>

      {/* 目標ラインつきKPI */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-8">
        <KPIWithTarget title="IMP" icon={Eye} value={totals.impressions} format={formatNumber} />
        <KPIWithTarget title="クリック" icon={MousePointerClick} value={totals.clicks} format={formatNumber} />
        <KPIWithTarget title="カート追加" icon={ShoppingBag} value={totals.add_to_cart} format={formatNumber} />
        <KPIWithTarget title="購入" icon={ShoppingCart} value={totals.purchases} format={formatNumber} />
        <KPIWithTarget title="CTR" icon={TrendingUp} value={ctr} target={TARGETS.ctr} format={pct} />
        <KPIWithTarget title="CPC" icon={DollarSign} value={cpc} format={yen} />
        <KPIWithTarget title="CPA" icon={Megaphone} value={cpa} format={yen} />
        <KPIWithTarget title="ROAS" icon={Target} value={roas} target={TARGETS.roas} format={roasFmt} />
      </div>

      {/* ファネルチャート + 目標転換率 */}
      <Card className="mt-6">
        <CardHeader><CardTitle>広告ファネル</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={funnelData} layout="vertical" margin={{ left: 20, right: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" horizontal={false} />
              <XAxis type="number" stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
              <YAxis type="category" dataKey="name" stroke="hsl(0 0% 50%)" fontSize={13} width={80} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px", color: "#fff" }}
                formatter={(value: number) => [formatNumber(value), ""]}
              />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={36}>
                {funnelData.map((_, idx) => (
                  <Cell key={idx} fill={FUNNEL_COLORS[idx]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* 転換率 × 目標比較 */}
          <div className="mt-5 grid grid-cols-3 gap-3">
            {[
              { label: "IMP → クリック（CTR）", value: ctr, target: TARGETS.ctr, color: "blue" },
              { label: "クリック → カート追加", value: cartRate, target: TARGETS.cartRate, color: "purple" },
              { label: "カート → 購入", value: purchaseRate, target: TARGETS.purchaseRate, color: "amber" },
            ].map(({ label, value, target, color }) => {
              const isGood = value >= target;
              const pctOfTarget = target > 0 ? Math.min((value / target) * 100, 100) : 0;
              return (
                <div key={label} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))/0.3] p-3">
                  <div className="mb-1 text-xs text-muted-foreground">{label}</div>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-xl font-bold ${isGood ? "text-green-400" : "text-red-400"}`}>
                      {formatPercent(value)}
                    </span>
                    <span className="text-xs text-muted-foreground">目標 {formatPercent(target)}</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${isGood ? "bg-green-500" : "bg-red-400"}`}
                      style={{ width: `${pctOfTarget}%` }}
                    />
                  </div>
                  <div className="mt-1 text-right text-[10px] text-muted-foreground">
                    {isGood ? "✅ 目標達成" : `目標の ${Math.round(pctOfTarget)}%`}
                  </div>
                </div>
              );
            })}
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
                <TableHead className="text-right">
                  CTR
                  <span className="ml-1 text-[10px] text-muted-foreground">目標{TARGETS.ctr}%</span>
                </TableHead>
                <TableHead className="text-right">カート追加</TableHead>
                <TableHead className="text-right">
                  カート率
                  <span className="ml-1 text-[10px] text-muted-foreground">目標{TARGETS.cartRate}%</span>
                </TableHead>
                <TableHead className="text-right">購入</TableHead>
                <TableHead className="text-right">
                  CVR
                  <span className="ml-1 text-[10px] text-muted-foreground">目標{TARGETS.purchaseRate}%</span>
                </TableHead>
                <TableHead className="text-right">広告費</TableHead>
                <TableHead className="text-right">CPC</TableHead>
                <TableHead className="text-right">CPA</TableHead>
                <TableHead className="text-right">
                  ROAS
                  <span className="ml-1 text-[10px] text-muted-foreground">目標{TARGETS.roas}%</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c, i) => {
                const cCtr = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
                const cCartRate = c.clicks > 0 ? (c.add_to_cart / c.clicks) * 100 : 0;
                const cCvr = c.add_to_cart > 0 ? (c.purchases / c.add_to_cart) * 100 : 0;
                const cCpc = c.clicks > 0 ? c.spend / c.clicks : 0;
                const cCpa = c.purchases > 0 ? c.spend / c.purchases : 0;
                const cRoas = c.spend > 0 ? (c.purchase_value / c.spend) * 100 : 0;
                return (
                  <TableRow key={i}>
                    <TableCell className="font-medium max-w-[200px] truncate">{c.name}</TableCell>
                    <TableCell className="text-right">{formatNumber(c.impressions)}</TableCell>
                    <TableCell className="text-right">{formatNumber(c.clicks)}</TableCell>
                    <TableCell className={`text-right ${cCtr >= TARGETS.ctr ? "text-green-500" : "text-red-400"}`}>{formatPercent(cCtr)}</TableCell>
                    <TableCell className="text-right">{formatNumber(c.add_to_cart)}</TableCell>
                    <TableCell className={`text-right ${cCartRate >= TARGETS.cartRate ? "text-green-500" : "text-red-400"}`}>{formatPercent(cCartRate)}</TableCell>
                    <TableCell className="text-right">{formatNumber(c.purchases)}</TableCell>
                    <TableCell className={`text-right ${cCvr >= TARGETS.purchaseRate ? "text-green-500" : "text-red-400"}`}>{formatPercent(cCvr)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(c.spend)}</TableCell>
                    <TableCell className="text-right">¥{Math.round(cCpc)}</TableCell>
                    <TableCell className="text-right">¥{Math.round(cCpa).toLocaleString()}</TableCell>
                    <TableCell className={`text-right font-medium ${cRoas >= TARGETS.roas ? "text-green-500" : "text-red-400"}`}>{Math.round(cRoas)}%</TableCell>
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
