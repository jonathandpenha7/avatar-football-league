"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { installPerfListeners, setPerfTournament, track } from "@/lib/perf";

/** Records Core Web Vitals, JavaScript errors and page timings for the admin performance view. */
export function PerfReporter() {
  const pathname = usePathname();
  useEffect(() => {
    installPerfListeners();
  }, []);
  useEffect(() => {
    const m = /^\/tournaments\/([0-9a-f-]{36})/.exec(pathname);
    setPerfTournament(m ? m[1] : null);
  }, [pathname]);
  useReportWebVitals((metric) => {
    // CLS is unitless; store it scaled so it fits the integer column.
    const value = metric.name === "CLS" ? metric.value * 1000 : metric.value;
    track("page_web_vital", value, metric.rating !== "poor", { metric: metric.name, rating: metric.rating ?? null, nav: metric.navigationType ?? null });
  });
  return null;
}
