/** JWT access tokens via jose (HS256) — Workers-native. */
import { SignJWT, jwtVerify } from "jose";

const ACCESS_TOKEN_SECONDS = 720 * 60;

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function createAccessToken(subject: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_SECONDS)
    .sign(key(secret));
}

export async function verifyAccessToken(token: string, secret: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
