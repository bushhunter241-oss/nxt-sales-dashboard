"use client";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

interface Insight { icon: string; text: string }

export function AiInsights() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  const fetchInsights = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/insights", { method: "POST" });
      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setInsights(data.insights || []);
      setFetched(true);
    } catch (err: any) {
      setError(err.message || "分析データの取得に失敗しました。再試行してください。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!fetched) fetchInsights();
  }, []);

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <span>🤖</span> AIインサイト
          </CardTitle>
          <Button variant="outline" size="sm" onClick={fetchInsights} disabled={loading} className="text-xs">
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
            再分析
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && !fetched && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 rounded-lg bg-[hsl(var(--muted))] animate-pulse" />
            ))}
          </div>
        )}
        {error && (
          <div className="rounded-lg bg-red-900/20 p-3 text-sm text-red-400">{error}</div>
        )}
        {!loading && insights.length > 0 && (
          <div className="space-y-2">
            {insights.map((insight, i) => (
              <div key={i} className="rounded-lg border border-[hsl(var(--border))] p-3 text-sm">
                <span className="mr-2">{insight.icon}</span>
                {insight.text}
              </div>
            ))}
          </div>
        )}
        {!loading && !error && insights.length === 0 && fetched && (
          <div className="py-4 text-center text-sm text-[hsl(var(--muted-foreground))]">
            インサイトを生成できませんでした
          </div>
        )}
      </CardContent>
    </Card>
  );
}
