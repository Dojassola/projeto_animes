import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, raw: unknown) => Promise<unknown>>(),
  removeHandler: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: IpcMainInvokeEvent, raw: unknown) => Promise<unknown>) => {
      electron.handlers.set(channel, handler);
    },
    removeHandler: electron.removeHandler,
  },
}));

import { createIpcRegistrar } from '../src/main/ipc/ipc-helpers';

const resultSchema = { parse: (value: unknown): unknown => value };
const windowMock = {
  isDestroyed: () => false,
  webContents: { id: 7 },
} as unknown as BrowserWindow;

describe('IPC registrar', () => {
  beforeEach(() => {
    electron.handlers.clear();
    electron.removeHandler.mockClear();
  });

  it('authorizes the window, converts errors and unregisters its handlers', async () => {
    const ipc = createIpcRegistrar(windowMock);
    ipc.handle('test:channel', resultSchema, (raw) => ({ ok: true, data: raw }));
    const handler = electron.handlers.get('test:channel');
    expect(handler).toBeDefined();

    await expect(handler?.({ sender: { id: 7 } } as IpcMainInvokeEvent, 42)).resolves.toEqual({ ok: true, data: 42 });
    await expect(handler?.({ sender: { id: 8 } } as IpcMainInvokeEvent, 42)).resolves.toMatchObject({
      ok: false,
      error: { code: 'IPC_UNAUTHORIZED' },
    });

    ipc.dispose();
    expect(electron.removeHandler).toHaveBeenCalledWith('test:channel');
  });
});
