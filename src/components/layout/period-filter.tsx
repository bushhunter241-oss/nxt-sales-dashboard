"use client";
import { PERIODS } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface PeriodFilterProps {
  value: string;
  onChange: (value: string) => void;
}

export function PeriodFilter({ value, onChange }: PeriodFilterProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-[hsl(var(--muted))] p-1">
      {PERIODS.map((period) => (
        <button
          key={period.value}
          onClick={() => onChange(period.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            value === period.value
              ? "bg-[hsl(var(--primary))] text-white"
              : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          )}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}
