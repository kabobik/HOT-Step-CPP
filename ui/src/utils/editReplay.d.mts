import type { Song } from '../types';
export function prepareYue2Edit(song: Song, deps: {
  backendStore: any; paramsStore: any; defaults: Record<string, unknown>;
  notify: (message: string, type: 'error' | 'warning') => void;
}): Promise<Song | null>;
export function isEditRestoring(): boolean;
