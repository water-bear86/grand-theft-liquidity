export interface PhantomSolana {
  isPhantom?: boolean;
  publicKey?: { toString(): string };
  isConnected?: boolean;
  connect(options?: {
    onlyIfTrusted?: boolean;
  }): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  signMessage(
    message: Uint8Array,
    display?: "utf8" | "hex",
  ): Promise<{ signature: Uint8Array }>;
  signAndSendTransaction?(
    transaction: unknown,
    options?: { skipPreflight?: boolean },
  ): Promise<{ signature: string }>;
  request?(args: {
    method: string;
    params?: unknown;
  }): Promise<{ signature?: string }>;
  on(
    event: "connect" | "disconnect" | "accountChanged",
    handler: (publicKey?: { toString(): string } | null) => void,
  ): void;
  off?(
    event: "connect" | "disconnect" | "accountChanged",
    handler: (publicKey?: { toString(): string } | null) => void,
  ): void;
}

type Listener = () => void;

class WalletSession {
  address: string | null = null;
  available = false;
  private listeners = new Set<Listener>();
  private bound: PhantomSolana | null = null;
  private watching = false;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    this.watch();
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  getPhantom(): PhantomSolana | null {
    if (typeof window === "undefined") return null;
    const injected = window as Window & {
      phantom?: { solana?: PhantomSolana };
      solana?: PhantomSolana;
    };
    const provider =
      injected.phantom?.solana ??
      (injected.solana?.isPhantom ? injected.solana : undefined);
    return provider ?? null;
  }

  private watch() {
    if (this.watching || typeof window === "undefined") return;
    this.watching = true;
    const attach = () => {
      const provider = this.getPhantom();
      this.available = !!provider;
      if (!provider || provider === this.bound) {
        if (!this.bound) this.emit();
        return;
      }
      this.bound = provider;
      const sync = (publicKey?: { toString(): string } | null) => {
        this.address = publicKey ? publicKey.toString() : provider.publicKey?.toString() ?? null;
        this.available = true;
        this.emit();
      };
      provider.on("connect", sync);
      provider.on("disconnect", () => {
        this.address = null;
        this.emit();
      });
      provider.on("accountChanged", (publicKey) => {
        this.address = publicKey ? publicKey.toString() : null;
        this.emit();
      });
      if (provider.isConnected && provider.publicKey)
        this.address = provider.publicKey.toString();
      else {
        void provider.connect({ onlyIfTrusted: true }).then(({ publicKey }) => sync(publicKey)).catch(() => {
          this.address = null;
          this.emit();
        });
      }
      this.emit();
    };
    attach();
    window.addEventListener("load", attach);
  }

  async connect(): Promise<string> {
    const provider = this.getPhantom();
    this.available = !!provider;
    if (!provider) {
      throw new Error(
        "Install the Phantom extension to post a score. The game works without it.",
      );
    }
    const { publicKey } = await provider.connect();
    this.address = publicKey.toString();
    this.emit();
    return this.address;
  }

  async disconnect(): Promise<void> {
    const provider = this.getPhantom();
    if (provider?.isConnected) await provider.disconnect();
    this.address = null;
    this.emit();
  }

  async signMessage(message: string): Promise<Uint8Array> {
    const provider = this.getPhantom();
    if (!provider || !this.address)
      throw new Error("Connect Phantom to sign this score.");
    const encoded = new TextEncoder().encode(message);
    const { signature } = await provider.signMessage(encoded, "utf8");
    return signature;
  }

  async signAndSendTransaction(serialized: Uint8Array): Promise<string> {
    const provider = this.getPhantom();
    if (!provider || !this.address)
      throw new Error("Connect Phantom to pay the entry fee.");
    const transaction = {
      serialize() {
        return serialized;
      },
    };
    if (provider.signAndSendTransaction) {
      const { signature } = await provider.signAndSendTransaction(transaction);
      if (!signature) throw new Error("Phantom did not return a payment signature.");
      return signature;
    }
    if (provider.request) {
      const result = await provider.request({
        method: "signAndSendTransaction",
        params: { transaction, message: serialized },
      });
      if (!result?.signature) throw new Error("Phantom did not return a payment signature.");
      return result.signature;
    }
    throw new Error("This Phantom build cannot send a transaction.");
  }
}

export const wallet = new WalletSession();
