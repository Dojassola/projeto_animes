export class ApplicationError extends Error {
  public constructor(
    public readonly code: string,
    public readonly userMessage: string,
    public readonly recoverable: boolean,
    options?: ErrorOptions,
  ) {
    super(userMessage, options);
    this.name = 'ApplicationError';
  }
}

