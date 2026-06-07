// Tiny HMAC signer shared by the GitHub Action (send-draft.ts) and the Vercel
// approve/publish endpoints. The same APPROVE_SECRET must be set in BOTH places.
//
// We sign the post date so the "Aprobar y publicar" link in the email can't be
// forged — only someone holding APPROVE_SECRET can mint a valid link.

import { createHmac, timingSafeEqual } from "node:crypto";

export function sign(date: string, secret: string): string {
  return createHmac("sha256", secret).update(date).digest("hex");
}

export function verify(date: string, sig: string, secret: string): boolean {
  if (!date || !sig || !secret) return false;
  const expected = sign(date, secret);
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
