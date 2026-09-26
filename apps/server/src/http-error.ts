export type HttpProblem = { code: "world_id_misconfigured"; detail: string };

export type HttpErrorBody = { error: string } | ({ error: string } & HttpProblem);

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly problem?: HttpProblem,
  ) {
    super(message);
    this.name = "HttpError";
  }

  body(message: string = this.message): HttpErrorBody {
    return this.problem === undefined ? { error: message } : { error: message, ...this.problem };
  }
}
