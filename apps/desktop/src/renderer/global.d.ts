import type { KitsuneDesktopApi } from '../shared/contracts/desktop-api';

declare global {
  interface Window {
    kitsune: KitsuneDesktopApi;
  }
}

export {};

