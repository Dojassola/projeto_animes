import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { ZodError } from 'zod';
import type { AppErrorDto } from '../../shared/errors/app-error';
import { ApplicationError } from '../domain/errors/application-error';

export function authorize(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  if (window.isDestroyed() || event.sender.id !== window.webContents.id) {
    throw new ApplicationError('IPC_UNAUTHORIZED', 'Operação não autorizada.', false);
  }
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

