"use client";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodFilter } from "@/components/layout/period-filter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select } from "@/components/ui/select";
import { formatCurrency, formatPercent, formatNumber, getDateRange } from "@/lib/utils";
import { getProductSalesSummary, getDailySales } from "@/lib/api/sales";
import { getProducts } from "@/lib/api/products";
import { getBsrRankings } from "@/lib/api/bsr";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell, ReferenceLine } from "recharts";
import { CHART_COLORS } from "@/lib/constants";

// Get group key: use DB product_group if set, otherwise fallback to name-based grouping
function getGroupKey(product: any): string {
  if (product?.product_group) return product.product_group;
  const name = product?.name || "";
  if (!name) return "未分類";
  let clean = name.replace(/^【[^】]*】\s*/g, "").trim();
  return clean.length > 25 ? clean.slice(0, 25) : clean;
}

interface GroupedProduct {
  groupKey: string;
  groupName: string;
  children: any[];
  total_sales: number;
  total_orders: number;
  total_units: number;
  total_cost: number;
  total_fba_fee: number;
  total_ad_spend: number;
  total_sessions: number;
  gross_profit: number;
  net_profit: number;
  profit_rate: number;
  unit_profit: number;
}

function groupProducts(products: any[]): GroupedProduct[] {
  const groups: Record<string, GroupedProduct> = {};
  for (const p of products) {
    const key = getGroupKey(p.product);
    if (!groups[key]) {
      groups[key] = {
        groupKey: key,
        groupName: key,
        children: [],
        total_sales: 0, total_orders: 0, total_units: 0,
        total_cost: 0, total_fba_fee: 0, total_ad_spend: 0, total_sessions: 0,
        gross_profit: 0, net_profit: 0, profit_rate: 0, unit_profit: 0,
      };
    }
    const g = groups[key];
    g.children.push(p);
    g.total_sales += p.total_sales || 0;
    g.total_orders += p.total_orders || 0;
    g.total_units += p.total_units || 0;
    g.total_cost += p.total_cost || 0;
    g.total_fba_fee += p.total_fba_fee || 0;
    g.total_ad_spend += p.total_ad_spend || 0;
    g.total_sessions += p.total_sessions || 0;
    g.gross_profit += p.gross_profit || 0;
    g.net_profit += p.net_profit || 0;
  }
  // Calculate rates
  for (const g of Object.values(groups)) {
    g.profit_rate = g.total_sales > 0 ? (g.net_profit / g.total_sales) * 100 : 0;
    g.unit_profit = g.total_units > 0 ? Math.round(g.net_profit / g.total_units) : 0;
  }
  return Object.values(groups);
}

export default function ProductAnalysisPage() {
  const [period, setPeriod] = useState("30days");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [sortKey, setSortKey] = useState<string>("total_sales");
  const [viewMode, setViewMode] = useState<string>("grouped");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const dateRange = getDateRange(period);

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });

  const { data: productSummary = [] } = useQuery({
    queryKey: ["productSummary", dateRange],
    queryFn: () => getProductSalesSummary(dateRange),
  });

  const { data: productDailySales = [] } = useQuery({
    queryKey: ["productDailySales", dateRange, selectedProduct],
    queryFn: () => getDailySales({ ...dateRange, productId: selectedProduct || undefined }),
    enabled: !!selectedProduct,
  });

  const { data: bsrRankings = [] } = useQuery({
    queryKey: ["bsrRankings", dateRange],
    queryFn: () => getBsrRankings(dateRange.startDate, dateRange.endDate),
  });

  // BSR chart data - group by parent_asin (product group), show best rank over time
  const bsrChartData = useMemo(() => {
    if (!bsrRankings || bsrRankings.length === 0) return [];

    // Group by date + group key, using parent_asin for grouping
    const dateMap: Record<string, Record<string, number[]>> = {};
    const groupLabels = new Map<string, string>(); // groupKey -> display label

    for (const r of bsrRankings as any[]) {
      const date = r.recorded_at?.split("T")[0] || "";
      // Group key: parent_asin if set, otherwise fall back to individual asin
      const groupKey = r.product?.parent_asin || r.product?.asin || r.asin;
      // Display label: product_group name if set, otherwise product name
      if (!groupLabels.has(groupKey)) {
        const label = r.product?.product_group || r.product?.name || r.asin;
        groupLabels.set(groupKey, label.length > 15 ? label.slice(0, 15) + "…" : label);
      }

      if (!dateMap[date]) dateMap[date] = {};
      if (!dateMap[date][groupKey]) dateMap[date][groupKey] = [];
      dateMap[date][groupKey].push(r.rank);
    }

    // Convert to chart data: use best (lowest) rank per group per date
    const groupKeys = Array.from(groupLabels.keys());
    const data = Object.entries(dateMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, groups]) => {
        const row: Record<string, any> = { date: date.slice(5) };
        for (const key of groupKeys) {
          if (groups[key]) {
            row[groupLabels.get(key)!] = Math.min(...groups[key]);
          }
        }
        return row;
      });

    return {
      data,
      products: groupKeys.map((k) => groupLabels.get(k)!),
    };
  }, [bsrRankings]);

  // Sort function
  const sortFn = (a: any, b: any) => {
    if (sortKey === "profit_rate") return b.profit_rate - a.profit_rate;
    if (sortKey === "net_profit") return b.net_profit - a.net_profit;
    if (sortKey === "total_orders") return b.total_orders - a.total_orders;
    return b.total_sales - a.total_sales;
  };

  // Individual sorted products
  const sortedProducts = [...(productSummary as any[])].sort(sortFn);

  // Grouped products
  const groupedProducts = useMemo(() => {
    const groups = groupProducts(productSummary as any[]);
    return groups.sort(sortFn);
  }, [productSummary, sortKey]);

  // Toggle expand
  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Data source for charts (use grouped or individual based on view)
  const chartSource = viewMode === "grouped" ? groupedProducts : sortedProducts;

  // Summary KPIs
  const totalSales = sortedProducts.reduce((s, p: any) => s + p.total_sales, 0);
  const totalProfit = sortedProducts.reduce((s, p: any) => s + (p.net_profit || 0), 0);
  const totalCost = sortedProducts.reduce((s, p: any) => s + (p.total_cost || 0), 0);
  const totalFbaFee = sortedProducts.reduce((s, p: any) => s + (p.total_fba_fee || 0), 0);
  const totalAdSpend = sortedProducts.reduce((s, p: any) => s + (p.total_ad_spend || 0), 0);
  const overallProfitRate = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;

  // Profit bar chart data (top 10)
  const profitChartData = chartSource
    .filter((p: any) => p.total_sales > 0)
    .slice(0, 10)
    .map((p: any) => {
      const name = viewMode === "grouped" ? p.groupName : (p.product?.name || "不明");
      const shortName = name.length > 20 ? name.slice(0, 20) + "…" : name;
      return {
        name: shortName,
        売上: p.total_sales,
        原価: p.total_cost || 0,
        FBA手数料: p.total_fba_fee || 0,
        広告費: p.total_ad_spend || 0,
        利益: p.net_profit || 0,
      };
    });

  // Profit rate comparison chart
  const profitRateData = chartSource
    .filter((p: any) => p.total_sales > 0)
    .slice(0, 10)
    .map((p: any) => {
      const name = viewMode === "grouped" ? p.groupName : (p.product?.name || "不明");
      const shortName = name.length > 15 ? name.slice(0, 15) + "…" : name;
      return {
        name: shortName,
        利益率: Math.round(p.profit_rate * 10) / 10,
        利益: p.net_profit || 0,
      };
    });

  const pieData = chartSource
    .filter((p: any) => p.total_sales > 0)
    .map((p: any, i: number) => ({
      name: (viewMode === "grouped" ? p.groupName : (p.product?.name || "不明")).slice(0, 20),
      value: p.total_sales,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));

  const productOptions = [
    { value: "", label: "商品を選択" },
    ...(products as any[]).map((p: any) => ({ value: p.id, label: p.name })),
  ];

  const selectedProductData = selectedProduct
    ? [...(productDailySales as any[])].reverse().map((d: any) => ({
        date: d.date.slice(5),
        売上: d.sales_amount,
        注文数: d.orders,
      }))
    : [];

  const sortOptions = [
    { value: "total_sales", label: "売上順" },
    { value: "net_profit", label: "利益順" },
    { value: "profit_rate", label: "利益率順" },
    { value: "total_orders", label: "注文数順" },
  ];

  const viewOptions = [
    { value: "grouped", label: "親ASIN別" },
    { value: "individual", label: "子ASIN別" },
  ];

  return (
    <div>
      <PageHeader title="商品別分析" description="商品ごとの売上・利益分析">
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[hsl(var(--border))] overflow-hidden">
            {viewOptions.map(opt => (
              <button
                key={opt.value}
                onClick={() => setViewMode(opt.value)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === opt.value
                    ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                    : "bg-transparent text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <PeriodFilter value={period} onChange={setPeriod} />
        </div>
      </PageHeader>

      {/* Profit KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6 mb-6">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">総売上</p>
            <p className="text-lg font-bold text-[hsl(var(--primary))]">{formatCurrency(totalSales)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">純利益</p>
            <p className={`text-lg font-bold ${totalProfit >= 0 ? "text-green-500" : "text-red-500"}`}>{formatCurrency(totalProfit)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">利益率</p>
            <p className={`text-lg font-bold ${overallProfitRate >= 0 ? "text-green-500" : "text-red-500"}`}>{formatPercent(overallProfitRate)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">原価合計</p>
            <p className="text-lg font-bold">{formatCurrency(totalCost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">FBA手数料</p>
            <p className="text-lg font-bold">{formatCurrency(totalFbaFee)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">広告費</p>
            <p className="text-lg font-bold">{formatCurrency(totalAdSpend)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Profit Breakdown Chart */}
        <Card>
          <CardHeader>
            <CardTitle>商品別 売上・コスト内訳</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={profitChartData} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                <XAxis type="number" stroke="hsl(0 0% 50%)" fontSize={11} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
                <YAxis type="category" dataKey="name" stroke="hsl(0 0% 50%)" fontSize={10} width={120} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }}
                  formatter={(value: any) => formatCurrency(value)}
                />
                <Legend />
                <Bar dataKey="利益" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} />
                <Bar dataKey="原価" stackId="a" fill="#ef4444" radius={[0, 0, 0, 0]} />
                <Bar dataKey="FBA手数料" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                <Bar dataKey="広告費" stackId="a" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Profit Rate Comparison */}
        <Card>
          <CardHeader>
            <CardTitle>商品別 利益率比較</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={profitRateData} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                <XAxis type="number" stroke="hsl(0 0% 50%)" fontSize={11} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="name" stroke="hsl(0 0% 50%)" fontSize={10} width={120} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }}
                  formatter={(value: any, name: string) => name === "利益率" ? `${value}%` : formatCurrency(value)}
                />
                <ReferenceLine x={0} stroke="hsl(0 0% 40%)" />
                <Bar dataKey="利益率" radius={[0, 4, 4, 0]}>
                  {profitRateData.map((entry: any, i: number) => (
                    <Cell key={i} fill={entry["利益率"] >= 0 ? "#22c55e" : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Sales Composition Pie + Product Trend */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mt-6">
        <Card>
          <CardHeader>
            <CardTitle>売上構成比</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}>
                  {pieData.map((entry: any, i: number) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }} formatter={(value: any) => formatCurrency(value)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>商品別推移</CardTitle>
            <Select options={productOptions} value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)} className="w-48" />
          </CardHeader>
          <CardContent>
            {selectedProduct && selectedProductData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={selectedProductData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                  <XAxis dataKey="date" stroke="hsl(0 0% 50%)" fontSize={12} />
                  <YAxis stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }} />
                  <Bar dataKey="売上" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-48 items-center justify-center text-[hsl(var(--muted-foreground))]">
                商品を選択してください
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* BSR Rankings Chart */}
      {bsrChartData && "data" in bsrChartData && bsrChartData.data.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>BSRランキング推移</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={bsrChartData.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                <XAxis dataKey="date" stroke="hsl(0 0% 50%)" fontSize={12} />
                <YAxis
                  stroke="hsl(0 0% 50%)"
                  fontSize={12}
                  reversed
                  label={{ value: "順位", angle: -90, position: "insideLeft", style: { fill: "hsl(0 0% 50%)" } }}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }}
                  formatter={(value: any) => `#${value}`}
                />
                <Legend />
                {bsrChartData.products.map((name: string, i: number) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Detailed Product Table */}
      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>商品別損益テーブル</CardTitle>
          <div className="flex items-center gap-2">
            <Select options={sortOptions} value={sortKey} onChange={(e) => setSortKey(e.target.value)} className="w-36" />
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[200px]">{viewMode === "grouped" ? "商品グループ" : "商品名"}</TableHead>
                <TableHead className="text-right">売上</TableHead>
                <TableHead className="text-right">注文数</TableHead>
                <TableHead className="text-right">原価</TableHead>
                <TableHead className="text-right">FBA手数料</TableHead>
                <TableHead className="text-right">広告費</TableHead>
                <TableHead className="text-right">粗利</TableHead>
                <TableHead className="text-right">純利益</TableHead>
                <TableHead className="text-right">利益率</TableHead>
                <TableHead className="text-right">セッション</TableHead>
                <TableHead className="text-right">CVR</TableHead>
                <TableHead className="text-right">個あたり利益</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {viewMode === "grouped" ? (
                <>
                  {groupedProducts.map((g: GroupedProduct, gi: number) => (
                    <>
                      {/* Group header row */}
                      <TableRow
                        key={`group-${gi}`}
                        className="cursor-pointer hover:bg-[hsl(var(--muted))] transition-colors"
                        onClick={() => toggleGroup(g.groupKey)}
                      >
                        <TableCell className="font-bold text-sm">
                          <span className="mr-2 inline-block w-4 text-center text-[hsl(var(--muted-foreground))]">
                            {expandedGroups.has(g.groupKey) ? "▼" : "▶"}
                          </span>
                          {g.groupName}
                          <span className="ml-2 text-xs text-[hsl(var(--muted-foreground))]">({g.children.length}件)</span>
                        </TableCell>
                        <TableCell className="text-right font-bold text-[hsl(var(--primary))]">{formatCurrency(g.total_sales)}</TableCell>
                        <TableCell className="text-right font-bold">{formatNumber(g.total_orders)}</TableCell>
                        <TableCell className="text-right font-bold text-red-400">{formatCurrency(g.total_cost)}</TableCell>
                        <TableCell className="text-right font-bold text-yellow-400">{formatCurrency(g.total_fba_fee)}</TableCell>
                        <TableCell className="text-right font-bold text-purple-400">{formatCurrency(g.total_ad_spend)}</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(g.gross_profit)}</TableCell>
                        <TableCell className={`text-right font-bold ${g.net_profit >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {formatCurrency(g.net_profit)}
                        </TableCell>
                        <TableCell className={`text-right font-bold ${g.profit_rate >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {formatPercent(g.profit_rate)}
                        </TableCell>
                        <TableCell className="text-right font-bold">{formatNumber(g.total_sessions)}</TableCell>
                        <TableCell className="text-right font-bold">
                          {g.total_sessions > 0 && g.total_sessions >= g.total_orders * 0.5 ? formatPercent((g.total_orders / g.total_sessions) * 100) : "-"}
                        </TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(g.unit_profit)}</TableCell>
                      </TableRow>
                      {/* Expanded children rows */}
                      {expandedGroups.has(g.groupKey) && g.children
                        .sort((a: any, b: any) => b.total_sales - a.total_sales)
                        .map((p: any, ci: number) => (
                        <TableRow key={`child-${gi}-${ci}`} className="bg-[hsl(var(--muted)/0.3)]">
                          <TableCell className="text-sm max-w-[300px] truncate pl-10" title={p.product?.name}>
                            <span className="text-[hsl(var(--muted-foreground))]">└</span>{" "}
                            {p.product?.name || "不明"}
                            {p.product?.asin && (
                              <span className="ml-2 text-xs text-[hsl(var(--muted-foreground))]">{p.product.asin}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(p.total_sales)}</TableCell>
                          <TableCell className="text-right">{formatNumber(p.total_orders)}</TableCell>
                          <TableCell className="text-right text-red-400">{formatCurrency(p.total_cost || 0)}</TableCell>
                          <TableCell className="text-right text-yellow-400">{formatCurrency(p.total_fba_fee || 0)}</TableCell>
                          <TableCell className="text-right text-purple-400">{formatCurrency(p.total_ad_spend || 0)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(p.gross_profit || 0)}</TableCell>
                          <TableCell className={`text-right ${(p.net_profit || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                            {formatCurrency(p.net_profit || 0)}
                          </TableCell>
                          <TableCell className={`text-right ${(p.profit_rate || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                            {formatPercent(p.profit_rate || 0)}
                          </TableCell>
                          <TableCell className="text-right">{formatNumber(p.total_sessions || 0)}</TableCell>
                          <TableCell className="text-right">
                            {(p.total_sessions || 0) > 0 && (p.total_sessions || 0) >= (p.total_orders || 0) * 0.5 ? formatPercent(((p.total_orders || 0) / p.total_sessions) * 100) : "-"}
                          </TableCell>
                          <TableCell className="text-right">{formatCurrency(p.unit_profit || 0)}</TableCell>
                        </TableRow>
                      ))}
                    </>
                  ))}
                </>
              ) : (
                <>
                  {sortedProducts.map((p: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-sm max-w-[300px] truncate" title={p.product?.name}>
                        {p.product?.name || "不明"}
                        {p.product?.asin && (
                          <span className="ml-2 text-xs text-[hsl(var(--muted-foreground))]">{p.product.asin}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(p.total_sales)}</TableCell>
                      <TableCell className="text-right">{formatNumber(p.total_orders)}</TableCell>
                      <TableCell className="text-right text-red-400">{formatCurrency(p.total_cost || 0)}</TableCell>
                      <TableCell className="text-right text-yellow-400">{formatCurrency(p.total_fba_fee || 0)}</TableCell>
                      <TableCell className="text-right text-purple-400">{formatCurrency(p.total_ad_spend || 0)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(p.gross_profit || 0)}</TableCell>
                      <TableCell className={`text-right font-bold ${(p.net_profit || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {formatCurrency(p.net_profit || 0)}
                      </TableCell>
                      <TableCell className={`text-right ${(p.profit_rate || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {formatPercent(p.profit_rate || 0)}
                      </TableCell>
                      <TableCell className="text-right">{formatNumber(p.total_sessions || 0)}</TableCell>
                      <TableCell className="text-right">
                        {(p.total_sessions || 0) > 0 && (p.total_sessions || 0) >= (p.total_orders || 0) * 0.5 ? formatPercent(((p.total_orders || 0) / p.total_sessions) * 100) : "-"}
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(p.unit_profit || 0)}</TableCell>
                    </TableRow>
                  ))}
                </>
              )}
              {/* Total row */}
              {sortedProducts.length > 0 && (
                <TableRow className="border-t-2 border-[hsl(var(--border))] font-bold bg-[hsl(var(--muted))]">
                  <TableCell>合計</TableCell>
                  <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(totalSales)}</TableCell>
                  <TableCell className="text-right">{formatNumber(sortedProducts.reduce((s: number, p: any) => s + p.total_orders, 0))}</TableCell>
                  <TableCell className="text-right text-red-400">{formatCurrency(totalCost)}</TableCell>
                  <TableCell className="text-right text-yellow-400">{formatCurrency(totalFbaFee)}</TableCell>
                  <TableCell className="text-right text-purple-400">{formatCurrency(totalAdSpend)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(totalSales - totalCost - totalFbaFee)}</TableCell>
                  <TableCell className={`text-right ${totalProfit >= 0 ? "text-green-500" : "text-red-500"}`}>{formatCurrency(totalProfit)}</TableCell>
                  <TableCell className={`text-right ${overallProfitRate >= 0 ? "text-green-500" : "text-red-500"}`}>{formatPercent(overallProfitRate)}</TableCell>
                  <TableCell className="text-right">
                    {formatNumber(sortedProducts.reduce((s: number, p: any) => s + (p.total_sessions || 0), 0))}
                  </TableCell>
                  <TableCell className="text-right">
                    {(() => { const ts = sortedProducts.reduce((s: number, p: any) => s + (p.total_sessions || 0), 0); const to = sortedProducts.reduce((s: number, p: any) => s + p.total_orders, 0); return ts > 0 && ts >= to * 0.5 ? formatPercent((to / ts) * 100) : "-"; })()}
                  </TableCell>
                  <TableCell className="text-right">—</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
