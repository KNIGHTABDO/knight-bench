const FPS_CANDIDATES: { name: string; scale: number }[] = [
  { name: "identity",           scale: 1 },
  { name: "25 / 23.976",        scale: 25 / 23.976 },
  { name: "23.976 / 25",        scale: 23.976 / 25 },
  { name: "25 / 24",            scale: 25 / 24 },
  { name: "24 / 25",            scale: 24 / 25 },
  { name: "24 / 23.976",        scale: 24 / 23.976 },
  { name: "23.976 / 24",        scale: 23.976 / 24 },
  { name: "30 / 29.97",         scale: 30 / 29.97 },
  { name: "29.97 / 30",         scale: 29.97 / 30 },
  { name: "30 / 25",            scale: 30 / 25 },
  { name: "25 / 30",            scale: 25 / 30 },
  // PAL speedup of film, etc.
  { name: "25 / 23.976 (PAL)",  scale: 25 / (24000 / 1001) },
];
