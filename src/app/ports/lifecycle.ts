export interface LifecyclePort {
  subscribe(listener: (active: boolean) => void): () => void;
  dispose(): void;
}

export interface FrameSchedulerPort {
  now(): number;
  request(frame: (now: number) => void): number;
  cancel(handle: number): void;
}
