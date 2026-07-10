export type WatchProgressRecord = {
  profileId: string;
  titleId: string;
  progress: number; // 0..1 fraction watched
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: number; // Date.now()
};
