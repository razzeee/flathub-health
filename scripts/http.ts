/** Read successful HTTP responses without allowing unbounded downloads. */
export async function responseBytes(
  response: Response,
  limit: number,
): Promise<Buffer> {
  if (!response.ok)
    throw new Error(`HTTP response returned ${response.status}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw new Error("HTTP response exceeds size limit");
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks);
}
