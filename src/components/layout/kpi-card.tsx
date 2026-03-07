import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface KPICardProps {
  title: string;
  value: string;
  icon?: LucideIcon;
  trend?: { value: number; label: string };
  className?: string;
  valueClassName?: string;
}

export function KPICard({ title, value, icon: Icon, trend, className, valueClassName }: KPICardProps) {
  return (
    <Card className={cn("", className)}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[hsl(var(--muted-foreground))]">{title}</span>
          {Icon && <Icon className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />}
        </div>
        <div className={cn("mt-1 text-2xl font-bold", valueClassName)}>{value}</div>
        {trend && (
          <div className={cn("mt-1 text-xs", trend.value >= 0 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--destructive))]")}>
            {trend.value >= 0 ? "+" : ""}{trend.value}% {trend.label}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
