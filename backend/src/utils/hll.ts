/**
 * Unique-visitor counting for the analytics buckets.
 *
 * The previous implementation kept a plain array of visitor hashes per bucket
 * and deduplicated with `Array.includes`, capped at 5000 entries. That was
 * wrong twice over: the linear scan ran on every ingested request, and a busy
 * day silently stopped counting at the cap while still reporting the number as
 * if it were exact.
 *
 * This module keeps the exact set while it is small — most buckets on a small
 * panel never leave that regime, and exact beats estimated — and switches to a
 * HyperLogLog sketch once the set would start to dominate the state file. The
 * sketch is a fixed 512 bytes no matter how many visitors it absorbs, and it
 * merges by taking the per-register maximum, which is exactly what the report
 * needs when it unions buckets across time and across domains.
 */

/** log2 of the register count. 512 registers ≈ 4.6% standard error. */
const HLL_P = 9;
const HLL_M = 1 << HLL_P;
const HLL_ALPHA = 0.7213 / (1 + 1.079 / HLL_M);

/** Above this many exact hashes, the set is replaced by the sketch. */
export const EXACT_LIMIT = 256;

/** Serialized form, as it is stored in analytics.json. */
export type VisitorSet =
  | { k: 's'; v: string[] }
  | { k: 'h'; r: string };

export function emptyVisitors(): VisitorSet {
  return { k: 's', v: [] };
}

function newRegisters(): Uint8Array {
  return new Uint8Array(HLL_M);
}

function decode(reg: string): Uint8Array {
  const buf = Buffer.from(reg, 'base64');
  // A truncated or corrupted register block must not silently under-count
  // forever; fall back to an empty sketch rather than reading past the end.
  if (buf.length !== HLL_M) return newRegisters();
  return new Uint8Array(buf);
}

function encode(regs: Uint8Array): string {
  return Buffer.from(regs).toString('base64');
}

/**
 * Folds one visitor hash into the register block.
 *
 * The input is already the output of SHA-256, so its bits are uniform and no
 * further hashing is needed: the leading bits pick the register and the run of
 * zeros in the remainder gives the rank.
 */
function addHash(regs: Uint8Array, hex: string): void {
  const h = parseInt(hex.slice(0, 8), 16) >>> 0;
  const idx = h >>> (32 - HLL_P);
  const rest = (h << HLL_P) >>> 0;
  // clz32(0) is 32, which would overstate the rank; the remainder only carries
  // 32 - HLL_P meaningful bits, so that is the ceiling.
  const rank = Math.min(Math.clz32(rest) + 1, 32 - HLL_P + 1);
  if (rank > regs[idx]) regs[idx] = rank;
}

function estimate(regs: Uint8Array): number {
  let sum = 0;
  let zeros = 0;
  for (let i = 0; i < HLL_M; i++) {
    sum += 2 ** -regs[i];
    if (regs[i] === 0) zeros++;
  }

  const raw = (HLL_ALPHA * HLL_M * HLL_M) / sum;

  // Below roughly 2.5m the raw estimator is badly biased; linear counting over
  // the empty registers is far more accurate in that range.
  if (raw <= 2.5 * HLL_M && zeros > 0) return Math.round(HLL_M * Math.log(HLL_M / zeros));
  return Math.round(raw);
}

function promote(v: string[]): { k: 'h'; r: string } {
  const regs = newRegisters();
  for (const hash of v) addHash(regs, hash);
  return { k: 'h', r: encode(regs) };
}

/** Records one visitor. Returns the (possibly promoted) set to store back. */
export function addVisitor(set: VisitorSet, hash: string): VisitorSet {
  if (set.k === 'h') {
    const regs = decode(set.r);
    addHash(regs, hash);
    return { k: 'h', r: encode(regs) };
  }

  if (set.v.includes(hash)) return set;
  set.v.push(hash);
  if (set.v.length > EXACT_LIMIT) return promote(set.v);
  return set;
}

/** An accumulator that unions many buckets without re-encoding on every step. */
export class VisitorAccumulator {
  private exact = new Set<string>();
  private regs: Uint8Array | null = null;

  add(set: VisitorSet | undefined): void {
    if (!set) return;

    if (set.k === 's') {
      if (this.regs) {
        for (const hash of set.v) addHash(this.regs, hash);
      } else {
        for (const hash of set.v) this.exact.add(hash);
        if (this.exact.size > EXACT_LIMIT) this.spill();
      }
      return;
    }

    if (!this.regs) this.spill();
    const other = decode(set.r);
    for (let i = 0; i < HLL_M; i++) {
      if (other[i] > this.regs![i]) this.regs![i] = other[i];
    }
  }

  private spill(): void {
    const regs = newRegisters();
    for (const hash of this.exact) addHash(regs, hash);
    this.exact.clear();
    this.regs = regs;
  }

  /** True while the count is an exact distinct count rather than an estimate. */
  get exactCount(): boolean {
    return this.regs === null;
  }

  count(): number {
    if (!this.regs) return this.exact.size;
    return estimate(this.regs);
  }
}
