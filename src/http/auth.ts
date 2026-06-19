const encoder = new TextEncoder();

export async function hasValidBearerToken(
  request: Request,
  expectedToken: string,
): Promise<boolean> {
  if (expectedToken.length === 0) return false;
  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  const suppliedToken = header.startsWith(prefix) ? header.slice(prefix.length) : "";
  const [suppliedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(suppliedToken)),
    crypto.subtle.digest("SHA-256", encoder.encode(expectedToken)),
  ]);
  const supplied = new Uint8Array(suppliedHash);
  const expected = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < supplied.length; index += 1) {
    difference |= supplied[index]! ^ expected[index]!;
  }
  return suppliedToken.length > 0 && difference === 0;
}
