export type ModelcadeErrorCode =
  | "INVALID_REQUEST"
  | "MODEL_SPEC_INVALID"
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_ERROR"
  | "FALLBACK_EXHAUSTED"
  | "TOOL_NOT_FOUND"
  | "TOOL_EXECUTION_ERROR"
  | "STREAM_ERROR";

export interface ModelcadeErrorOptions {
  provider?: string;
  model?: string;
  attempt?: number;
  cause?: unknown;
  details?: unknown;
}

export class ModelcadeError extends Error {
  readonly code: ModelcadeErrorCode;
  readonly provider?: string;
  readonly model?: string;
  readonly attempt?: number;
  readonly details?: unknown;
  override readonly cause?: unknown;

  constructor(
    code: ModelcadeErrorCode,
    message: string,
    options: ModelcadeErrorOptions = {}
  ) {
    super(message);
    this.name = "ModelcadeError";
    this.code = code;
    this.provider = options.provider;
    this.model = options.model;
    this.attempt = options.attempt;
    this.cause = options.cause;
    this.details = options.details;
  }

  static wrap(
    code: ModelcadeErrorCode,
    message: string,
    cause: unknown,
    options: Omit<ModelcadeErrorOptions, "cause"> = {}
  ): ModelcadeError {
    return new ModelcadeError(code, message, { ...options, cause });
  }
}
