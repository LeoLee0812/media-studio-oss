// 手动跑一次清理（与每日 cron 走同一条 runCleanup，用于验证或临时收空间）。
// 运行：npm run cleanup            真跑（会改数据：直接删除超期素材、回收封面图/小红书缓存）
//       npm run cleanup -- dry     只报告会动多少行，不改数据
// dry-run 的判定 SQL 收口在 lib/cleanup.ts 的 dryRunCleanup()，与真跑共用同一套常量，
// 不许在这里手写 SQL——曾因脚本里硬编码真删窗口与常量漂移导致数字失真。
import { sql } from "../lib/db";
import { runCleanup, dryRunCleanup } from "../lib/cleanup";

async function main() {
  const dry = process.argv.includes("dry");
  if (dry) {
    console.log("dry-run（不改数据）：");
    for (const line of await dryRunCleanup()) {
      console.log(`  ${line.label}：${line.count} 条${line.extra ? `，${line.extra}` : ""}`);
    }
  } else {
    const result = await runCleanup();
    console.log("清理完成：", JSON.stringify(result, null, 2));
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
