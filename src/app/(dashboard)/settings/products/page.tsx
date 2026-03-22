"use client";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { getProducts, createProduct, updateProduct, deleteProduct } from "@/lib/api/products";
import { getRakutenProducts, createRakutenProduct, updateRakutenProduct, deleteRakutenProduct } from "@/lib/api/rakuten-products";
import { getProductGroups, createProductGroup, deleteProductGroup } from "@/lib/api/product-groups";
import { Plus, Pencil, Trash2, Archive, RefreshCw, ChevronRight, ChevronDown, FolderOpen } from "lucide-react";
import { Product, RakutenProduct } from "@/types/database";

// ─── Empty forms ───
const emptyAmz = { name: "", code: "", asin: "", sku: "", parent_asin: "", product_group: "", selling_price: 0, cost_price: 0, fba_fee_rate: 15, fba_shipping_fee: 0, category: "", is_archived: false };
const emptyRkt = { name: "", product_id: "", sku: "", product_group: "", parent_product_id: "", selling_price: 0, cost_price: 0, fee_rate: 10, shipping_fee: 0, category: "", is_archived: false };

// ─── Group selector component ───
function GroupSelector({ value, onChange, groups, newGroupMode, setNewGroupMode, newGroupName, setNewGroupName, onAddGroup }: {
  value: string; onChange: (v: string) => void; groups: string[];
  newGroupMode: boolean; setNewGroupMode: (v: boolean) => void;
  newGroupName: string; setNewGroupName: (v: string) => void;
  onAddGroup: () => void;
}) {
  return (
    <div>
      <label className="text-sm text-[hsl(var(--muted-foreground))]">商品グループ</label>
      {!newGroupMode ? (
        <Select
          options={[...groups.map(g => ({ value: g, label: g })), { value: "__new__", label: "＋ 新しいグループを入力" }]}
          value={value}
          onChange={(e) => {
            if (e.target.value === "__new__") { setNewGroupMode(true); setNewGroupName(""); }
            else onChange(e.target.value);
          }}
        />
      ) : (
        <div className="flex gap-1">
          <Input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="新グループ名" className="flex-1" />
          <Button type="button" size="sm" onClick={() => { if (newGroupName.trim()) { onAddGroup(); onChange(newGroupName.trim()); setNewGroupMode(false); } }}>追加</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setNewGroupMode(false)}>戻す</Button>
        </div>
      )}
    </div>
  );
}

export default function ProductsSettingsPage() {
  const [tab, setTab] = useState<"amazon" | "rakuten">("amazon");
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [newGroupInput, setNewGroupInput] = useState("");
  const queryClient = useQueryClient();

  // ─── Product groups ───
  const { data: productGroupsList = [] } = useQuery({ queryKey: ["productGroups"], queryFn: getProductGroups });
  const groupNames = useMemo(() => (productGroupsList as any[]).map((g: any) => g.name).sort(), [productGroupsList]);
  const addGroupMutation = useMutation({ mutationFn: createProductGroup, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["productGroups"] }) });
  const deleteGroupMutation = useMutation({ mutationFn: deleteProductGroup, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["productGroups"] }) });

  // Shared new group mode state for forms
  const [newGroupMode, setNewGroupMode] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  // ─── Amazon state ───
  const [amzDialog, setAmzDialog] = useState(false);
  const [amzEditing, setAmzEditing] = useState<Partial<Product> | null>(null);
  const [amzForm, setAmzForm] = useState(emptyAmz);
  const [amzIsParentOnly, setAmzIsParentOnly] = useState(false);
  const [amzExpanded, setAmzExpanded] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const { data: amazonProducts = [] } = useQuery({ queryKey: ["products", true], queryFn: () => getProducts(true) });
  const amzCreate = useMutation({ mutationFn: createProduct, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["products"] }); setAmzDialog(false); }, onError: (e: any) => alert(`エラー: ${e.message}`) });
  const amzUpdate = useMutation({ mutationFn: ({ id, ...d }: any) => updateProduct(id, d), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["products"] }); setAmzDialog(false); }, onError: (e: any) => alert(`エラー: ${e.message}`) });
  const amzDelete = useMutation({ mutationFn: deleteProduct, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }), onError: (e: any) => alert(`エラー: ${e.message}`) });

  // Amazon group structure: group by product_group, smart representative selection
  const amzGrouped = useMemo(() => {
    const groups = new Map<string, Product[]>();
    const standalone: Product[] = [];
    for (const p of amazonProducts as Product[]) {
      const grp = p.product_group;
      if (!grp) { standalone.push(p); continue; }
      if (!groups.has(grp)) groups.set(grp, []);
      groups.get(grp)!.push(p);
    }

    const result: Array<{ representative: Product; children: Product[]; groupKey: string }> = [];
    for (const [grp, members] of groups) {
      if (members.length === 1) { standalone.push(members[0]); continue; }

      // Collect all parent_asin values pointed to by other members
      const pointedAsins = new Set(members.map(m => m.parent_asin).filter(Boolean));

      // Score each member to determine representative (lower = more likely parent)
      const scored = members.map(p => {
        let score = 0;
        // 1. Zero price+cost = explicit parent container (TOP PRIORITY)
        if (p.selling_price === 0 && p.cost_price === 0) score -= 10000;
        // 2. Pointed to by others as parent_asin
        if (p.asin && pointedAsins.has(p.asin)) score -= 1000;
        // 3. No parent_asin or self-referencing = likely parent
        if (!p.parent_asin || p.parent_asin === p.asin) score -= 10;
        // 4. Stable tiebreak: ASIN/code alphabetical (not name length)
        return { product: p, score, sortKey: p.asin || p.code || p.name };
      });

      scored.sort((a, b) => a.score !== b.score ? a.score - b.score : a.sortKey.localeCompare(b.sortKey));
      result.push({ representative: scored[0].product, children: scored.slice(1).map(s => s.product), groupKey: grp });
    }

    for (const p of standalone) {
      result.push({ representative: p, children: [], groupKey: p.id });
    }
    return result.sort((a, b) => a.representative.name.localeCompare(b.representative.name));
  }, [amazonProducts]);

  const openAmzCreate = () => { setAmzEditing(null); setAmzForm({ ...emptyAmz }); setAmzIsParentOnly(false); setNewGroupMode(false); setAmzDialog(true); };
  const openAmzEdit = (p: Product) => {
    setAmzEditing(p);
    setAmzForm({ name: p.name, code: p.code || p.asin || "", asin: p.asin || "", sku: p.sku || "", parent_asin: p.parent_asin || "", product_group: p.product_group || "", selling_price: p.selling_price, cost_price: p.cost_price, fba_fee_rate: p.fba_fee_rate, fba_shipping_fee: p.fba_shipping_fee || 0, category: p.category || "", is_archived: p.is_archived });
    setAmzIsParentOnly(false); setNewGroupMode(false); setAmzDialog(true);
  };
  const openAmzCreateChild = (parent: Product) => {
    setAmzEditing(null);
    setAmzForm({ ...emptyAmz, parent_asin: parent.asin || parent.code || "", product_group: parent.product_group || "", fba_fee_rate: parent.fba_fee_rate, fba_shipping_fee: parent.fba_shipping_fee || 0 });
    setNewGroupMode(false);
    setAmzIsParentOnly(false);
    setAmzDialog(true);
  };
  const handleAmzSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      ...amzForm,
      code: amzForm.code.trim() || amzForm.asin.trim() || crypto.randomUUID().slice(0, 8),
      asin: amzForm.asin.trim() || null,
      sku: amzForm.sku.trim() || null,
      parent_asin: amzForm.parent_asin.trim() || null,
      product_group: amzForm.product_group.trim() || null,
      category: amzForm.category.trim() || null,
    };
    amzEditing?.id ? amzUpdate.mutate({ id: amzEditing.id, ...data }) : amzCreate.mutate(data as any);
  };
  const toggleAmzExpand = (key: string) => setAmzExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const handleSyncFbaFees = async () => {
    setSyncing(true); setSyncResult(null);
    try {
      const endDate = new Date().toISOString().split("T")[0];
      const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const res = await fetch("/api/sync/fba-fees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startDate, endDate }) });
      const data = await res.json();
      if (data.success) { setSyncResult(`✓ ${data.message}`); queryClient.invalidateQueries({ queryKey: ["products"] }); }
      else setSyncResult(`エラー: ${data.error}`);
    } catch (err) { setSyncResult(`エラー: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setSyncing(false); }
  };

  // ─── Rakuten state ───
  const [rktDialog, setRktDialog] = useState(false);
  const [rktEditing, setRktEditing] = useState<Partial<RakutenProduct> | null>(null);
  const [rktForm, setRktForm] = useState(emptyRkt);
  const [rktExpanded, setRktExpanded] = useState<Set<string>>(new Set());

  const { data: rakutenProducts = [] } = useQuery({ queryKey: ["rakutenProducts", true], queryFn: () => getRakutenProducts(true) });
  const rktCreate = useMutation({ mutationFn: createRakutenProduct, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["rakutenProducts"] }); setRktDialog(false); }, onError: (e: any) => alert(`エラー: ${e.message}`) });
  const rktUpdate = useMutation({ mutationFn: ({ id, ...d }: any) => updateRakutenProduct(id, d), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["rakutenProducts"] }); setRktDialog(false); }, onError: (e: any) => alert(`エラー: ${e.message}`) });
  const rktDelete = useMutation({ mutationFn: deleteRakutenProduct, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rakutenProducts"] }), onError: (e: any) => alert(`エラー: ${e.message}`) });

  const rktParents = useMemo(() => (rakutenProducts as RakutenProduct[]).filter(p => !p.parent_product_id), [rakutenProducts]);
  const rktChildrenMap = useMemo(() => {
    const map = new Map<string, RakutenProduct[]>();
    for (const p of rakutenProducts as RakutenProduct[]) {
      if (p.parent_product_id) {
        if (!map.has(p.parent_product_id)) map.set(p.parent_product_id, []);
        map.get(p.parent_product_id)!.push(p);
      }
    }
    return map;
  }, [rakutenProducts]);
  const rktParentOptions = rktParents.map(p => ({ value: p.product_id, label: `${p.name} (${p.product_id})` }));

  const openRktCreate = () => { setRktEditing(null); setRktForm({ ...emptyRkt }); setNewGroupMode(false); setRktDialog(true); };
  const openRktEdit = (p: RakutenProduct) => {
    setRktEditing(p);
    setRktForm({ name: p.name, product_id: p.product_id, sku: p.sku || "", product_group: p.product_group || "", parent_product_id: p.parent_product_id || "", selling_price: p.selling_price, cost_price: p.cost_price, fee_rate: p.fee_rate, shipping_fee: p.shipping_fee || 0, category: p.category || "", is_archived: p.is_archived });
    setNewGroupMode(false); setRktDialog(true);
  };
  const openRktCreateChild = (parent: RakutenProduct) => {
    setRktEditing(null);
    setRktForm({ ...emptyRkt, parent_product_id: parent.product_id, product_group: parent.product_group || "", fee_rate: parent.fee_rate, shipping_fee: parent.shipping_fee || 0 });
    setNewGroupMode(false);
    setRktDialog(true);
  };
  const handleRktSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      ...rktForm,
      sku: rktForm.sku.trim() || null,
      parent_product_id: rktForm.parent_product_id.trim() || null,
      product_group: rktForm.product_group.trim() || null,
      category: rktForm.category.trim() || null,
    };
    rktEditing?.id ? rktUpdate.mutate({ id: rktEditing.id, ...data }) : rktCreate.mutate(data as any);
  };
  const toggleRktExpand = (pid: string) => setRktExpanded(prev => { const n = new Set(prev); n.has(pid) ? n.delete(pid) : n.add(pid); return n; });

  // ─── Shared row renderer ───
  const ActionButtons = ({ onEdit, onArchive, onDelete, onAddChild }: { onEdit: () => void; onArchive: () => void; onDelete: () => void; onAddChild?: () => void }) => (
    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {onAddChild && <Button variant="ghost" size="icon" onClick={onAddChild} title="バリエーション追加"><Plus className="h-4 w-4 text-green-500" /></Button>}
      <Button variant="ghost" size="icon" onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
      <Button variant="ghost" size="icon" onClick={onArchive}><Archive className="h-4 w-4" /></Button>
      <Button variant="ghost" size="icon" onClick={onDelete}><Trash2 className="h-4 w-4 text-[hsl(var(--destructive))]" /></Button>
    </div>
  );

  return (
    <div>
      <PageHeader title="商品マスタ管理" description="商品の原価・手数料・送料を設定">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setGroupDialogOpen(true)}><FolderOpen className="mr-2 h-4 w-4" />商品グループ管理</Button>
          {tab === "amazon" && (
            <>
              <Button variant="outline" onClick={handleSyncFbaFees} disabled={syncing}>
                <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />{syncing ? "取得中..." : "FBA送料を自動更新"}
              </Button>
              <Button onClick={openAmzCreate}><Plus className="mr-2 h-4 w-4" />商品を追加</Button>
            </>
          )}
          {tab === "rakuten" && <Button onClick={openRktCreate}><Plus className="mr-2 h-4 w-4" />商品を追加</Button>}
        </div>
      </PageHeader>

      {/* Tab switcher */}
      <div className="flex rounded-lg border border-[hsl(var(--border))] overflow-hidden mb-4 w-fit">
        <button onClick={() => setTab("amazon")} className={`px-4 py-2 text-sm font-medium transition-colors ${tab === "amazon" ? "bg-orange-500/20 text-orange-400" : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"}`}>🟠 Amazon</button>
        <button onClick={() => setTab("rakuten")} className={`px-4 py-2 text-sm font-medium transition-colors ${tab === "rakuten" ? "bg-red-500/20 text-red-400" : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"}`}>🔴 楽天</button>
      </div>

      {syncResult && tab === "amazon" && (
        <div className={`mb-4 rounded-lg border p-3 text-sm ${syncResult.startsWith("✓") ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-red-500/30 bg-red-500/10 text-red-400"}`}>{syncResult}</div>
      )}

      {/* ═══ Amazon Tab ═══ */}
      {tab === "amazon" && (
        <>
          <Card className="mb-4">
            <CardContent className="pt-4 text-xs text-[hsl(var(--muted-foreground))] space-y-1">
              <p>• <strong className="text-[hsl(var(--foreground))]">紹介料率</strong> = 売上の%（通常15%） • <strong className="text-[hsl(var(--foreground))]">FBA送料</strong> = 固定額/個 • 純利益 = 売上 − 原価 − 紹介料 − FBA送料 − 広告費</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>商品名</TableHead>
                    <TableHead>ASIN</TableHead>
                    <TableHead>グループ</TableHead>
                    <TableHead className="text-right">販売価格</TableHead>
                    <TableHead className="text-right">原価</TableHead>
                    <TableHead className="text-right">紹介料率</TableHead>
                    <TableHead className="text-right">FBA送料</TableHead>
                    <TableHead>状態</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {amzGrouped.map((group) => {
                    const { representative: rep, children, groupKey } = group;
                    const hasChildren = children.length > 0;
                    const isExpanded = amzExpanded.has(groupKey);
                    return (
                      <>
                        <TableRow key={rep.id} className={hasChildren ? "cursor-pointer" : ""} onClick={() => hasChildren && toggleAmzExpand(groupKey)}>
                          <TableCell className="px-2">{hasChildren ? (isExpanded ? <ChevronDown className="h-4 w-4 text-[hsl(var(--muted-foreground))]" /> : <ChevronRight className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />) : null}</TableCell>
                          <TableCell className="font-bold">{rep.name}</TableCell>
                          <TableCell><Badge variant="secondary" className="text-xs">{rep.asin || rep.code}</Badge></TableCell>
                          <TableCell className="text-sm">{rep.product_group || "-"}</TableCell>
                          <TableCell className="text-right">{formatCurrency(rep.selling_price)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(rep.cost_price)}</TableCell>
                          <TableCell className="text-right">{rep.fba_fee_rate}%</TableCell>
                          <TableCell className="text-right">{(rep.fba_shipping_fee || 0) > 0 ? <span className="text-yellow-400">{formatCurrency(rep.fba_shipping_fee || 0)}/個</span> : <span className="text-xs text-[hsl(var(--muted-foreground))]">未設定</span>}</TableCell>
                          <TableCell>{rep.is_archived ? <Badge variant="secondary">アーカイブ</Badge> : <Badge variant="success">有効</Badge>}</TableCell>
                          <TableCell className="text-right">
                            <ActionButtons onEdit={() => openAmzEdit(rep)} onArchive={() => updateProduct(rep.id, { is_archived: !rep.is_archived }).then(() => queryClient.invalidateQueries({ queryKey: ["products"] }))} onDelete={() => { if (confirm("削除しますか？")) amzDelete.mutate(rep.id); }} onAddChild={() => openAmzCreateChild(rep)} />
                          </TableCell>
                        </TableRow>
                        {isExpanded && children.map(child => (
                          <TableRow key={child.id} className="bg-[hsl(var(--muted))/0.15]">
                            <TableCell></TableCell>
                            <TableCell className="pl-8 text-sm text-[hsl(var(--muted-foreground))]">└ {child.name}{child.sku && <span className="ml-1 text-xs opacity-60">({child.sku})</span>}</TableCell>
                            <TableCell><Badge variant="secondary" className="text-xs">{child.asin || child.code}</Badge></TableCell>
                            <TableCell className="text-sm text-[hsl(var(--muted-foreground))]">{child.product_group || "-"}</TableCell>
                            <TableCell className="text-right text-sm">{formatCurrency(child.selling_price)}</TableCell>
                            <TableCell className="text-right text-sm">{formatCurrency(child.cost_price)}</TableCell>
                            <TableCell className="text-right text-sm">{child.fba_fee_rate}%</TableCell>
                            <TableCell className="text-right text-sm">{(child.fba_shipping_fee || 0) > 0 ? <span className="text-yellow-400">{formatCurrency(child.fba_shipping_fee || 0)}/個</span> : <span className="text-xs text-[hsl(var(--muted-foreground))]">未設定</span>}</TableCell>
                            <TableCell>{child.is_archived ? <Badge variant="secondary">アーカイブ</Badge> : <Badge variant="success">有効</Badge>}</TableCell>
                            <TableCell className="text-right">
                              <ActionButtons onEdit={() => openAmzEdit(child)} onArchive={() => updateProduct(child.id, { is_archived: !child.is_archived }).then(() => queryClient.invalidateQueries({ queryKey: ["products"] }))} onDelete={() => { if (confirm("削除しますか？")) amzDelete.mutate(child.id); }} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Dialog open={amzDialog} onOpenChange={setAmzDialog}>
            <DialogHeader><DialogTitle>{amzEditing ? "Amazon商品を編集" : amzForm.parent_asin ? "子ASIN（バリエーション）を追加" : "Amazon商品を追加"}</DialogTitle></DialogHeader>
            <form onSubmit={handleAmzSubmit} className="space-y-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={amzIsParentOnly} onChange={(e) => setAmzIsParentOnly(e.target.checked)} className="rounded" />
                <span className="text-sm">親商品（グループ用）として登録 <span className="text-xs text-[hsl(var(--muted-foreground))]">— 価格・原価の入力を省略</span></span>
              </label>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-sm text-[hsl(var(--muted-foreground))]">商品名</label><Input value={amzForm.name} onChange={e => setAmzForm({ ...amzForm, name: e.target.value })} required /></div>
                <div><label className="text-sm text-[hsl(var(--muted-foreground))]">ASIN</label><Input value={amzForm.asin} onChange={e => setAmzForm({ ...amzForm, asin: e.target.value })} /></div>
                <GroupSelector value={amzForm.product_group} onChange={v => setAmzForm({ ...amzForm, product_group: v })} groups={groupNames} newGroupMode={newGroupMode} setNewGroupMode={setNewGroupMode} newGroupName={newGroupName} setNewGroupName={setNewGroupName} onAddGroup={() => addGroupMutation.mutate(newGroupName.trim())} />
                {!amzIsParentOnly && (
                  <>
                    <div><label className="text-sm text-[hsl(var(--muted-foreground))]">コード（任意）</label><Input value={amzForm.code} onChange={e => setAmzForm({ ...amzForm, code: e.target.value })} placeholder="空欄時はASINを使用" /></div>
                    <div><label className="text-sm text-[hsl(var(--muted-foreground))]">SKU</label><Input value={amzForm.sku} onChange={e => setAmzForm({ ...amzForm, sku: e.target.value })} /></div>
                    <div>
                      <label className="text-sm text-[hsl(var(--muted-foreground))]">親ASIN（バリエーション用）</label>
                      <Input value={amzForm.parent_asin} onChange={e => setAmzForm({ ...amzForm, parent_asin: e.target.value })} placeholder="空欄=親商品" />
                    </div>
                    <div><label className="text-sm text-[hsl(var(--muted-foreground))]">販売価格</label><Input type="number" value={amzForm.selling_price} onChange={e => setAmzForm({ ...amzForm, selling_price: Number(e.target.value) })} /></div>
                    <div><label className="text-sm text-[hsl(var(--muted-foreground))]">原価</label><Input type="number" value={amzForm.cost_price} onChange={e => setAmzForm({ ...amzForm, cost_price: Number(e.target.value) })} /></div>
                    <div><label className="text-sm text-[hsl(var(--muted-foreground))]">紹介料率（%）</label><Input type="number" step="0.1" value={amzForm.fba_fee_rate} onChange={e => setAmzForm({ ...amzForm, fba_fee_rate: Number(e.target.value) })} /></div>
                    <div><label className="text-sm text-[hsl(var(--muted-foreground))]">FBA配送手数料（円/個）</label><Input type="number" value={amzForm.fba_shipping_fee} onChange={e => setAmzForm({ ...amzForm, fba_shipping_fee: Number(e.target.value) })} /></div>
                  </>
                )}
              </div>
              <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setAmzDialog(false)}>キャンセル</Button><Button type="submit">{amzEditing ? "更新" : "追加"}</Button></div>
            </form>
          </Dialog>
        </>
      )}

      {/* ═══ Rakuten Tab ═══ */}
      {tab === "rakuten" && (
        <>
          <Card className="mb-4">
            <CardContent className="pt-4 text-xs text-[hsl(var(--muted-foreground))] space-y-1">
              <p>• <strong className="text-[hsl(var(--foreground))]">手数料率</strong> = 楽天システム利用料（3.5〜7%） • <strong className="text-[hsl(var(--foreground))]">送料</strong> = 固定配送コスト/個 • 純利益 = 売上 − 原価 − 手数料 − 送料 − 広告費</p>
              <p>• <strong className="text-[hsl(var(--foreground))]">商品グループ</strong> = Amazon側と同じ値を入力すると統合ダッシュボードで合算表示されます</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>商品名</TableHead>
                    <TableHead>商品番号</TableHead>
                    <TableHead>グループ</TableHead>
                    <TableHead className="text-right">販売価格</TableHead>
                    <TableHead className="text-right">原価</TableHead>
                    <TableHead className="text-right">手数料率</TableHead>
                    <TableHead className="text-right">送料</TableHead>
                    <TableHead>状態</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rktParents.map(parent => {
                    const children = rktChildrenMap.get(parent.product_id) || [];
                    const hasChildren = children.length > 0;
                    const isExpanded = rktExpanded.has(parent.product_id);
                    return (
                      <>
                        <TableRow key={parent.id} className={hasChildren ? "cursor-pointer" : ""} onClick={() => hasChildren && toggleRktExpand(parent.product_id)}>
                          <TableCell className="px-2">{hasChildren ? (isExpanded ? <ChevronDown className="h-4 w-4 text-[hsl(var(--muted-foreground))]" /> : <ChevronRight className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />) : null}</TableCell>
                          <TableCell className="font-bold">{parent.name}</TableCell>
                          <TableCell><Badge variant="secondary" className="text-xs">{parent.product_id}</Badge></TableCell>
                          <TableCell className="text-sm">{parent.product_group || "-"}</TableCell>
                          <TableCell className="text-right">{formatCurrency(parent.selling_price)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(parent.cost_price)}</TableCell>
                          <TableCell className="text-right">{parent.fee_rate}%</TableCell>
                          <TableCell className="text-right">{(parent.shipping_fee || 0) > 0 ? <span className="text-yellow-400">{formatCurrency(parent.shipping_fee)}/個</span> : <span className="text-xs text-[hsl(var(--muted-foreground))]">未設定</span>}</TableCell>
                          <TableCell>{parent.is_archived ? <Badge variant="secondary">アーカイブ</Badge> : <Badge variant="success">有効</Badge>}</TableCell>
                          <TableCell className="text-right">
                            <ActionButtons onEdit={() => openRktEdit(parent)} onArchive={() => updateRakutenProduct(parent.id, { is_archived: !parent.is_archived }).then(() => queryClient.invalidateQueries({ queryKey: ["rakutenProducts"] }))} onDelete={() => { if (confirm("削除しますか？")) rktDelete.mutate(parent.id); }} onAddChild={() => openRktCreateChild(parent)} />
                          </TableCell>
                        </TableRow>
                        {isExpanded && children.map(child => (
                          <TableRow key={child.id} className="bg-[hsl(var(--muted))/0.15]">
                            <TableCell></TableCell>
                            <TableCell className="pl-8 text-sm text-[hsl(var(--muted-foreground))]">└ {child.name}{child.sku && <span className="ml-1 text-xs opacity-60">({child.sku})</span>}</TableCell>
                            <TableCell><Badge variant="secondary" className="text-xs">{child.product_id}</Badge></TableCell>
                            <TableCell className="text-sm text-[hsl(var(--muted-foreground))]">{child.product_group || "-"}</TableCell>
                            <TableCell className="text-right text-sm">{formatCurrency(child.selling_price)}</TableCell>
                            <TableCell className="text-right text-sm">{formatCurrency(child.cost_price)}</TableCell>
                            <TableCell className="text-right text-sm">{child.fee_rate}%</TableCell>
                            <TableCell className="text-right text-sm">{(child.shipping_fee || 0) > 0 ? <span className="text-yellow-400">{formatCurrency(child.shipping_fee)}/個</span> : <span className="text-xs text-[hsl(var(--muted-foreground))]">未設定</span>}</TableCell>
                            <TableCell>{child.is_archived ? <Badge variant="secondary">アーカイブ</Badge> : <Badge variant="success">有効</Badge>}</TableCell>
                            <TableCell className="text-right">
                              <ActionButtons onEdit={() => openRktEdit(child)} onArchive={() => updateRakutenProduct(child.id, { is_archived: !child.is_archived }).then(() => queryClient.invalidateQueries({ queryKey: ["rakutenProducts"] }))} onDelete={() => { if (confirm("削除しますか？")) rktDelete.mutate(child.id); }} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Dialog open={rktDialog} onOpenChange={setRktDialog}>
            <DialogHeader><DialogTitle>{rktEditing ? "楽天商品を編集" : "楽天商品を追加"}</DialogTitle></DialogHeader>
            <form onSubmit={handleRktSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-sm text-[hsl(var(--muted-foreground))]">商品名</label><Input value={rktForm.name} onChange={e => setRktForm({ ...rktForm, name: e.target.value })} required /></div>
                <div><label className="text-sm text-[hsl(var(--muted-foreground))]">商品番号</label><Input value={rktForm.product_id} onChange={e => setRktForm({ ...rktForm, product_id: e.target.value })} required /></div>
                <div><label className="text-sm text-[hsl(var(--muted-foreground))]">SKU</label><Input value={rktForm.sku} onChange={e => setRktForm({ ...rktForm, sku: e.target.value })} /></div>
                <div>
                  <label className="text-sm text-[hsl(var(--muted-foreground))]">親商品番号</label>
                  <Select options={[{ value: "", label: "なし（親商品）" }, ...rktParentOptions]} value={rktForm.parent_product_id} onChange={e => {
                    const pid = e.target.value;
                    const par = rktParents.find(p => p.product_id === pid);
                    setRktForm({ ...rktForm, parent_product_id: pid, product_group: pid && par?.product_group ? par.product_group : rktForm.product_group });
                  }} />
                </div>
                <GroupSelector value={rktForm.product_group} onChange={v => setRktForm({ ...rktForm, product_group: v })} groups={groupNames} newGroupMode={newGroupMode} setNewGroupMode={setNewGroupMode} newGroupName={newGroupName} setNewGroupName={setNewGroupName} onAddGroup={() => addGroupMutation.mutate(newGroupName.trim())} />
                <div><label className="text-sm text-[hsl(var(--muted-foreground))]">販売価格</label><Input type="number" value={rktForm.selling_price} onChange={e => setRktForm({ ...rktForm, selling_price: Number(e.target.value) })} /></div>
                <div><label className="text-sm text-[hsl(var(--muted-foreground))]">原価</label><Input type="number" value={rktForm.cost_price} onChange={e => setRktForm({ ...rktForm, cost_price: Number(e.target.value) })} /></div>
                <div><label className="text-sm text-[hsl(var(--muted-foreground))]">手数料率（%）</label><Input type="number" step="0.1" value={rktForm.fee_rate} onChange={e => setRktForm({ ...rktForm, fee_rate: Number(e.target.value) })} /></div>
                <div><label className="text-sm text-[hsl(var(--muted-foreground))]">送料（円/個）</label><Input type="number" value={rktForm.shipping_fee} onChange={e => setRktForm({ ...rktForm, shipping_fee: Number(e.target.value) })} /></div>
              </div>
              <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setRktDialog(false)}>キャンセル</Button><Button type="submit">{rktEditing ? "更新" : "追加"}</Button></div>
            </form>
          </Dialog>
        </>
      )}

      {/* ═══ Group Management Dialog ═══ */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogHeader><DialogTitle>商品グループ管理</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input value={newGroupInput} onChange={e => setNewGroupInput(e.target.value)} placeholder="新しいグループ名" className="flex-1" />
            <Button onClick={() => { if (newGroupInput.trim()) { addGroupMutation.mutate(newGroupInput.trim()); setNewGroupInput(""); } }} disabled={!newGroupInput.trim()}>追加</Button>
          </div>
          <div className="max-h-60 overflow-y-auto space-y-1">
            {(productGroupsList as any[]).map((g: any) => (
              <div key={g.id} className="flex items-center justify-between rounded-lg border border-[hsl(var(--border))] px-3 py-2">
                <span className="text-sm font-medium">{g.name}</span>
                <Button variant="ghost" size="icon" onClick={() => { if (confirm(`「${g.name}」を削除しますか？`)) deleteGroupMutation.mutate(g.id); }}>
                  <Trash2 className="h-3.5 w-3.5 text-[hsl(var(--destructive))]" />
                </Button>
              </div>
            ))}
            {(productGroupsList as any[]).length === 0 && <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-4">グループがありません</p>}
          </div>
        </div>
      </Dialog>
    </div>
  );
}
