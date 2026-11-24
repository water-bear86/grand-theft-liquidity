import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  buildScoreMessage,
  type ScoreSubmission,
} from "../src/leaderboard-protocol.ts";

export function decodePublicKey(wallet: string): Uint8Array | null {
  try {
    const key = bs58.decode(wallet);
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

export function decodeSignature(signature: string): Uint8Array | null {
  try {
    const bytes = bs58.decode(signature);
    return bytes.length === 64 ? bytes : null;
  } catch {
    return null;
  }
}

export function verifyScoreSignature(
  submission: ScoreSubmission,
  signature: string,
): boolean {
  const publicKey = decodePublicKey(submission.wallet);
  const sig = decodeSignature(signature);
  if (!publicKey || !sig) return false;
  const message = new TextEncoder().encode(buildScoreMessage(submission));
  try {
    return nacl.sign.detached.verify(message, sig, publicKey);
  } catch {
    return false;
  }
}
