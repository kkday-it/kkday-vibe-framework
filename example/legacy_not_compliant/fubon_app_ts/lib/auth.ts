import crypto from "crypto";
import { env } from "@/lib/env";

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", env.SESSION_SECRET)
    .update(payload)
    .digest("hex");
}

export function createSignedSession(expiresAtMs: number): string {
  const payload = `${expiresAtMs}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySignedSession(cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;

  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0) return false;

  const payload = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);
  if (!payload || !signature) return false;

  const expected = sign(payload);
  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  const expiresAtMs = Number(payload);
  if (!Number.isFinite(expiresAtMs)) return false;

  return Date.now() < expiresAtMs;
}
