// 15 个可交互对象（9 个节点 + 6 个通道子段）的说明文字。
// 数值全部出自 ADI《GMSL3 Channel Specification User Guide》Rev 4 (09/24)，括号里标了表号。
// 各段视频接口由用户于 2026-10-16 确定：CSI-2 D-PHY / CSI-2 D-PHY / DSI / eDP。
// 这些接口不在 GMSL3 信道规格书范围内，只写通用 SI 类别，不写数值。

const CSI = "MIPI CSI-2（D-PHY）：1 对时钟 + 4 对数据差分线（图中按 4 lane 画）";
const DSI = "MIPI DSI（D-PHY）：1 对时钟 + 4 对数据差分线（图中按 4 lane 画）";
const EDP = "eDP：4 对主链路差分线 + 1 对 AUX 辅助通道（图中按 4 lane 画）";
const NOT_GMSL = "这段不属于 GMSL3 信道规格书范围，具体限值以 MIPI / VESA 规范和芯片数据手册为准";
const DPHY_SI = [
  "差分对：阻抗受控、对内等长；时钟对与各数据对之间也要等长，保证接收端采样对齐",
  "D-PHY 有两种工作状态：高速时走低摆幅差分并打开端接，低功耗时两根线各自单端翻转、端接关闭——两种状态都要能正确收发",
  "参考平面连续，尽量少换层；必须换层时在过孔旁加回流地孔",
  "离 GMSL 同轴走线和 PoC 电感保持距离，避免互相串扰",
  NOT_GMSL,
];
const EDP_SI = [
  "主链路差分对 AC 耦合（串联电容），阻抗受控、对内等长；各 lane 之间允许一定偏斜，由接收端对齐",
  "AUX 辅助通道是另一对低速差分线，用来做链路训练和读面板参数；HPD 是热插拔检测单端线",
  "排线（FPC/FFC）和连接器是常见的阻抗不连续点，要按差分对分配地线隔离",
  NOT_GMSL,
];

const PCB_SI = [
  "插损上限 1.2 dB @ 3 GHz（Table 9）；≤500 MHz 为 0.5 dB，500 MHz–3.5 GHz 为 0.36 + 0.28·f(GHz)（Table 10）",
  "回损（Table 11）：10–800 MHz ≤ −18 dB；到 3 GHz 线性放宽到 −6.2 dB（短通道）；2–10 MHz 放宽为 −9 − 0.9·f(MHz)，专门给 PoC 网络留余地",
  "不连续点：AC 耦合电容、PoC 电感、ESD 二极管、线路故障检测电阻、连接器焊盘——规格书把这些都算进 PCB 通道",
  "串扰：宽带串扰 < 3 mVp-p（1–4000 MHz，Table 5）；窄带串扰限值已包含 PoC 注入的纹波（Table 6）",
];

const CABLE_SI = [
  "插损上限 @ 3 GHz：短线 7.6 dB，长线 15.6 dB（Table 9）；公式 0.43 + 0.12·√f(MHz) + 0.2·f(GHz)（短）",
  "回损（Table 11）：2–1000 MHz ≤ −18 dB；1–2.5 GHz 线性放宽到 −10 dB；2.5–3.5 GHz ≤ −10 dB",
  "包含线缆两端插座和中间所有在线连接器（图中那节对接头就是在线连接器）",
  "线束串扰（Table 7）：NEXT 串→串 < −35 dB、串→解 < −45 dB；远端 PS_ACR_F < −45 dB",
  "最坏情况要算上：最长线、老化、温度、PoC 负载上下限",
];

const P2P_SI = (name) => [
  `${name}从串行器 SIO 引脚量到解串器 SIO 引脚，= 串行器侧 PCB + 线缆 + 解串器侧 PCB`,
  "插损上限 @ 3 GHz：短通道 10 dB，长通道 18 dB（Table 2）；1.2 + 7.6 + 1.2 = 10，1.2 + 15.6 + 1.2 = 18，模块预算正好凑满",
  "回损不能相加：没有\"每段分多少 dB\"一说，必须整段 pin-to-pin 一起评估（Table 4）",
  "链路裕量：前向 ≥ 100 mV，反向 ≥ 50 mV（Table 8）；合规系统带 FEC 时误码率 ≤ 10⁻³⁰",
  "测量：VNA 100 kHz–4 GHz，线性步进 ≤ 1 MHz；在线性功率上做 100 MHz 宽滑动平均后再比限值，50 MHz 以下用未滤波数据",
];

const SERDES_SI = [
  "前向 12 Gbps PAM4，关键频率 3 GHz（比特率的 1/4）；反向 187.5 Mbps NRZ，关键频率 93.75 MHz",
  "前反向在同一根线上同时跑，频谱有重叠：前向发射的反射会直接落进本端的反向接收器，所以 GMSL3 特别看重回损",
  "接收端自适应均衡会提升高频增益来补线缆损耗，副作用是对高频串扰更敏感",
  "PAM4 眼高比 NRZ 低 8 dB（规格书原文），换来同样符号率下数据率翻倍",
];

export const SEGMENTS = [
  {
    id: "cam", num: "1", name: "车载摄像头", kind: "node",
    func: "镜头把测试卡成像到图像传感器上，传感器输出原始视频数据，交给后盖里的串行器板。",
    io: [["输入", "光（图中摄像头正对后面那块测试卡）"], ["输出 → SER1", CSI], ["供电", "PoC：电源从 ECU 经同一根同轴线送来"]],
    si: ["传感器到 SER1 的 CSI-2 走线在摄像头内部，通常很短", ...DPHY_SI],
  },
  {
    id: "ser1", num: "2", name: "串行器 SER1", kind: "node",
    func: "把传感器的并行/多通道视频打包成一路 12 Gbps 串行数据，从 SIO 引脚发出；同时接收 ECU 发回的反向控制数据。",
    io: [["输入 ← 传感器", CSI], ["输出", "SIO 引脚 → 通道 A（50 Ω 同轴，单端）"], ["反向", "接收 187.5 Mbps 控制数据"]],
    si: SERDES_SI,
  },
  {
    id: "chA", num: "3", name: "通道 A（pin-to-pin）", kind: "channel", parts: ["a1", "ca", "a2"],
    func: "从 SER1 的 SIO 引脚到 DES1 的 SIO 引脚这一整段无源通道，由 3a、3b、3c 三段串起来。",
    io: [["组成", "3a 串行器侧 PCB → 3b 线缆 → 3c 解串器侧 PCB"], ["阻抗环境", "50 Ω（同轴模式看单端 S21/S11）"]],
    si: P2P_SI("通道 A "),
  },
  {
    id: "a1", num: "3a", name: "串行器侧 PCB 通道", kind: "sub", parent: "chA", il: "pcb",
    func: "摄像头后盖里那块板：从 SER1 的 SIO 引脚，经 AC 耦合电容、PoC 电感、ESD，到板上同轴插头末端。",
    io: [["起点", "SER1 SIO 引脚"], ["终点", "板载同轴插头末端"]],
    si: PCB_SI,
  },
  {
    id: "ca", num: "3b", name: "线缆通道 A", kind: "sub", parent: "chA", il: "cable",
    func: "从摄像头端插座到 ECU 端插座，包括同轴线本身和中间那节在线连接器。",
    io: [["起点", "摄像头端线缆插座"], ["终点", "ECU 端线缆插座"], ["承载", "前向视频 + 反向控制 + PoC 直流电源，同在一根线上"]],
    si: CABLE_SI,
  },
  {
    id: "a2", num: "3c", name: "解串器侧 PCB 通道", kind: "sub", parent: "chA", il: "pcb",
    func: "ECU 板上：从同轴插头末端，经 ESD、AC 耦合电容，到 DES1 的 SIO 引脚；PoC 电感在这里把直流电注入线缆。",
    io: [["起点", "ECU 板载同轴插头末端"], ["终点", "DES1 SIO 引脚"]],
    si: PCB_SI,
  },
  {
    id: "des1", num: "4", name: "解串器 DES1", kind: "node",
    func: "把被线缆衰减过的信号均衡、判决、还原成视频数据，输出给控制器；同时向摄像头发反向控制数据。信号在这里\"重新满格\"。",
    io: [["输入", "SIO 引脚 ← 通道 A"], ["输出 → 控制器", CSI]],
    si: SERDES_SI,
  },
  {
    id: "soc", num: "5", name: "控制器（ECU 主芯片）", kind: "node",
    func: "接收摄像头视频，做处理或合成，再把要显示的画面交给 SER2。",
    io: [["输入 ← DES1", CSI], ["输出 → SER2", DSI]],
    si: ["板上左边一组是 DES1→控制器的 CSI-2，右边一组是控制器→SER2 的 DSI，两组都是 D-PHY 差分对", ...DPHY_SI],
  },
  {
    id: "ser2", num: "6", name: "串行器 SER2", kind: "node",
    func: "把控制器给的显示数据串行化成 12 Gbps，发往屏幕；接收屏幕端发回的反向数据。",
    io: [["输入 ← 控制器", DSI], ["输出", "SIO 引脚 → 通道 B（50 Ω 同轴）"]],
    si: SERDES_SI,
  },
  {
    id: "chB", num: "7", name: "通道 B（pin-to-pin）", kind: "channel", parts: ["b1", "cb", "b2"],
    func: "从 SER2 的 SIO 引脚到 DES2 的 SIO 引脚。组成与通道 A 相同；它是另一个独立的 pin-to-pin 通道。",
    io: [["组成", "7a 串行器侧 PCB → 7b 线缆 → 7c 解串器侧 PCB"], ["和通道 A 的关系", "各自独立：插损预算不跨两跳累加，因为 DES1 已经把信号还原了"]],
    si: P2P_SI("通道 B "),
  },
  {
    id: "b1", num: "7a", name: "串行器侧 PCB 通道", kind: "sub", parent: "chB", il: "pcb",
    func: "ECU 板上：从 SER2 的 SIO 引脚，经 AC 耦合电容、ESD，到板载同轴插头末端。",
    io: [["起点", "SER2 SIO 引脚"], ["终点", "ECU 板载同轴插头末端"]],
    si: PCB_SI,
  },
  {
    id: "cb", num: "7b", name: "线缆通道 B", kind: "sub", parent: "chB", il: "cable",
    func: "从 ECU 端插座到屏幕端插座的同轴线。",
    io: [["起点", "ECU 端线缆插座"], ["终点", "屏幕端线缆插座"], ["承载", "前向显示数据 + 反向数据（本图假设屏幕本地供电，不走 PoC）"]],
    si: CABLE_SI,
  },
  {
    id: "b2", num: "7c", name: "解串器侧 PCB 通道", kind: "sub", parent: "chB", il: "pcb",
    func: "屏幕驱动板上：从同轴插头末端，经 ESD、AC 耦合电容，到 DES2 的 SIO 引脚。PoC 位置留空未贴。",
    io: [["起点", "屏幕驱动板同轴插头末端"], ["终点", "DES2 SIO 引脚"]],
    si: PCB_SI,
  },
  {
    id: "des2", num: "8", name: "解串器 DES2", kind: "node",
    func: "还原显示数据，经排线送给屏幕面板；向 SER2 发反向数据。",
    io: [["输入", "SIO 引脚 ← 通道 B"], ["输出 → 屏幕", EDP], ["注意", "SER2 收的是 DSI，DES2 出的是 eDP：接口类型在这一跳里变了，需要在所选芯片的数据手册里确认这对芯片支持这种组合"]],
    si: SERDES_SI,
  },
  {
    id: "disp", num: "9", name: "车载屏幕", kind: "node",
    func: "面板显示画面。图里屏幕上那张图，就是摄像头对着的那块测试卡，走完两跳 SerDes 之后的样子。",
    io: [["输入 ← DES2", EDP], ["供电", "本图假设本地供电（不走 PoC）"]],
    si: EDP_SI,
  },
];
