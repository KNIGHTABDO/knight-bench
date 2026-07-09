export type Title = { id: string; title?: string; name?: string; poster?: string; image?: string; src?: string; duration?: number };
export async function getTitles(): Promise<Title[]> { return []; }
export async function getTitle(id: string): Promise<Title | null> { return { id }; }
