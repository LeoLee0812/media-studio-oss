// 只读模式：给「公开演示站」用的一道闸。
//
// 场景：站点开成公开模式（没配 ACCESS_PASSWORD）给人随便点，但不希望访客把演示数据
// 改乱、删光，或者改掉设置里的引擎 Base URL 拿去打内网。开了这个开关后：
// - 服务端拒绝一切写请求（所有非 GET/HEAD 的 /api/* 一律 403），这是安全底线，
//   不依赖前端有没有把按钮禁掉；
// - 每日采集 cron 也一并跳过，演示内容就此固定，不会天天涌进新的未翻译素材；
// - 前端顶部挂一条提示条，设置页整页替换成说明卡片（那里最危险：能改 Base URL 和 key）。
//
// 开关：环境变量 READ_ONLY=1（或 true）。不配就是正常可写站，自部署的人不受影响。
export function isReadOnly(): boolean {
  const v = (process.env.READ_ONLY ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

// 只读模式下统一的拒绝文案（服务端 403 与前端提示条共用一份，别各写各的）
export const READ_ONLY_MESSAGE =
  "这是公开演示站，已开启只读模式：可以随便浏览，但不能新增/修改/删除数据。想动手改就自己部署一套（README 里有一键安装的提示词）。";
