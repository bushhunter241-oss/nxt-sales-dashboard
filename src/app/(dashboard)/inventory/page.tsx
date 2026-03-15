"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatNumber, formatDate } from "@/lib/utils";
import { getInventory, upsertInventory, getInventoryLogs, createInventoryLog } from "@/lib/api/inventory";
import { getProducts } from "@/lib/api/products";
import { INVENTORY_CHANGE_TYPES } from "@/lib/constants";
import { Plus, AlertTriangle, Package, ArrowDownUp } from "lucide-react";

export default function InventoryPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [form, setForm] = useState({ product_id: "", current_stock: 0, reorder_point: 10, lead_days: 14, notes: "" });
  const [logForm, setLogForm] = useState({ product_id: "", change_amount: 0, change_type: "inbound" as string, notes: "", date: new Date().toISOString().split("T")[0] });
  const queryClient = useQueryClient();

  const { data: inventory = [] } = useQuery({ queryKey: ["inventory"], queryFn: getInventory });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => getProducts() });
  const { data: logs = [] } = useQuery({
    queryKey: ["inventoryLogs", selectedProduct],
    queryFn: () => getInventoryLogs(selectedProduct || undefined),
  });

  const upsertMutation = useMutation({
    mutationFn: (data: any) => upsertInventory(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["inventory"] }); setDialogOpen(false); },
  });

  const logMutation = useMutation({
    mutationFn: (data: any) => createInventoryLog(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["inventoryLogs"] });
      setLogDialogOpen(false);
    },
  });

  const productOptions = (products as any[]).map((p: any) => ({ value: p.id, label: p.name }));
  const lowStock = (inventory as any[]).filter((inv: any) => inv.current_stock <= inv.reorder_point);

  return (
    <div>
      <PageHeader title="在庫管理" description="商品ごとの在庫状況を管理">
        <Button variant="outline" onClick={() => { setLogForm({ ...logForm, product_id: productOptions[0]?.value || "" }); setLogDialogOpen(true); }}>
          <ArrowDownUp className="mr-2 h-4 w-4" />入出庫登録
        </Button>
        <Button onClick={() => { setForm({ product_id: productOptions[0]?.value || "", current_stock: 0, reorder_point: 10, lead_days: 14, notes: "" }); setDialogOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" />在庫設定
        </Button>
      </PageHeader>

      {lowStock.length > 0 && (
        <Card className="mb-6 border-[hsl(var(--warning))]">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="h-5 w-5 text-[hsl(var(--warning))]" />
            <span className="font-medium">在庫アラート: </span>
            {lowStock.map((inv: any) => (
              <Badge key={inv.id} variant="destructive">{inv.product?.name}: 残{inv.current_stock}個</Badge>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>在庫一覧</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>商品名</TableHead>
                <TableHead className="text-right">現在在庫</TableHead>
                <TableHead className="text-right">発注点</TableHead>
                <TableHead className="text-right">リードタイム</TableHead>
                <TableHead>ステータス</TableHead>
                <TableHead>メモ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(inventory as any[]).map((inv: any) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">{inv.product?.name || "不明"}</TableCell>
                  <TableCell className="text-right text-lg font-bold">{formatNumber(inv.current_stock)}</TableCell>
                  <TableCell className="text-right">{formatNumber(inv.reorder_point)}</TableCell>
                  <TableCell className="text-right">{inv.lead_days}日</TableCell>
                  <TableCell>
                    {inv.current_stock <= inv.reorder_point
                      ? <Badge variant="destructive">要発注</Badge>
                      : inv.current_stock <= inv.reorder_point * 2
                        ? <Badge variant="secondary">注意</Badge>
                        : <Badge variant="success">正常</Badge>}
                  </TableCell>
                  <TableCell className="text-sm text-[hsl(var(--muted-foreground))]">{inv.notes || "-"}</TableCell>
                </TableRow>
              ))}
              {(inventory as any[]).length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-[hsl(var(--muted-foreground))]">在庫データがありません。「在庫設定」から登録してください。</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>入出庫履歴</CardTitle>
          <Select options={[{ value: "", label: "全商品" }, ...productOptions]} value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)} className="w-48" />
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日付</TableHead>
                <TableHead>商品</TableHead>
                <TableHead>種別</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead>メモ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(logs as any[]).map((log: any) => (
                <TableRow key={log.id}>
                  <TableCell>{formatDate(log.date)}</TableCell>
                  <TableCell>{log.product?.name || "不明"}</TableCell>
                  <TableCell><Badge variant={log.change_type === "inbound" ? "success" : log.change_type === "outbound" ? "destructive" : "secondary"}>{INVENTORY_CHANGE_TYPES.find((t) => t.value === log.change_type)?.label || log.change_type}</Badge></TableCell>
                  <TableCell className={`text-right font-medium ${log.change_amount > 0 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--destructive))]"}`}>{log.change_amount > 0 ? "+" : ""}{log.change_amount}</TableCell>
                  <TableCell className="text-sm text-[hsl(var(--muted-foreground))]">{log.notes || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader><DialogTitle>在庫設定</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); upsertMutation.mutate(form); }} className="space-y-4">
          <div><label className="text-sm text-[hsl(var(--muted-foreground))]">商品</label><Select options={productOptions} value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} /></div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">現在在庫</label><Input type="number" value={form.current_stock} onChange={(e) => setForm({ ...form, current_stock: Number(e.target.value) })} /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">発注点</label><Input type="number" value={form.reorder_point} onChange={(e) => setForm({ ...form, reorder_point: Number(e.target.value) })} /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">リードタイム(日)</label><Input type="number" value={form.lead_days} onChange={(e) => setForm({ ...form, lead_days: Number(e.target.value) })} /></div>
          </div>
          <div><label className="text-sm text-[hsl(var(--muted-foreground))]">メモ</label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>キャンセル</Button><Button type="submit">保存</Button></div>
        </form>
      </Dialog>

      <Dialog open={logDialogOpen} onOpenChange={setLogDialogOpen}>
        <DialogHeader><DialogTitle>入出庫登録</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); logMutation.mutate(logForm); }} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">商品</label><Select options={productOptions} value={logForm.product_id} onChange={(e) => setLogForm({ ...logForm, product_id: e.target.value })} /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">種別</label><Select options={INVENTORY_CHANGE_TYPES.map((t) => ({ value: t.value, label: t.label }))} value={logForm.change_type} onChange={(e) => setLogForm({ ...logForm, change_type: e.target.value })} /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">日付</label><Input type="date" value={logForm.date} onChange={(e) => setLogForm({ ...logForm, date: e.target.value })} /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">数量</label><Input type="number" value={logForm.change_amount} onChange={(e) => setLogForm({ ...logForm, change_amount: Number(e.target.value) })} /></div>
          </div>
          <div><label className="text-sm text-[hsl(var(--muted-foreground))]">メモ</label><Input value={logForm.notes} onChange={(e) => setLogForm({ ...logForm, notes: e.target.value })} /></div>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setLogDialogOpen(false)}>キャンセル</Button><Button type="submit">登録</Button></div>
        </form>
      </Dialog>
    </div>
  );
}
