import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({ label, value, icon: Icon, hint, className }: { label: string; value: ReactNode; icon?: LucideIcon; hint?: ReactNode; className?: string }) {
  return (
    <Card className={cn("gap-1 px-4 py-3.5 sm:py-4", className)}>
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        {Icon ? <Icon className="size-4" /> : null}
      </div>
      <div className="tabular text-2xl font-semibold tracking-tight">{value}</div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </Card>
  );
}
