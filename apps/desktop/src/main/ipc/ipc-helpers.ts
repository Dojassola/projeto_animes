import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { ZodError } from 'zod';
import type { AppErrorDto } from '../../shared/errors/app-error';
import { ApplicationError } from '../domain/errors/application-error';

interface Parser<T> {
  parse(value: unknown): T;
}

type ErrorListener = (channel: string, error: AppErrorDto, durationMs: number) => void;

function authorize(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  if (window.isDestroyed() || event.sender.id !== window.webContents.id) {
    throw new ApplicationError('IPC_UNAUTHORIZED', 'Operação não autorizada.', false);
  }
}

export function createIpcRegistrar(window: BrowserWindow, onError?: ErrorListener): {
  handle: <T>(channel: string, resultSchema: Parser<T>, action: (raw: unknown) => unknown) => void;
  dispose: () => void;
} {
  const channels: string[] = [];
  return {
    handle: <T>(channel: string, resultSchema: Parser<T>, action: (raw: unknown) => unknown): void => {
      channels.push(channel);
      ipcMain.handle(channel, async (event: IpcMainInvokeEvent, raw: unknown): Promise<T> => {
        const startedAt = performance.now();
        try {
          authorize(event, window);
          return resultSchema.parse(await action(raw));
        } catch (error: unknown) {
          const errorDto = toErrorDto(error);
          onError?.(channel, errorDto, performance.now() - startedAt);
          return resultSchema.parse({ ok: false, error: errorDto });
        }
      });
    },
    dispose: (): void => {
      for (const channel of channels) ipcMain.removeHandler(channel);
    },
  };
}

export function toErrorDto(error: unknown): AppErrorDto {
  if (error instanceof ZodError) {
    return {
      code: 'VALIDATION_ERROR',
      message: 'Os dados enviados são inválidos.',
      recoverable: false,
    };
  }
  if (error instanceof ApplicationError) {
    return {
      code: error.code,
      message: error.userMessage,
      recoverable: error.recoverable,
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'Não foi possível concluir a operação.',
    recoverable: true,
  };
}
