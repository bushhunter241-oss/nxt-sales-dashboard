"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { getProducts } from "@/lib/api/products";
import { Calculator, ArrowRight } from "lucide-react";

export default function SimulationPage() {
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => getProducts() });
  const [selectedProduct, setSelectedProduct] = useState("");

  const product = (products as any[]).find((p: any) => p.id === selectedProduct);

  const [sellingPrice, setSellingPrice] = useState(0);
  const [costPrice, setCostPrice] = useState(0);
  const [fbaFeeRate, setFbaFeeRate] = useState(15);
  const [adSpendPerUnit, setAdSpendPerUnit] = useState(0);
  const [monthlyUnits, setMonthlyUnits] = useState(30);

  const handleProductChange = (id: string) => {
    setSelectedProduct(id);
    const p = (products as any[]).find((pr: any) => pr.id === id);
    if (p) {
      setSellingPrice(p.selling_price);
      setCostPrice(p.cost_price);
      setFbaFeeRate(p.fba_fee_rate);
    }
  };

  const fbaFee = Math.round(sellingPrice * (fbaFeeRate / 100));
  const profitPerUnit = sellingPrice - costPrice - fbaFee - adSpendPerUnit;
  const profitRate = sellingPrice > 0 ? (profitPerUnit / sellingPrice) * 100 : 0;
  const monthlySales = sellingPrice * monthlyUnits;
  const monthlyProfit = profitPerUnit * monthlyUnits;
  const monthlyCost = costPrice * monthlyUnits;
  const monthlyFee = fbaFee * monthlyUnits;
  const monthlyAdSpend = adSpendPerUnit * monthlyUnits;

  const currentProfit = product ? product.selling_price - product.cost_price - Math.round(product.selling_price * (product.fba_fee_rate / 100)) : 0;

  const productOptions = [{ value: "", label: "商品を選択" }, ...(products as any[]).map((p: any) => ({ value: p.id, label: p.name }))];

  return (
    <div>
      <PageHeader title="利益シミュレーション" description="価格や広告費を変更した場合の利益を予測" />

      <div className="mb-6">
        <Select options={productOptions} value={selectedProduct} onChange={(e) => handleProductChange(e.target.value)} className="w-64" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Calculator className="h-5 w-5" />シミュレーション入力</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-[hsl(var(--muted-foreground))]">販売価格</label>
                <Input type="number" value={sellingPrice} onChange={(e) => setSellingPrice(Number(e.target.value))} />
                {product && <span className="text-xs text-[hsl(var(--muted-foreground))]">現在: {formatCurrency(product.selling_price)}</span>}
              </div>
              <div>
                <label className="text-sm text-[hsl(var(--muted-foreground))]">原価</label>
                <Input type="number" value={costPrice} onChange={(e) => setCostPrice(Number(e.target.value))} />
                {product && <span className="text-xs text-[hsl(var(--muted-foreground))]">現在: {formatCurrency(product.cost_price)}</span>}
              </div>
              <div>
                <label className="text-sm text-[hsl(var(--muted-foreground))]">手数料率(%)</label>
                <Input type="number" step="0.1" value={fbaFeeRate} onChange={(e) => setFbaFeeRate(Number(e.target.value))} />
              </div>
              <div>
                <label className="text-sm text-[hsl(var(--muted-foreground))]">1個あたり広告費</label>
                <Input type="number" value={adSpendPerUnit} onChange={(e) => setAdSpendPerUnit(Number(e.target.value))} />
              </div>
              <div className="col-span-2">
                <label className="text-sm text-[hsl(var(--muted-foreground))]">月間販売個数(予測)</label>
                <Input type="number" value={monthlyUnits} onChange={(e) => setMonthlyUnits(Number(e.target.value))} />
                <input type="range" min="1" max="500" value={monthlyUnits} onChange={(e) => setMonthlyUnits(Number(e.target.value))} className="w-full mt-2 accent-[hsl(var(--primary))]" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>シミュレーション結果</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between border-b border-[hsl(var(--border))] pb-2">
                <span className="text-[hsl(var(--muted-foreground))]">販売価格</span>
                <span className="font-medium">{formatCurrency(sellingPrice)}</span>
              </div>
              <div className="flex justify-between border-b border-[hsl(var(--border))] pb-2">
                <span className="text-[hsl(var(--muted-foreground))]">- 原価</span>
                <span>{formatCurrency(costPrice)}</span>
              </div>
              <div className="flex justify-between border-b border-[hsl(var(--border))] pb-2">
                <span className="text-[hsl(var(--muted-foreground))]">- 手数料 ({fbaFeeRate}%)</span>
                <span>{formatCurrency(fbaFee)}</span>
              </div>
              <div className="flex justify-between border-b border-[hsl(var(--border))] pb-2">
                <span className="text-[hsl(var(--muted-foreground))]">- 広告費/個</span>
                <span>{formatCurrency(adSpendPerUnit)}</span>
              </div>
              <div className="flex justify-between border-b border-[hsl(var(--border))] pb-2 text-lg">
                <span className="font-bold">1個あたり利益</span>
                <span className={`font-bold ${profitPerUnit >= 0 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--destructive))]"}`}>
                  {formatCurrency(profitPerUnit)}
                </span>
              </div>
              <div className="flex justify-between pb-2">
                <span className="text-[hsl(var(--muted-foreground))]">利益率</span>
                <span className={profitRate >= 30 ? "text-[hsl(var(--success))]" : profitRate >= 15 ? "text-[hsl(var(--warning))]" : "text-[hsl(var(--destructive))]"}>
                  {formatPercent(profitRate)}
                </span>
              </div>

              {product && (
                <div className="mt-4 rounded-lg bg-[hsl(var(--muted))] p-3">
                  <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
                    現在の1個あたり利益: {formatCurrency(currentProfit)}
                    <ArrowRight className="h-4 w-4" />
                    <span className={profitPerUnit > currentProfit ? "text-[hsl(var(--success))]" : "text-[hsl(var(--destructive))]"}>
                      {formatCurrency(profitPerUnit)} ({profitPerUnit > currentProfit ? "+" : ""}{formatCurrency(profitPerUnit - currentProfit)})
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 rounded-lg border border-[hsl(var(--border))] p-4">
              <h4 className="font-medium mb-3">月間予測 ({monthlyUnits}個販売時)</h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-[hsl(var(--muted-foreground))]">月間売上</span><p className="text-lg font-bold">{formatCurrency(monthlySales)}</p></div>
                <div><span className="text-[hsl(var(--muted-foreground))]">月間利益</span><p className={`text-lg font-bold ${monthlyProfit >= 0 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--destructive))]"}`}>{formatCurrency(monthlyProfit)}</p></div>
                <div><span className="text-[hsl(var(--muted-foreground))]">月間原価</span><p>{formatCurrency(monthlyCost)}</p></div>
                <div><span className="text-[hsl(var(--muted-foreground))]">月間手数料</span><p>{formatCurrency(monthlyFee)}</p></div>
                <div><span className="text-[hsl(var(--muted-foreground))]">月間広告費</span><p>{formatCurrency(monthlyAdSpend)}</p></div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
