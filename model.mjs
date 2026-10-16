// GMSL3 链路的"真值模型"：所有数字都来自 ADI《GMSL3 Channel Specification User Guide》Rev 4 (09/24)，
// 动画里的衰减、读数和说明面板都只从这里取数。f 用 Hz。

const GHz = (f) => f * 1e-9;
const MHz = (f) => f * 1e-6;

export const LINK = {
  fwdRate: 12e9, // 前向 12 Gbps，PAM4
  fwdKey: 3e9, // PAM4 关键频率 = 1/4 比特率
  revRate: 187.5e6, // 反向 187.5 Mbps，NRZ
  revKey: 93.75e6, // NRZ 关键频率 = 1/2 比特率
  bandLo: 2e6,
  bandHi: 3.5e9,
};

// Table 3：pin-to-pin 插损上限（dB，取正值表示损耗）
export const ilPinToPin = (f, long) =>
  long ? 1.62 + 0.182 * Math.sqrt(MHz(f)) + 2.14 * GHz(f) : 1.45 + 0.101 * Math.sqrt(MHz(f)) + 1.01 * GHz(f);
// Table 10：模块插损上限
export const ilPcb = (f) => (f <= 500e6 ? 0.5 : 0.36 + 0.28 * GHz(f));
export const ilCable = (f, long) =>
  long ? 0.6 + 0.2 * Math.sqrt(MHz(f)) + 1.35 * GHz(f) : 0.43 + 0.12 * Math.sqrt(MHz(f)) + 0.2 * GHz(f);

// 一段 pin-to-pin 的预算：PCB + 线缆 + PCB（规格书正好凑满 10 / 18 dB）
export function budget(long, f = LINK.fwdKey) {
  const pcb = ilPcb(f);
  const cable = ilCable(f, long);
  return { pcb, cable, total: pcb * 2 + cable, limit: ilPinToPin(f, long) };
}

export const amp = (dB) => Math.pow(10, -dB / 20);
export const fmt = (v, d = 1) => v.toFixed(d);
