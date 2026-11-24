import bs58 from "bs58";
import { MEMO_PROGRAM_ID } from "./gallery-protocol.ts";

const SYSTEM_PROGRAM_BYTES = new Uint8Array(32);
const MEMO_PROGRAM_BYTES = bs58.decode(MEMO_PROGRAM_ID);

export function decodeAccount(address: string): Uint8Array | null {
  try {
    const key = bs58.decode(address);
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

export function encodeCompactU16(value: number): Uint8Array {
  if (value < 0 || value > 0xffff) throw new Error("compact-u16 out of range");
  if (value < 128) return Uint8Array.of(value);
  if (value < 16384) return Uint8Array.of((value & 0x7f) | 0x80, value >> 7);
  return Uint8Array.of((value & 0x7f) | 0x80, ((value >> 7) & 0x7f) | 0x80, value >> 14);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function u64le(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)
    throw new Error("lamports out of range");
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setUint32(0, value >>> 0, true);
  view.setUint32(4, Math.floor(value / 0x1_0000_0000), true);
  return out;
}

export function decodeBlockhash(blockhash: string): Uint8Array {
  const bytes = bs58.decode(blockhash);
  if (bytes.length !== 32) throw new Error("Invalid blockhash");
  return bytes;
}

export function buildTransferMessage(input: {
  from: string;
  to: string;
  lamports: number;
  blockhash: string;
  memo?: string;
}): Uint8Array {
  const from = decodeAccount(input.from);
  const to = decodeAccount(input.to);
  if (!from || !to) throw new Error("Invalid wallet");
  if (input.from === input.to) throw new Error("Cannot transfer to the same wallet");
  const keys = [from, to, SYSTEM_PROGRAM_BYTES];
  const instructions: { program: number; accounts: number[]; data: Uint8Array }[] = [
    { program: 2, accounts: [0, 1], data: concat([u32le(2), u64le(input.lamports)]) },
  ];
  if (input.memo) {
    keys.push(MEMO_PROGRAM_BYTES);
    instructions.push({
      program: 3,
      accounts: [],
      data: new TextEncoder().encode(input.memo),
    });
  }
  const header = Uint8Array.of(1, 0, input.memo ? 2 : 1);
  const message = [
    header,
    encodeCompactU16(keys.length),
    ...keys,
    decodeBlockhash(input.blockhash),
    encodeCompactU16(instructions.length),
  ];
  for (const instruction of instructions) {
    message.push(
      Uint8Array.of(instruction.program),
      encodeCompactU16(instruction.accounts.length),
      Uint8Array.from(instruction.accounts),
      encodeCompactU16(instruction.data.length),
      instruction.data,
    );
  }
  return concat(message);
}

export function serializeUnsignedTransaction(message: Uint8Array): Uint8Array {
  return concat([encodeCompactU16(1), new Uint8Array(64), message]);
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  return concat(chunks);
}
