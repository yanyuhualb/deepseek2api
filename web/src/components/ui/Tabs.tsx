import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsProps {
  value: string;
  onValueChange: (v: string) => void;
  items: { value: string; label: React.ReactNode }[];
  className?: string;
}

export function Tabs({ value, onValueChange, items, className }: TabsProps) {
  return (
    <div className={cn("inline-flex h-9 items-center gap-1 rounded-md bg-surface-2 p-1", className)}>
      {items.map((item) => (
        <button
          key={item.value}
          onClick={() => onValueChange(item.value)}
          className={cn(
            "inline-flex h-7 items-center justify-center rounded px-3 text-sm font-medium transition-colors",
            value === item.value
              ? "bg-bg text-text shadow-sm"
              : "text-muted hover:text-text"
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
