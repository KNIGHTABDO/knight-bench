export interface RdTorrentInfo {
  id: string;
  filename: string;
  hash: string;
  bytes: number;
  host: string;
  split: number;
  progress: number;
  status: RdTorrentStatus | string;
  added: string;
  links: string[];
  files?: Array<{
    id: number;
    path: string;
    bytes: number;
    selected: number;
  }>;
  ended?: string;
  speed?: number;
  seeders?: number;
}

export interface RdAddedMagnet {
  id: string;
  uri: string;
}

export interface RdUnrestrictLink {
  id: string;
  filename: string;
  mimeType: string;
  filesize: number;
  link: string;
  host: string;
  chunks: number;
  crc: number;
  download: string; // direct download URL
  streamable: number;
}

export interface RdDownloadItem {
  id: string;
  filename: string;
  mimeType: string;
  filesize: number;
  link: string;
  host: string;
  chunks: number;
  download: string;
  generated: string;
}
