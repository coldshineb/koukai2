// domain/economy.ts — 純 TypeScript 經濟領域規則 (銀行 / 交易所定價 / 議價 / 物價指數波動)
// 無任何 DOM / Canvas / 幀緩衝依賴，完整保留原版 16/32 位元整數截斷語意，便於單元測試與階段 4–5 重用。

export function domS16(v: number): number {
  return (v << 16) >> 16;
}

export function domUmin16(a: number, b: number): number {
  return (a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff;
}

export function domUmax16(a: number, b: number): number {
  return (b & 0xffff) >= (a & 0xffff) ? b & 0xffff : a & 0xffff;
}

// ---------------- 銀行 (夏洛克銀行) ----------------

export function decodeBankBalance(quotient: number, rem: number): number {
  return (domS16(quotient) * 100 + (rem & 0xff)) | 0;
}

export type BankStoreMode = "normal" | "loan" | "repay";

/**
 * 原版寫回帳戶編碼:
 * - bankQuotient = trunc(balance / 100)，貸款時若 balance < 0 再減 1，還款時若 balance !== 0 再減 1
 * - bankRem = ((q & 0xff) * 0x9c + (balance & 0xff)) & 0xff (= balance - 100 * q)
 */
export function encodeBankBalance(balance: number, mode: BankStoreMode = "normal"): { quotient: number; rem: number } {
  const nb = balance | 0;
  let q = Math.trunc(nb / 100);
  if (mode === "loan" && nb < 0) q--;
  else if (mode === "repay" && nb !== 0) q--;
  return {
    quotient: q & 0xffff,
    rem: ((q & 0xff) * 0x9c + (nb & 0xff)) & 0xff,
  };
}

export function calcDepositLimit(bankQuotient: number, bankRem: number, cash: number): number {
  const max = (Math.imul(domS16(10000 - domS16(bankQuotient)), 100) - (bankRem & 0xff)) | 0;
  return max > cash ? cash : max;
}

export function canTakeLoan(rank: number, bankQuotient: number): boolean {
  return domS16(Math.imul(domS16(rank * rank), -100) - 10) < domS16(bankQuotient);
}

export function calcLoanLimit(rank: number, balance: number): number {
  return (Math.imul(Math.imul(10000, rank), rank) + balance + 1000) | 0;
}

// ---------------- 交易所 ----------------

export function goodsCategory(goodsId: number, catEnd: ReadonlyArray<number>): number {
  const g = goodsId & 0xff;
  for (let i = 0; i < 10; i++) if (catEnd[i] > g) return i;
  return 0;
}

export function hasTradeLicense(portRegion: number, inventory: ReadonlyArray<number>): boolean {
  const n = portRegion & 7;
  if (n >= 6) return false;
  for (let i = 0; i < inventory.length; i++) {
    if (((inventory[i] - n) & 0xff) === 0x23) return true;
  }
  return false;
}

export function calcBuyPrice(priceIndex: number, basePrice: number, licensed: boolean): number {
  const v = Math.trunc(((priceIndex & 0xff) + 50) * domS16(basePrice) / 100);
  return Math.trunc(((v & 0xffff) * (licensed ? 10 : 12)) / 10) & 0xffff;
}

export function calcSellPrice(priceIndex: number, basePrice: number, isSpecialty: boolean): number {
  return Math.trunc(((priceIndex & 0xff) + 50) * domS16(basePrice) / (isSpecialty ? 200 : 100)) & 0xffff;
}

export function calcHaggleBounds(price: number, bonus: number): { lo: number; mid: number } {
  const p = price & 0xffff;
  const lo = Math.trunc((p * ((19 - bonus) & 0xffff)) / 20) & 0xffff;
  const mid = (p - (((p - lo) & 0xffff) >>> 1)) & 0xffff;
  return { lo, mid };
}

export function calcBuyPriceShift(totalCost: number, commerce: number): { catDelta: number; allDelta: number } {
  const si = totalCost & 0xffff;
  return {
    catDelta: domUmin16(10, Math.floor(si / ((commerce + 500) & 0xffff))),
    allDelta: domUmin16(3, Math.floor(si / 1000)),
  };
}

export function calcSellPriceShift(totalRevenue: number, commerce: number): { catDelta: number; allDelta: number } {
  return {
    catDelta: domUmin16(10, Math.trunc(totalRevenue / ((commerce + 500) & 0xffff)) & 0xffff),
    allDelta: domUmin16(3, Math.floor((totalRevenue & 0xffff) / 1000)),
  };
}

export function clampPriceIndexUp(cur: number, delta: number): number {
  return domUmin16(100, cur + delta);
}

export function clampPriceIndexDown(cur: number, delta: number): number {
  return cur - domUmin16(cur, delta);
}
