"use client";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodFilter } from "@/components/layout/period-filter";
import { KPICard } from "@/components/layout/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatNumber, formatPercent, getDateRange } from "@/lib/utils";
import { getShopifyDailySalesWithCost } from "@/lib/api/shopify-sales";
import { DollarSign, Package, TrendingUp, Wallet, ArrowUpDown } from "lucide-react";
import { Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart } from "recharts";
import { CHART_COLORS } from "@/lib/constants";

interface ProductSummary {
  key: string;
  product_title: string;
  sku: string | null;
  quantity: number;
  net_sales: number;
  cost: number;
  commission: number;
  shipping: number;
  profit: number;
  profitRate: number;
  hasProduct: boolean;
}

export default function ShopifyProductsPage() {
  const [period, setPeriod] = useState("this_month");
  const [sortKey, setSortKey] = useState<"net_sales" | "profit" | "profitRate" | "quantity">("net_sales");
  const [sortAsc, setSortAsc] = useState(false);
  const dateRange = getDateRange(period);

  const { data: salesData = [] } = useQuery({
    queryKey: ["shopifyDailyCost", dateRange],
    queryFn: () => getShopifyDailySalesWithCost(dateRange),
  });

  // 商品別に集計
  const products = useMemo(() => {
    const map: Record<string, ProductSummary> = {};
    for (const r of salesData as any[]) {
      const key = r.sku || r.product_title || "不明";
      if (!map[key]) {
        map[key] = {
          key,
          product_title: r.product_title || "不明",
          sku: r.sku,
          quantity: 0,
          net_sales: 0,
          cost: 0,
          commission: 0,
          shipping: 0,
          profit: 0,
          profitRate: 0,
          hasProduct: !!r.product,
        };
      }
      const costPrice = r.product?.cost_price || 0;
      const commRate = r.product?.commission_rate || 3.55;
      const shippingFee = r.product?.shopify_shipping_fee || r.product?.fba_shipping_fee || 0;
      const qty = r.quantity || 0;
      const sales = r.net_sales || 0;

      map[key].quantity += qty;
      map[key].net_sales += sales;
      map[key].cost += costPrice * qty;
      map[key].commission += Math.round(sales * commRate / 100);
      map[key].shipping += shippingFee * qty;
      if (r.product) map[key].hasProduct = true;
    }

    return Object.values(map).map(p => {
      p.profit = p.net_sales - p.cost - p.commission - p.shipping;
      p.profitRate = p.net_sales > 0 ? (p.profit / p.net_sales) * 100 : 0;
      return p;
    });
  }, [salesData]);

  // ソート
  const sorted = useMemo(() => {
    return [...products].sort((a, b) => {
      const diff = (a[sortKey] as number) - (b[sortKey] as number);
      return sortAsc ? diff : -diff;
    });
  }, [products, sortKey, sortAsc]);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  // KPI
  const totalSales = products.reduce((s, p) => s + p.net_sales, 0);
  const totalProfit = products.reduce((s, p) => s + p.profit, 0);
  const avgProfitRate = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;
  const totalProducts = products.length;

  // チャートデータ（上位10商品）
  const chartData = [...products]
    .sort((a, b) => b.net_sales - a.net_sales)
    .slice(0, 10)
    .map(p => ({
      name: p.product_title.length > 15 ? p.product_title.slice(0, 15) + "…" : p.product_title,
      売上: p.net_sales,
      利益: p.profit,
    }));

  const SortHeader = ({ label, field }: { label: string; field: typeof sortKey }) => (
    <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort(field)}>
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={`h-3 w-3 ${sortKey === field ? "text-[hsl(var(--primary))]" : "text-muted-foreground"}`} />
      </span>
    </TableHead>
  );

  return (
    <div>
      <PageHeader title="【Shopify】商品別分析" description="商品ごとの売上・原価・利益分析">
        <PeriodFilter value={period} onChange={setPeriod} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KPICard title="売上合計" value={formatCurrency(totalSales)} icon={DollarSign} />
        <KPICard title="利益合計" value={formatCurrency(totalProfit)} icon={Wallet} />
        <KPICard title="利益率" value={formatPercent(avgProfitRate)} icon={TrendingUp} />
        <KPICard title="商品数" value={formatNumber(totalProducts)} icon={Package} />
      </div>

      {/* 上位商品チャート */}
      <Card className="mt-6">
        <CardHeader><CardTitle>売上上位10商品</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" horizontal={false} />
              <XAxis type="number" stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" stroke="hsl(0 0% 50%)" fontSize={11} width={120} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px", color: "#fff" }}
                formatter={(value: number, name: string) => [formatCurrency(value), name]}
              />
              <Bar dataKey="売上" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} barSize={20} />
              <Bar dataKey="利益" fill={CHART_COLORS[1]} radius={[0, 4, 4, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* 商品別テーブル */}
      <Card className="mt-6">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>商品名</TableHead>
                <TableHead>SKU</TableHead>
                <SortHeader label="販売数" field="quantity" />
                <SortHeader label="売上" field="net_sales" />
                <TableHead className="text-right">原価</TableHead>
                <TableHead className="text-right">手数料</TableHead>
                <SortHeader label="利益" field="profit" />
                <SortHeader label="利益率" field="profitRate" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((p, i) => (
                <TableRow key={i}>
                  <TableCell className="max-w-[250px] truncate font-medium">{p.product_title}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{p.sku || "-"}</TableCell>
                  <TableCell className="text-right">{formatNumber(p.quantity)}</TableCell>
                  <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(p.net_sales)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatCurrency(p.cost)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatCurrency(p.commission + p.shipping)}</TableCell>
                  <TableCell className={`text-right font-medium ${p.profit >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {formatCurrency(p.profit)}
                  </TableCell>
                  <TableCell className={`text-right ${p.profit >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {formatPercent(p.profitRate)}
                  </TableCell>
                </TableRow>
              ))}
              {sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    データがありません
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
