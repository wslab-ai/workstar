export class FormBodyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 | 415,
  ) {
    super(message);
    this.name = 'FormBodyError';
  }
}

export async function readFormDataWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<FormData> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError('maxBytes must be a positive safe integer.');
  }
  const contentType = request.headers.get('content-type');
  if (
    !contentType ||
    !/^(application\/x-www-form-urlencoded|multipart\/form-data)(?:\s*;|$)/i.test(
      contentType,
    )
  ) {
    throw new FormBodyError('Unsupported form content type.', 415);
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new FormBodyError('Invalid Content-Length.', 400);
    }
    if (length > maxBytes) throw new FormBodyError('Form body too large.', 413);
  }
  if (!request.body) throw new FormBodyError('Missing form body.', 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new FormBodyError('Form body too large.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return await new Response(body, {
      headers: { 'content-type': contentType },
    }).formData();
  } catch {
    throw new FormBodyError('Malformed form body.', 400);
  }
}
