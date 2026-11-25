// domain/fleet.ts — 纯 TypeScript 舰队与船只领域公式 (载货量 / 总载重 / 船速)
// 无任何 DOM / Canvas / 帧缓冲依赖，完整保留原版 16/32 比特整数语意。
import { domS16, domUmin16 } from "./economy.ts";

export interface ShipSpeedParams {
  speedRate: number;
  propulsion: number;
  sailRatio: number;
  crew: number;
  minCrew: number;
  loadTotal: number;
  capacity: number;
  captainNavLevel: number;
  captainSailing: number;
}

/** seg0:5d36 船上已用的载货量 (水/食物除以 10 + 资材 + 砲弹 + 5 格商品) */
export function calcCargoUsed(
  water: number,
  food: number,
  lumber: number,
  ammo: number,
  cargoGoods: ReadonlyArray<number>,
  cargoAmts: ReadonlyArray<number>,
): number {
  let v = Math.trunc(domS16(food) / 10) + (lumber & 0xffff) + (ammo & 0xffff) + Math.trunc(domS16(water) / 10);
  for (let k = 0; k < 5; k++) {
    if (cargoGoods[k] !== 0xff) v += cargoAmts[k] & 0xffff;
  }
  return v & 0xffff;
}

/** 船只剩余载货空间 */
export function calcShipFreeCargo(maxCargo: number, cargoUsed: number): number {
  return ((maxCargo & 0xffff) - (cargoUsed & 0xffff)) & 0xffff;
}

/** seg0:5db1 船只总载重 = 已用载货 + 砲重 + 水手数 */
export function calcShipLoadTotal(cargoUsed: number, gunWeight: number, guns: number, crew: number): number {
  const g = Math.trunc(Math.imul(domS16(gunWeight & 0xffff), guns & 0xff) / 10);
  return ((cargoUsed & 0xffff) + g + (crew & 0xffff)) & 0xffff;
}

/** 1c0a8 船只航速计算 */
export function calcShipSpeed(p: ShipSpeedParams): number {
  let di = Math.trunc(domS16((p.speedRate * p.propulsion * 4) & 0xffff) / 150);
  const q = Math.trunc(Math.imul(p.sailRatio, domS16(p.crew)) / (p.minCrew || 1));
  const a = domUmin16(100, q & 0xffff);
  const c = domUmin16(150, (180 - Math.trunc(domS16(Math.imul(100, domS16(p.loadTotal)) & 0xffff) / domS16(p.capacity))) & 0xffff);
  const x = Math.trunc(domS16(Math.imul(a, di) & 0xffff) / 100) & 0xffff;
  di = Math.floor(((x * c) & 0xffff) / 100);
  const v = domUmin16(30, (Math.trunc(domS16((p.captainNavLevel * di) & 0xffff) / 10) + di) & 0xffff);
  return domUmin16(40, Math.trunc(domS16((p.captainSailing * v) & 0xffff) / 75) & 0xffff);
}
