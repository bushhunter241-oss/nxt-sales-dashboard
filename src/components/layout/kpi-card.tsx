import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";

interface KPICardProps {
  title: string;
  value: string;
  icon?: LucideIcon;
  trend?: { value: number; label: string };
  className?: string;
  valueClassName?: string;
  sparklineData?: number[];
}

export function KPICard({ title, value, icon: Icon, trend, className, valueClassName, sparklineData }: KPICardProps) {
  const sparkColor = sparklineData && sparklineData.length >= 2
    ? sparklineData[sparklineData.length - 1] >= sparklineData[0] ? "#22c55e" : "#ef4444"
    : "#22c55e";

  return (
    <Card className={cn("", className)}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[hsl(var(--muted-foreground))]">{title}</span>
          {Icon && <Icon className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />}
        </div>
        <div className="flex items-end justify-between">
          <div>
            <div className={cn("mt-1 text-2xl font-bold", valueClassName)}>{value}</div>
            {trend && (
              <div className={cn("mt-1 text-xs", trend.value >= 0 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--destructive))]")}>
                {trend.value >= 0 ? "+" : ""}{trend.value}% {trend.label}
              </div>
            )}
          </div>
          {sparklineData && sparklineData.length > 1 && (
            <div className="w-[100px] h-[36px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sparklineData.map(v => ({ v }))}>
                  <Line type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
