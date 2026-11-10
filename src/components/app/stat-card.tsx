import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

export function StatCard({ label, value, icon: Icon, hint }: { label: string; value: ReactNode; icon?: LucideIcon; hint?: ReactNode }) {
  return (
    <Card className="gap-1 px-4 py-4">
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        {Icon ? <Icon className="size-4" /> : null}
      </div>
      <div className="tabular text-2xl font-semibold tracking-tight">{value}</div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </Card>
  );
}
