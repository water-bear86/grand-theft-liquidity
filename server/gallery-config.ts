import {
  parseHouseSecret,
  publicKeyFromSecret,
  rpcFromEnv,
  type SolanaRpc,
} from "./solana.ts";
import { DEFAULT_MAX_PAYOUT_LAMPORTS, type GalleryConfig } from "./gallery.ts";

export function envFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null || value.trim() === "") return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

export function loadGalleryConfig(
  env: NodeJS.ProcessEnv = process.env,
  rpc?: SolanaRpc | null,
): GalleryConfig {
  const dryRun = envFlag(env.GALLERY_DRY_RUN, true);
  const secret = parseHouseSecret(env.HOUSE_WALLET_SECRET);
  let houseWallet = (env.HOUSE_WALLET ?? "").trim();
  if (secret) {
    const derived = publicKeyFromSecret(secret);
    if (houseWallet && houseWallet !== derived)
      throw new Error("HOUSE_WALLET does not match HOUSE_WALLET_SECRET");
    if (!houseWallet) houseWallet = derived;
  }
  const resolvedRpc = rpc === undefined ? rpcFromEnv(env.SOLANA_RPC_URL) : rpc;
  const cap = Number((env.GALLERY_MAX_PAYOUT_LAMPORTS ?? "").trim());
  return {
    houseWallet,
    rpc: resolvedRpc,
    dryRun,
    secretKey: secret,
    configured: !!houseWallet,
    maxPayoutLamports: Number.isSafeInteger(cap) && cap > 0 ? cap : DEFAULT_MAX_PAYOUT_LAMPORTS,
  };
}

/** Booleans only. Safe to expose on /health: never includes keys, URLs, or secrets. */
export function rpcIsPublicMainnet(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname === "api.mainnet-beta.solana.com";
  } catch {
    return false;
  }
}

export function unconfiguredGallery(): GalleryConfig {
  return {
    houseWallet: "",
    rpc: null,
    dryRun: true,
    secretKey: null,
    configured: false,
  };
}
