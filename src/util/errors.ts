const DEFAULT_EXIT_CODE = 1;

export class ViblibError extends Error {
  public exitCode: number;
  public cause?: unknown;

  public constructor(
    message: string,
    opts?: { exitCode?: number; cause?: unknown }
  ) {
    super(message);
    this.name = "ViblibError";
    this.exitCode = opts?.exitCode ?? DEFAULT_EXIT_CODE;
    this.cause = opts?.cause;
  }

  public static fromUnknown(error: unknown): ViblibError {
    if (error instanceof ViblibError) {
      return error;
    }
    if (error instanceof Error) {
      return new ViblibError(error.message, { cause: error });
    }
    return new ViblibError(String(error));
  }
}
