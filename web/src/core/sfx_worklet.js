// sfx_worklet.js — 效果音的 AudioWorklet (RE_NOTES 第 35 節): FMDRV 效果音聲部 (core/sfx.js FmDriver) 驅動 OPL2 合成 (core/opl.js, Nuked OPL3 的移植, LGPL-2.1)
// 時間: OPL 原生取樣率 49716 Hz (14.31818 MHz / 288); 每 4096 × 49716 / 1193182 個原生取樣送一次 FMDRV 的 IRQ0 (PIT 4096 分頻 = 291.304 Hz)。
// 主執行緒送來的 INT 66h 指令 ({ ah, al, dl, addr }) 在下一個原生取樣之前執行 (原版在遊戲程式呼叫的當下執行, 這裡最多晚一個 128 取樣的處理區塊)。
import { OPL3 } from "./opl.js";
import { FmDriver, SFX_VOICES } from "./sfx.js";

const PIT_HZ = 1193182, IRQ_DIV = 4096, OPL_HZ = 49716;
class SfxProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chip = new OPL3(sampleRate);
    this.drv = new FmDriver((r, v) => this.chip.write(r, v));
    this.drv.init();
    this.q = []; this.acc = 0; this.buf = [0, 0, 0, 0];
    this.port.onmessage = e => this.q.push(e.data);
    this.tick = () => {
      while (this.q.length) {
        const m = this.q.shift(), d = m.addr ? SFX_VOICES[m.addr] : null;
        this.drv.int66(m.ah, m.al, m.dl ?? 0, m.addr || 0, d || null);
      }
      this.acc += PIT_HZ;                                        // 原生取樣 × PIT_HZ 對 IRQ_DIV × OPL_HZ 取整 = IRQ0 次數
      if (this.acc >= IRQ_DIV * OPL_HZ) { this.acc -= IRQ_DIV * OPL_HZ; this.drv.irq0(); }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], b = this.buf;
    for (let i = 0; i < L.length; i++) {
      this.chip.generateResampled(b, this.tick);
      L[i] = b[0] / 32768; R[i] = b[1] / 32768;
    }
    return true;
  }
}
registerProcessor("uw2-sfx", SfxProcessor);
