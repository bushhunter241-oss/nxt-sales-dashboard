"use client";
import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Link2,
  Link2Off,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  Eye,
  EyeOff,
  Trash2,
  Play,
} from "lucide-react";

// ---- Types ----
interface CredentialStatus {
  configured: boolean;
  hasAccessToken: boolean;
  tokenExpiresAt: string | null;
  updatedAt: string | null;
}

interface SyncStatus {
  lastSync: string | null;
  isRunning: boolean;
}

interface SyncLog {
  id: string;
  api_type: string;
  sync_type: string;
  status: string;
  records_processed: number;
  error_message: string | null;
  sync_started_at: string;
  sync_completed_at: string | null;
  created_at: string;
}

// ---- Ads Profile type ----
interface AdsProfile {
  profileId: string;
  accountName: string;
  accountType: string;
  countryCode?: string;
  isJapan?: boolean;
}

// ---- Credential Form Component ----
function CredentialSection({
  title,
  type,
  status,
  onSave,
  onDelete,
  onTest,
  showProfileId,
  spApiConfigured,
  onRefreshData,
}: {
  title: string;
  type: "sp-api" | "ads-api";
  status: CredentialStatus | null;
  onSave: (type: string, creds: Record<string, string>) => Promise<void>;
  onDelete: (type: string) => Promise<void>;
  onTest: (type: string) => Promise<{ success: boolean; error?: string }>;
  showProfileId?: boolean;
  spApiConfigured?: boolean;
  onRefreshData?: () => Promise<void>;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [profileId, setProfileId] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [useSpApiCreds, setUseSpApiCreds] = useState(false);
  const [fetchingProfiles, setFetchingProfiles] = useState(false);
  const [availableProfiles, setAvailableProfiles] = useState<AdsProfile[]>([]);
  const [profileError, setProfileError] = useState<string | null>(null);

  const isConfigured = status?.configured ?? false;

  const handleSave = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const creds: Record<string, string> = {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      };
      if (showProfileId && profileId) creds.profile_id = profileId;
      if (useSpApiCreds) creds.use_sp_api_creds = "true";
      await onSave(type, creds);
      setClientId("");
      setClientSecret("");
      setRefreshToken("");
      setProfileId("");
      setUseSpApiCreds(false);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await onTest(type);
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("認証情報を削除しますか？")) return;
    setDeleting(true);
    try {
      await onDelete(type);
    } finally {
      setDeleting(false);
    }
  };

  const handleCopyFromSpApi = async () => {
    setUseSpApiCreds(true);
    try {
      const res = await fetch("/api/credentials/copy-sp-api");
      if (res.ok) {
        const data = await res.json();
        if (data.client_id) setClientId(data.client_id);
        if (data.client_secret) setClientSecret(data.client_secret);
        if (data.refresh_token) setRefreshToken(data.refresh_token);
      }
    } catch {
      // If copy fails, user can enter manually
    }
  };

  const handleFetchProfiles = async () => {
    setFetchingProfiles(true);
    setProfileError(null);
    setAvailableProfiles([]);
    try {
      const res = await fetch("/api/ads/profiles");
      const data = await res.json();
      if (!res.ok) {
        setProfileError(data.error || "プロファイル取得に失敗");
        return;
      }
      setAvailableProfiles(data.profiles || []);
      // Auto-select JP profile if only one
      if (data.jpProfiles?.length === 1) {
        setProfileId(data.jpProfiles[0].profileId);
      }
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "取得に失敗しました");
    } finally {
      setFetchingProfiles(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-semibold">{title}</h3>
            {isConfigured ? (
              <Badge
                variant="outline"
                className="bg-green-50 text-green-700 border-green-200"
              >
                <CheckCircle2 className="h-3 w-3 mr-1" />
                接続済
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="bg-gray-50 text-gray-500 border-gray-200"
              >
                <Link2Off className="h-3 w-3 mr-1" />
                未設定
              </Badge>
            )}
          </div>
          {isConfigured && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleTest}
                disabled={testing}
              >
                {testing ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Link2 className="h-3 w-3 mr-1" />
                )}
                接続テスト
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDelete}
                disabled={deleting}
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                削除
              </Button>
            </div>
          )}
        </div>

        {testResult && (
          <div
            className={`mb-4 rounded-lg px-4 py-3 text-sm ${
              testResult.success
                ? "bg-green-50 text-green-800 border border-green-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            {testResult.success
              ? `接続テスト成功！APIに正常にアクセスできます。${testResult.error ? ` (${testResult.error})` : ""}`
              : `接続テスト失敗: ${testResult.error}`}
          </div>
        )}

        {isConfigured ? (
          <div className="text-sm text-[hsl(var(--muted-foreground))]">
            <p>
              最終更新:{" "}
              {status?.updatedAt
                ? new Date(status.updatedAt).toLocaleString("ja-JP")
                : "-"}
            </p>
            {status?.hasAccessToken && status?.tokenExpiresAt && (
              <p>
                トークン有効期限:{" "}
                {new Date(status.tokenExpiresAt).toLocaleString("ja-JP")}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* SP-API credentials copy button for Ads API */}
            {showProfileId && spApiConfigured && !useSpApiCreds && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
                <p className="text-sm text-blue-800 mb-2">
                  SP-APIと同じLWA認証情報を使用できます
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyFromSpApi}
                  className="bg-white"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  SP-APIの認証情報をコピー
                </Button>
              </div>
            )}
            {useSpApiCreds && (
              <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2">
                <p className="text-sm text-green-800">
                  SP-APIの認証情報をコピーしました。Profile IDを設定してください。
                </p>
              </div>
            )}

            <div>
              <label className="text-sm font-medium mb-1 block">
                Client ID
              </label>
              <Input
                value={clientId}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setClientId(e.target.value)
                }
                placeholder="amzn1.application-oa2-client.xxx"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">
                Client Secret
              </label>
              <div className="relative">
                <Input
                  type={showSecrets ? "text" : "password"}
                  value={clientSecret}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setClientSecret(e.target.value)
                  }
                  placeholder="Client Secret"
                />
                <button
                  type="button"
                  onClick={() => setShowSecrets(!showSecrets)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showSecrets ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">
                Refresh Token
              </label>
              <Input
                type={showSecrets ? "text" : "password"}
                value={refreshToken}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setRefreshToken(e.target.value)
                }
                placeholder="Atzr|xxx"
              />
            </div>
            {showProfileId && (
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Profile ID（広告プロファイル）
                </label>
                <div className="flex gap-2">
                  <Input
                    value={profileId}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setProfileId(e.target.value)
                    }
                    placeholder="1234567890"
                    className="flex-1"
                  />
                  {clientId && clientSecret && refreshToken && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        // Save creds first (without profile), then fetch profiles
                        setSaving(true);
                        try {
                          await onSave(type, {
                            client_id: clientId,
                            client_secret: clientSecret,
                            refresh_token: refreshToken,
                          });
                          if (onRefreshData) await onRefreshData();
                          await handleFetchProfiles();
                        } catch {
                          setProfileError("認証情報の保存に失敗しました。認証情報を確認してください。");
                        } finally {
                          setSaving(false);
                        }
                      }}
                      disabled={fetchingProfiles || saving}
                    >
                      {fetchingProfiles ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3 mr-1" />
                      )}
                      自動取得
                    </Button>
                  )}
                </div>
                {profileError && (
                  <p className="text-xs text-red-600 mt-1">{profileError}</p>
                )}
                {availableProfiles.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      利用可能なプロファイル（クリックで選択）:
                    </p>
                    {availableProfiles.map((p) => (
                      <button
                        key={p.profileId}
                        type="button"
                        onClick={() => setProfileId(p.profileId)}
                        className={`w-full text-left text-xs rounded-md border p-2 transition-colors ${
                          profileId === p.profileId
                            ? "bg-blue-50 border-blue-300 text-blue-800"
                            : "bg-white border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        <span className="font-medium">{p.accountName}</span>
                        <span className="text-[hsl(var(--muted-foreground))] ml-2">
                          ID: {p.profileId}
                        </span>
                        {p.isJapan && (
                          <Badge variant="outline" className="ml-2 text-[10px] px-1 py-0">
                            JP
                          </Badge>
                        )}
                        <span className="text-[hsl(var(--muted-foreground))] ml-2">
                          ({p.accountType})
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <Button
              onClick={handleSave}
              disabled={saving || !clientId || !clientSecret || !refreshToken}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4 mr-2" />
              )}
              {showProfileId && profileId ? "保存して接続テスト" : showProfileId ? "認証情報を保存" : "保存して接続テスト"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Sync Controls Component ----
interface SyncResultDetail {
  success: boolean;
  message: string;
  debug?: {
    totalProducts: number;
    productsWithAsin: number;
    ordersFromApi: number;
    inventoryFromApi?: number;
  };
  errors?: string[];
}

function SyncControls({
  syncStatus,
  onSync,
}: {
  syncStatus: Record<string, SyncStatus>;
  onSync: (
    type: "sp-api-orders" | "sp-api-inventory" | "sp-api-traffic" | "ads-api",
    startDate: string,
    endDate: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<any>;
}) {
  const today = new Date().toISOString().split("T")[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const [startDate, setStartDate] = useState(weekAgo);
  const [endDate, setEndDate] = useState(today);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, SyncResultDetail>>({});

  const handleSync = async (
    type: "sp-api-orders" | "sp-api-inventory" | "sp-api-traffic" | "ads-api"
  ) => {
    setSyncing((prev) => ({ ...prev, [type]: true }));
    setResults((prev) => {
      const next = { ...prev };
      delete next[type];
      return next;
    });

    // Show progress for ads-api auto-retry
    if (type === "ads-api") {
      setResults((prev) => ({
        ...prev,
        [type]: {
          success: true,
          message: "レポート生成をリクエスト中...",
        },
      }));
    }

    try {
      const data = await onSync(type, startDate, endDate);
      const debugInfo = data?.debug;
      const apiErrors = data?.errors;

      // Check if still pending after all retries
      if (data?.pending) {
        setResults((prev) => ({
          ...prev,
          [type]: {
            success: false,
            message: "レポート生成中です。数分後にもう一度「実行」をクリックしてください。",
          },
        }));
        return;
      }

      let message = `同期完了: ${data?.recordsProcessed ?? 0}件処理`;
      if (debugInfo) {
        message += ` (商品: ${debugInfo.totalProducts}件, ASIN有: ${debugInfo.productsWithAsin}件`;
        if (debugInfo.ordersFromApi !== undefined) message += `, API注文: ${debugInfo.ordersFromApi}件`;
        if (debugInfo.inventoryFromApi !== undefined) message += `, API在庫: ${debugInfo.inventoryFromApi}件`;
        message += ")";
      }
      setResults((prev) => ({
        ...prev,
        [type]: { success: true, message, debug: debugInfo, errors: apiErrors },
      }));
    } catch (error) {
      setResults((prev) => ({
        ...prev,
        [type]: {
          success: false,
          message: error instanceof Error ? error.message : "同期失敗",
        },
      }));
    } finally {
      setSyncing((prev) => ({ ...prev, [type]: false }));
    }
  };

  const syncButtons = [
    { type: "sp-api-orders" as const, label: "売上データ同期", desc: "SP-API" },
    {
      type: "sp-api-inventory" as const,
      label: "在庫データ同期",
      desc: "SP-API",
    },
    {
      type: "sp-api-traffic" as const,
      label: "セッション同期",
      desc: "SP-API (ビジネスレポート)",
    },
    { type: "ads-api" as const, label: "広告データ同期", desc: "Ads API" },
  ];

  return (
    <Card>
      <CardContent className="p-6">
        <h3 className="text-base font-semibold mb-4">手動同期</h3>
        <div className="flex gap-4 mb-4">
          <div>
            <label className="text-sm font-medium mb-1 block">開始日</label>
            <Input
              type="date"
              value={startDate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setStartDate(e.target.value)
              }
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">終了日</label>
            <Input
              type="date"
              value={endDate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setEndDate(e.target.value)
              }
            />
          </div>
        </div>
        <div className="space-y-3">
          {syncButtons.map(({ type, label, desc }) => {
            const status = syncStatus[type];
            const isRunning = syncing[type] || status?.isRunning;
            const result = results[type];
            return (
              <div
                key={type}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div>
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))]">
                    {desc} ・ 最終同期:{" "}
                    {status?.lastSync
                      ? new Date(status.lastSync).toLocaleString("ja-JP")
                      : "なし"}
                  </div>
                  {result && (
                    <div className="mt-1">
                      <div
                        className={`text-xs ${
                          result.success ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {result.message}
                      </div>
                      {result.errors && result.errors.length > 0 && (
                        <div className="text-xs text-amber-600 mt-1">
                          {result.errors.slice(0, 5).map((e, i) => (
                            <div key={i}>{e}</div>
                          ))}
                          {result.errors.length > 5 && (
                            <div>...他{result.errors.length - 5}件</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={() => handleSync(type)}
                  disabled={isRunning}
                >
                  {isRunning ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3 mr-1" />
                  )}
                  {isRunning ? "同期中..." : "実行"}
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Sync History Component ----
function SyncHistory({ logs }: { logs: SyncLog[] }) {
  const statusBadge = (s: string) => {
    switch (s) {
      case "success":
        return (
          <Badge
            variant="outline"
            className="bg-green-50 text-green-700 border-green-200"
          >
            成功
          </Badge>
        );
      case "failed":
        return (
          <Badge
            variant="outline"
            className="bg-red-50 text-red-700 border-red-200"
          >
            失敗
          </Badge>
        );
      case "running":
        return (
          <Badge
            variant="outline"
            className="bg-blue-50 text-blue-700 border-blue-200"
          >
            実行中
          </Badge>
        );
      default:
        return <Badge variant="outline">{s}</Badge>;
    }
  };

  const apiLabel = (t: string) => {
    switch (t) {
      case "sp-api-orders":
        return "売上";
      case "sp-api-inventory":
        return "在庫";
      case "ads-api":
        return "広告";
      default:
        return t;
    }
  };

  return (
    <Card>
      <CardContent className="p-6">
        <h3 className="text-base font-semibold mb-4">同期履歴</h3>
        {logs.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            同期履歴はありません
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日時</TableHead>
                <TableHead>タイプ</TableHead>
                <TableHead>トリガー</TableHead>
                <TableHead>ステータス</TableHead>
                <TableHead className="text-right">件数</TableHead>
                <TableHead>エラー</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs">
                    {new Date(log.sync_started_at).toLocaleString("ja-JP")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{apiLabel(log.api_type)}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {log.sync_type === "cron" ? "自動" : "手動"}
                  </TableCell>
                  <TableCell>{statusBadge(log.status)}</TableCell>
                  <TableCell className="text-right text-sm">
                    {log.records_processed}
                  </TableCell>
                  <TableCell className="text-xs text-red-600 max-w-[200px] truncate">
                    {log.error_message || "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Rakuten Credential Section ----
function RakutenCredentialSection({
  onRefreshData,
}: {
  onRefreshData: () => Promise<void>;
}) {
  const [serviceSecret, setServiceSecret] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);

  // Fetch Rakuten credential status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/rakuten/credentials");
      if (res.ok) {
        const data = await res.json();
        setIsConfigured(data.configured ?? false);
        setUpdatedAt(data.updatedAt ?? null);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleSave = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/rakuten/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceSecret,
          licenseKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存に失敗しました");
      setServiceSecret("");
      setLicenseKey("");
      await fetchStatus();
      await onRefreshData();
    } catch (err) {
      setTestResult({
        success: false,
        error: err instanceof Error ? err.message : "保存に失敗しました",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/rakuten/test", { method: "POST" });
      const data = await res.json();
      setTestResult({
        success: data.success ?? false,
        error: data.message || data.error,
      });
    } catch (err) {
      setTestResult({
        success: false,
        error: err instanceof Error ? err.message : "テストに失敗しました",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("楽天API認証情報を削除しますか？")) return;
    setDeleting(true);
    try {
      await fetch("/api/rakuten/credentials", { method: "DELETE" });
      await fetchStatus();
      await onRefreshData();
      setTestResult(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-semibold">楽天 RMS API</h3>
            {isConfigured ? (
              <Badge
                variant="outline"
                className="bg-green-50 text-green-700 border-green-200"
              >
                <CheckCircle2 className="h-3 w-3 mr-1" />
                接続済
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="bg-gray-50 text-gray-500 border-gray-200"
              >
                <Link2Off className="h-3 w-3 mr-1" />
                未設定
              </Badge>
            )}
          </div>
          {isConfigured && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleTest}
                disabled={testing}
              >
                {testing ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Link2 className="h-3 w-3 mr-1" />
                )}
                接続テスト
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDelete}
                disabled={deleting}
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                削除
              </Button>
            </div>
          )}
        </div>

        {testResult && (
          <div
            className={`mb-4 rounded-lg px-4 py-3 text-sm ${
              testResult.success
                ? "bg-green-50 text-green-800 border border-green-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            {testResult.success
              ? `接続テスト成功！楽天RMS APIに正常にアクセスできます。${testResult.error ? ` (${testResult.error})` : ""}`
              : `接続テスト失敗: ${testResult.error}`}
          </div>
        )}

        {isConfigured ? (
          <div className="text-sm text-[hsl(var(--muted-foreground))]">
            <p>
              最終更新:{" "}
              {updatedAt
                ? new Date(updatedAt).toLocaleString("ja-JP")
                : "-"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 mb-2">
              <p className="text-sm text-red-800">
                楽天RMS APIの「serviceSecret」と「licenseKey」を入力してください。
                RMSの店舗設定 → API設定から取得できます。
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">
                Service Secret
              </label>
              <div className="relative">
                <Input
                  type={showSecrets ? "text" : "password"}
                  value={serviceSecret}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setServiceSecret(e.target.value)
                  }
                  placeholder="SP-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
                <button
                  type="button"
                  onClick={() => setShowSecrets(!showSecrets)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showSecrets ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">
                License Key
              </label>
              <Input
                type={showSecrets ? "text" : "password"}
                value={licenseKey}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setLicenseKey(e.target.value)
                }
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              />
            </div>
            <Button
              onClick={handleSave}
              disabled={saving || !serviceSecret || !licenseKey}
              className="bg-[#bf0000] hover:bg-[#a00000] text-white"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4 mr-2" />
              )}
              保存して接続テスト
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Rakuten Sync Controls ----
function RakutenSyncControls() {
  const today = new Date().toISOString().split("T")[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const [startDate, setStartDate] = useState(weekAgo);
  const [endDate, setEndDate] = useState(today);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    setResult(null);
    try {
      const res = await fetch("/api/rakuten/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom: startDate, dateTo: endDate }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || "同期に失敗しました");
      }
      setResult({
        success: true,
        message: `同期完了: ${data.recordsUpserted ?? data.recordsProcessed ?? 0}件処理`,
      });
    } catch (err) {
      setResult({
        success: false,
        message: err instanceof Error ? err.message : "同期に失敗しました",
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-6">
        <h3 className="text-base font-semibold mb-4">
          楽天 手動同期
        </h3>
        <div className="flex gap-4 mb-4">
          <div>
            <label className="text-sm font-medium mb-1 block">開始日</label>
            <Input
              type="date"
              value={startDate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setStartDate(e.target.value)
              }
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">終了日</label>
            <Input
              type="date"
              value={endDate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setEndDate(e.target.value)
              }
            />
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">楽天売上データ同期</div>
              <div className="text-xs text-[hsl(var(--muted-foreground))]">
                RMS API ・ 注文検索 → 注文詳細取得 → DB保存
              </div>
              {result && (
                <div className="mt-1">
                  <div
                    className={`text-xs ${
                      result.success ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {result.message}
                  </div>
                </div>
              )}
            </div>
            <Button
              size="sm"
              onClick={handleSync}
              disabled={syncing}
              className="bg-[#bf0000] hover:bg-[#a00000] text-white"
            >
              {syncing ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Play className="h-3 w-3 mr-1" />
              )}
              {syncing ? "同期中..." : "実行"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Main Page ----
export default function ApiIntegrationPage() {
  const [credentialStatus, setCredentialStatus] = useState<
    Record<string, CredentialStatus>
  >({});
  const [syncStatus, setSyncStatus] = useState<Record<string, SyncStatus>>({});
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      // Fetch credential status
      const credRes = await fetch("/api/credentials");
      if (credRes.ok) {
        const data = await credRes.json();
        setCredentialStatus(data);
      }

      // Fetch sync status
      const syncRes = await fetch("/api/sync/status");
      if (syncRes.ok) {
        const data = await syncRes.json();
        setSyncStatus(data.status || {});
        setSyncLogs(data.logs || []);
      }
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSaveCredential = async (
    type: string,
    creds: Record<string, string>
  ) => {
    const res = await fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentialType: type, credentials: creds, testConnection: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "保存に失敗しました");
    await fetchData();
  };

  const handleDeleteCredential = async (type: string) => {
    const res = await fetch(`/api/credentials?type=${type}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "削除に失敗しました");
    }
    await fetchData();
  };

  const handleTestConnection = async (type: string) => {
    const res = await fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentialType: type, testOnly: true }),
    });
    const data = await res.json();
    const result = {
      success: data.connectionTest?.success ?? false,
      error: data.connectionTest?.error,
    };
    // Append details to success message if present
    if (result.success && data.connectionTest?.details) {
      result.error = data.connectionTest.details; // reuse error field for details display
    }
    return result;
  };

  const handleSync = async (
    type: "sp-api-orders" | "sp-api-inventory" | "sp-api-traffic" | "ads-api",
    startDate: string,
    endDate: string
  ) => {
    let url: string;
    let body: Record<string, string>;

    if (type === "ads-api") {
      url = "/api/sync/ads-api";
      body = { startDate, endDate };
    } else {
      url = "/api/sync/sp-api";
      const syncTypeMap: Record<string, string> = {
        "sp-api-orders": "orders",
        "sp-api-inventory": "inventory",
        "sp-api-traffic": "traffic",
      };
      body = {
        syncType: syncTypeMap[type] || "orders",
        startDate,
        endDate,
      };
    }

    // For ads-api: auto-retry loop when report is pending
    const maxRetries = type === "ads-api" ? 12 : 0; // Up to 12 retries (~10 min total)
    let retryCount = 0;

    while (true) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      // If pending (202), auto-retry after delay
      if (res.status === 202 && data.pending && retryCount < maxRetries) {
        retryCount++;
        // Wait 30 seconds before retrying (report generation takes 3-10 min)
        await new Promise((r) => setTimeout(r, 30000));
        continue;
      }

      if (!res.ok && res.status !== 202) {
        throw new Error(data.error || "同期に失敗しました");
      }

      // If still pending after all retries, show message but don't error
      if (data.pending) {
        await fetchData();
        return { ...data, recordsProcessed: 0 };
      }

      // Refresh data
      await fetchData();

      // Return full response including debug info
      return data;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--muted-foreground))]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="API連携設定"
        description="Amazon SP-API / Ads API / 楽天 RMS API の接続設定とデータ同期"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <CredentialSection
          title="SP-API（売上・在庫）"
          type="sp-api"
          status={credentialStatus["sp-api"] || null}
          onSave={handleSaveCredential}
          onDelete={handleDeleteCredential}
          onTest={handleTestConnection}
        />
        <CredentialSection
          title="Ads API（広告）"
          type="ads-api"
          status={credentialStatus["ads-api"] || null}
          onSave={handleSaveCredential}
          onDelete={handleDeleteCredential}
          onTest={handleTestConnection}
          showProfileId
          spApiConfigured={credentialStatus["sp-api"]?.configured ?? false}
          onRefreshData={fetchData}
        />
      </div>

      <SyncControls syncStatus={syncStatus} onSync={handleSync} />

      {/* ---- 楽天 RMS API セクション ---- */}
      <div className="border-t pt-6 mt-2">
        <h2 className="text-lg font-bold mb-4 text-[#bf0000]">楽天 RMS API</h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <RakutenCredentialSection onRefreshData={fetchData} />
          <RakutenSyncControls />
        </div>
      </div>

      <SyncHistory logs={syncLogs} />
    </div>
  );
}
