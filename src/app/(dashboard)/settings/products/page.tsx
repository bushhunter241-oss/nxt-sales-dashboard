"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { getProducts, createProduct, updateProduct, deleteProduct } from "@/lib/api/products";
import { Plus, Pencil, Trash2, Archive } from "lucide-react";
import { Product } from "@/types/database";

const emptyProduct = { name: "", code: "", asin: "", sku: "", selling_price: 0, cost_price: 0, fba_fee_rate: 15, category: "", is_archived: false };

export default function ProductsSettingsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null);
  const [form, setForm] = useState(emptyProduct);
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

  const openCreate = () => { setEditingProduct(null); setForm({ ...emptyProduct }); setDialogOpen(true); };
  const openEdit = (p: Product) => { setEditingProduct(p); setForm({ name: p.name, code: p.code, asin: p.asin || "", sku: p.sku || "", selling_price: p.selling_price, cost_price: p.cost_price, fba_fee_rate: p.fba_fee_rate, category: p.category || "", is_archived: p.is_archived }); setDialogOpen(true); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingProduct?.id) {
      updateMutation.mutate({ id: editingProduct.id, ...form });
    } else {
      createMutation.mutate(form as any);
    }
  };

  return (
    <div>
      <PageHeader title="商品マスタ管理" description="商品の仕入原価・手数料率・販売価格を設定">
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />商品を追加</Button>
      </PageHeader>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>商品名</TableHead>
                <TableHead>コード</TableHead>
                <TableHead>ASIN</TableHead>
                <TableHead className="text-right">販売価格</TableHead>
                <TableHead className="text-right">原価</TableHead>
                <TableHead className="text-right">手数料率</TableHead>
                <TableHead>ステータス</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(products as Product[]).map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell><Badge variant="secondary">{p.code}</Badge></TableCell>
                  <TableCell className="text-sm text-[hsl(var(--muted-foreground))]">{p.asin || "-"}</TableCell>
                  <TableCell className="text-right">{formatCurrency(p.selling_price)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(p.cost_price)}</TableCell>
                  <TableCell className="text-right">{p.fba_fee_rate}%</TableCell>
                  <TableCell>{p.is_archived ? <Badge variant="secondary">アーカイブ</Badge> : <Badge variant="success">有効</Badge>}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => updateProduct(p.id, { is_archived: !p.is_archived }).then(() => queryClient.invalidateQueries({ queryKey: ["products"] }))}><Archive className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => { if (confirm("削除しますか？")) deleteMutation.mutate(p.id); }}><Trash2 className="h-4 w-4 text-[hsl(var(--destructive))]" /></Button>
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
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">商品名</label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">コード</label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">ASIN</label><Input value={form.asin} onChange={(e) => setForm({ ...form, asin: e.target.value })} /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">SKU</label><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">販売価格</label><Input type="number" value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: Number(e.target.value) })} /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">原価</label><Input type="number" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: Number(e.target.value) })} /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">手数料率(%)</label><Input type="number" step="0.1" value={form.fba_fee_rate} onChange={(e) => setForm({ ...form, fba_fee_rate: Number(e.target.value) })} /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">カテゴリ</label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
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
