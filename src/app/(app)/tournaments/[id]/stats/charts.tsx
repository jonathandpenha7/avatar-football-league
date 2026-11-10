"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Single-series bar chart: one brand hue, recessive grid, hover tooltip. */
export function StatBar({ data, unit }: { data: { label: string; value: number }[]; unit: string }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-muted-foreground">No confirmed matches yet.</p>;
  return (
    <div className="h-64" role="img" aria-label={`Bar chart: ${data.map((d) => `${d.label} ${d.value} ${unit}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} interval={0} angle={data.length > 8 ? -35 : 0} textAnchor={data.length > 8 ? "end" : "middle"} height={data.length > 8 ? 50 : 24} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)", fontSize: 12 }}
            formatter={(v) => [`${v} ${unit}`, ""]}
            separator=""
          />
          <Bar dataKey="value" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
