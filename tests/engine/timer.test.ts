import { describe, expect, it } from "vitest";
import { clockView, type ClockConfig, type ClockState } from "@/lib/engine";

// Avatar league timing: 7 + 2 + 7.
const cfg: ClockConfig = { periods: 2, halfSec: 420, halfTimeSec: 120, extraTimeSec: 300 };
const T0 = Date.parse("2026-11-15T11:30:00Z");
const t = (sec: number) => T0 + sec * 1000;
const iso = (sec: number) => new Date(t(sec)).toISOString();
const base: ClockState = {
  status: "in_progress", period: "first_half", timerStartedAt: iso(0), timerElapsedSec: 0,
  phaseTargetSec: 420, addedTimeSec: 0, firstHalfElapsedSec: null, secondHalfElapsedSec: null,
};

describe("match clock display", () => {
  it("counts the first half down from 7:00", () => {
    const v = clockView(base, cfg, t(65));
    expect([v.period, v.remainingSec, v.running, v.transitionDue]).toEqual(["first_half", 355, true, false]);
  });

  it("shows the same time after a refresh or on another device (state + now only)", () => {
    expect(clockView({ ...base }, cfg, t(300)).remainingSec).toBe(clockView(JSON.parse(JSON.stringify(base)), cfg, t(300)).remainingSec);
  });

  it("freezes while paused and continues from the exact remaining time", () => {
    const paused: ClockState = { ...base, status: "paused", timerStartedAt: null, timerElapsedSec: 200 };
    expect(clockView(paused, cfg, t(5000)).remainingSec).toBe(220);
    const resumed: ClockState = { ...paused, status: "in_progress", timerStartedAt: iso(5000) };
    expect(clockView(resumed, cfg, t(5010)).remainingSec).toBe(210);
  });

  it("switches to the 2-minute half-time countdown at the exact expiry moment and flags a sync", () => {
    const v = clockView(base, cfg, t(450));
    expect([v.period, v.remainingSec, v.transitionDue]).toEqual(["half_time", 90, true]);
  });

  it("stops the half-time clock at zero and waits for the referee", () => {
    const v = clockView(base, cfg, t(420 + 200));
    expect([v.period, v.remainingSec, v.running]).toEqual(["half_time", 0, false]);
  });

  it("runs the second half on its own clock and continues the match minute", () => {
    const second: ClockState = { ...base, period: "second_half", timerStartedAt: iso(1000), firstHalfElapsedSec: 420 };
    const v = clockView(second, cfg, t(1100));
    expect([v.period, v.remainingSec, v.matchSecond]).toEqual(["second_half", 320, 520]);
  });

  it("includes added time and then goes to full time", () => {
    const second: ClockState = { ...base, period: "second_half", timerStartedAt: iso(1000), firstHalfElapsedSec: 420, addedTimeSec: 60 };
    expect(clockView(second, cfg, t(1000 + 479)).period).toBe("second_half");
    const v = clockView(second, cfg, t(1000 + 480));
    expect([v.status, v.period, v.transitionDue]).toEqual(["completed", "full_time", true]);
  });

  it("keeps simultaneous matches independent", () => {
    const other: ClockState = { ...base, timerStartedAt: iso(100) };
    expect(clockView(base, cfg, t(400)).remainingSec).toBe(20);
    expect(clockView(other, cfg, t(400)).remainingSec).toBe(120);
  });

  it("falls back to configured lengths for matches started before phase targets were stored", () => {
    expect(clockView({ ...base, phaseTargetSec: null }, cfg, t(60)).remainingSec).toBe(360);
  });
});
