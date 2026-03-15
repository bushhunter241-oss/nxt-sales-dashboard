"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function Tabs({ value, onValueChange, children, className }: TabsProps) {
  return (
    <div className={className} data-value={value}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<any>, { value, onValueChange });
        }
        return child;
      })}
    </div>
  );
}

interface TabsListProps {
  children: React.ReactNode;
  className?: string;
  value?: string;
  onValueChange?: (value: string) => void;
}

export function TabsList({ children, className, value, onValueChange }: TabsListProps) {
  return (
    <div className={cn("inline-flex h-9 items-center justify-center rounded-lg bg-[hsl(var(--muted))] p-1 text-[hsl(var(--muted-foreground))]", className)}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<any>, { currentValue: value, onValueChange });
        }
        return child;
      })}
    </div>
  );
}

interface TabsTriggerProps {
  value: string;
  children: React.ReactNode;
  className?: string;
  currentValue?: string;
  onValueChange?: (value: string) => void;
}

export function TabsTrigger({ value, children, className, currentValue, onValueChange }: TabsTriggerProps) {
  const isActive = currentValue === value;
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all",
        isActive ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow" : "hover:text-[hsl(var(--foreground))]",
        className
      )}
      onClick={() => onValueChange?.(value)}
    >
      {children}
    </button>
  );
}
