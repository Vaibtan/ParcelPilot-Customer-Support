import { Context, Effect, Layer } from "effect";

export class Clock extends Context.Tag("Clock")<Clock, { now: () => Date }>() {}

// Snapshot from workbook README: 2026-08-16 11:00 Asia/Kolkata (IST UTC+5:30)
export const SNAPSHOT_ISO = "2026-08-16T11:00:00+05:30";

export const ClockLive = Layer.succeed(Clock, {
  now: () => new Date(SNAPSHOT_ISO),
});

export const ClockTest = (fixed: string) =>
  Layer.succeed(Clock, { now: () => new Date(fixed) });

export const nowEffect = Effect.flatMap(Clock, (c) => Effect.sync(() => c.now()));
