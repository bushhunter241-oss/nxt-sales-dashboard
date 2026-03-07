"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { getExpenses, createExpense, deleteExpense } from "@/lib/api/expenses";
import { getProducts } from "@/lib/api/products";
import { EXPENSE_TYPES } from "@/lib/constants";
import { Plus, Trash2 } from "lucide-react";

export default function ExpensesSettingsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ product_id: "", date: new Date().toISOString().split("T")[0], expense_type: "fee" as const, amount: 0, notes: "" });
  const queryClient = useQueryClient();

  const { data: expenses = [] } = useQuery({
    queryKey: ["expenses"],
    queryFn: () => getExpenses({}),
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });

  const createMutation = useMutation({
    mutationFn: createExpense,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["expenses"] }); setDialogOpen(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteExpense,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });

  const productOptions = [{ value: "", label: "全体（商品なし）" }, ...(products as any[]).map((p: any) => ({ value: p.id, label: p.name }))];
  const typeLabel = (t: string) => EXPENSE_TYPES.find((e) => e.value === t)?.label || t;

  return (
    <div>
      <PageHeader title="経費・原価管理" description="経費の登録・管理">
        <Button onClick={() => setDialogOpen(true)}><Plus className="mr-2 h-4 w-4" />経費を追加</Button>
      </PageHeader>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日付</TableHead>
                <TableHead>種別</TableHead>
                <TableHead>商品</TableHead>
                <TableHead className="text-right">金額</TableHead>
                <TableHead>メモ</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(expenses as any[]).map((e: any) => (
                <TableRow key={e.id}>
                  <TableCell>{formatDate(e.date)}</TableCell>
                  <TableCell><Badge variant="secondary">{typeLabel(e.expense_type)}</Badge></TableCell>
                  <TableCell>{e.product?.name || "全体"}</TableCell>
                  <TableCell className="text-right">{formatCurrency(e.amount)}</TableCell>
                  <TableCell className="text-sm text-[hsl(var(--muted-foreground))]">{e.notes || "-"}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm("削除しますか？")) deleteMutation.mutate(e.id); }}><Trash2 className="h-4 w-4 text-[hsl(var(--destructive))]" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader><DialogTitle>経費を追加</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate({ ...form, product_id: form.product_id || null } as any); }} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">日付</label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">種別</label><Select options={EXPENSE_TYPES.map((t) => ({ value: t.value, label: t.label }))} value={form.expense_type} onChange={(e) => setForm({ ...form, expense_type: e.target.value as any })} /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">商品</label><Select options={productOptions} value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} /></div>
            <div><label className="text-sm text-[hsl(var(--muted-foreground))]">金額</label><Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} required /></div>
          </div>
          <div><label className="text-sm text-[hsl(var(--muted-foreground))]">メモ</label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>キャンセル</Button>
            <Button type="submit">追加</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
