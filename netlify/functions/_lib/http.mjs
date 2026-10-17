export class HttpError extends Error {
  constructor(status, message, field) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

export const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

export function toResponse(err) {
  if (err instanceof HttpError) {
    return json(err.status, { error: err.message, ...(err.field ? { field: err.field } : {}) });
  }
  console.error(err);
  return json(500, { error: 'Internal error' });
}
