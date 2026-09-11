import type { FrameSchedulerPort } from "../../app/ports/lifecycle";

export const createBrowserFrameScheduler = (): FrameSchedulerPort => ({
  now: () => performance.now(),
  request: (frame) => requestAnimationFrame(frame),
  cancel: (handle) => cancelAnimationFrame(handle),
});
