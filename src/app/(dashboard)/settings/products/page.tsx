"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { getProducts, createProduct, updateProduct, deleteProduct } from "@/lib/api/products";
import { Plus, Pencil, Trash2, Archive, RefreshCw } from "lucide-react";
import { Product } from "@/types/database";

const emptyProduct = {
  name: "",
  code: "",
  asin: "",
  sku: "",
  parent_asin: "",
  selling_price: 0,
  cost_price: 0,
  fba_fee_rate: 15,
  fba_shipping_fee: 0,
  category: "",
  is_archived: false,
};

export default function ProductsSettingsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null);
  const [form, setForm] = useState(emptyProduct);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: products = [] } = useQuery({
    queryKey: ["products", true],
    queryFn: () => getProducts(true),
  });

  const createMutation = useMutation({
    mutationFn: createProduct,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["products"] }); setDialogOpen(false); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => updateProduct(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["products"] }); setDialogOpen(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProduct,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });

  const openCreate = () => {
    setEditingProduct(null);
    setForm({ ...emptyProduct });
    setDialogOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditingProduct(p);
    setForm({
      name: p.name,
      code: p.code,
      asin: p.asin || "",
      sku: p.sku || "",
      parent_asin: p.parent_asin || "",
      selling_price: p.selling_price,
      cost_price: p.cost_price,
      fba_fee_rate: p.fba_fee_rate,
      fba_shipping_fee: p.fba_shipping_fee || 0,
      category: p.category || "",
      is_archived: p.is_archived,
    });
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingProduct?.id) {
      updateMutation.mutate({ id: editingProduct.id, ...form });
    } else {
      createMutation.mutate(form as any);
    }
  };

  // SP-API Finances API からFBA送料を自動取得して商品マスタを更新
  const handleSyncFbaFees = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      // 過去90日間のFinancialEventsを取得
      const endDate = new Date().toISOString().split("T")[0];
      const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      const res = await fetch("/api/sync/fba-fees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate }),
      });
      const data = await res.json();

      if (data.success) {
        setSyncResult(`✓ ${data.message}（期間: ${startDate} ～ ${endDate}）`);
        queryClient.invalidateQueries({ queryKey: ["products"] });
      } else {
        setSyncResult(`エラー: ${data.error}`);
      }
    } catch (err) {
      setSyncResult(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <PageHeader title="商品マスタ管理" description="商品の仕入原価・手数料率・FBA配送手数料を設定">
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleSyncFbaFees}
            disabled={syncing}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "FBA送料を取得中..." : "SP-APIでFBA送料を自動更新"}
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />商品を追加
          </Button>
        </div>
      </PageHeader>

      {syncResult && (
        <div className={`mb-4 rounded-lg border p-3 text-sm ${syncResult.startsWith("✓") ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-red-500/30 bg-red-500/10 text-red-400"}`}>
          {syncResult}
        </div>
      )}

      {/* FBA送料の説明 */}
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-[hsl(var(--muted-foreground))]">FBA手数料について</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-[hsl(var(--muted-foreground))] space-y-1">
          <p>• <strong className="text-[hsl(var(--foreground))]">手数料率（紹介料）</strong> = 売上の何%をAmazonに支払うか（例: 15%）</p>
          <p>• <strong className="text-[hsl(var(--foreground))]">FBA配送手数料</strong> = 1個出荷ごとにAmazonが請求する固定の配送手数料（例: ¥532/個）</p>
          <p>• 純利益 = 売上 − 原価 − 紹介料 − FBA配送手数料 − 広告費</p>
          <p>• 「SP-APIでFBA送料を自動更新」ボタンで過去90日の実績値をSP-API Finances APIから自動取得できます</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>商品名</TableHead>
                <TableHead>コード</TableHead>
                <TableHead>ASIN / SKU</TableHead>
                <TableHead className="text-right">販売価格</TableHead>
                <TableHead className="text-right">原価</TableHead>
                <TableHead className="text-right">紹介料率</TableHead>
                <TableHead className="text-right">FBA配送手数料</TableHead>
                <TableHead>ステータス</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(products as Product[]).map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell><Badge variant="secondary">{p.code}</Badge></TableCell>
                  <TableCell className="text-sm text-[hsl(var(--muted-foreground))]">
                    {p.asin && <span>{p.asin}</span>}
                    {p.asin && p.sku && <span className="mx-1">/</span>}
                    {p.sku && <span className="text-xs">{p.sku}</span>}
                    {!p.asin && !p.sku && "-"}
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(p.selling_price)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(p.cost_price)}</TableCell>
                  <TableCell className="text-right">{p.fba_fee_rate}%</TableCell>
                  <TableCell className="text-right">
                    {(p.fba_shipping_fee || 0) > 0
                      ? <span className="text-yellow-400">{formatCurrency(p.fba_shipping_fee || 0)}/個</span>
                      : <span className="text-[hsl(var(--muted-foreground))] text-xs">未設定</span>
                    }
                  </TableCell>
                  <TableCell>
                    {p.is_archived
                      ? <Badge variant="secondary">アーカイブ</Badge>
                      : <Badge variant="success">有効</Badge>
                    }
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => updateProduct(p.id, { is_archived: !p.is_archived }).then(() => queryClient.invalidateQueries({ queryKey: ["products"] }))}
                      >
                        <Archive className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => { if (confirm("削除しますか？")) deleteMutation.mutate(p.id); }}
                      >
                        <Trash2 className="h-4 w-4 text-[hsl(var(--destructive))]" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader>
          <DialogTitle>{editingProduct ? "商品を編集" : "商品を追加"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-[hsl(var(--muted-foreground))]">商品名</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="text-sm text-[hsl(var(--muted-foreground))]">コード</label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
            </div>
            <div>
              <label className="text-sm text-[hsl(var(--muted-foreground))]">ASIN（子ASIN）</label>
              <Input value={form.asin} onChange={(e) => setForm({ ...form, asin: e.target.value })} />
            </div>
            <div>
              <label className="text-sm text-[hsl(var(--muted-foreground))]">SKU</label>
              <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </div>
            <div className="col-span-2">
              <label className="text-sm text-[hsl(var(--muted-foreground))]">親ASIN（BSRスクレイプ用・バリエーション親）</label>
              <Input
                value={form.parent_asin}
                onChange={(e) => setForm({ ...form, parent_asin: e.target.value })}
                placeholder="例: B0BFKZVM1U"
              />
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">同じ商品グループに属する全バリエーションで同じ親ASINを設定してください。BSR日次スクレイプはこのASINを使います。</p>
            </div>
            <div>
              <label className="text-sm text-[hsl(var(--muted-foreground))]">販売価格</label>
              <Input type="number" value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: Number(e.target.value) })} />
            </div>
            <div>
              <label className="text-sm text-[hsl(var(--muted-foreground))]">原価（仕入れ値）</label>
              <Input type="number" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: Number(e.target.value) })} />
            </div>
            <div>
              <label className="text-sm text-[hsl(var(--muted-foreground))]">紹介料率（%）</label>
              <Input
                type="number"
                step="0.1"
                value={form.fba_fee_rate}
                onChange={(e) => setForm({ ...form, fba_fee_rate: Number(e.target.value) })}
              />
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">売上の何%をAmazonに支払うか（通常15%）</p>
            </div>
            <div>
              <label className="text-sm text-[hsl(var(--muted-foreground))]">FBA配送手数料（円/個）</label>
              <Input
                type="number"
                value={form.fba_shipping_fee}
                onChange={(e) => setForm({ ...form, fba_shipping_fee: Number(e.target.value) })}
              />
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">1個出荷あたりの固定送料（例: 532）</p>
            </div>
            <div>
              <label className="text-sm text-[hsl(var(--muted-foreground))]">カテゴリ</label>
              <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>キャンセル</Button>
            <Button type="submit">{editingProduct ? "更新" : "追加"}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
