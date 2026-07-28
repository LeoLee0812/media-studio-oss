// 项目内查询 CLI：从库拉素材/选题，本地调试用。
// 用法：
//   npm run query -- material <id>
//   npm run query -- topic <id>
//   npm run query -- search <关键词> [source] [limit]
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: "require", max: 3 });

async function main() {
  const [kind, a, b, c] = process.argv.slice(2);
  let rows: unknown;
  if (kind === "material") {
    rows = await sql`select * from ms_materials where id = ${a}`;
  } else if (kind === "topic") {
    const t = await sql`select * from ms_topics where id = ${a}`;
    const mats = await sql`select * from ms_materials where id = any(${(t[0] as { material_ids: string[] })?.material_ids ?? []})`;
    rows = { topic: t[0], materials: mats };
  } else if (kind === "search") {
    const like = `%${a}%`;
    const limit = Number(c ?? 10);
    if (b) {
      rows = await sql`select id, source, pillar, title, summary, url from ms_materials
        where source = ${b} and (title ilike ${like} or summary ilike ${like} or content ilike ${like})
        order by created_at desc limit ${limit}`;
    } else {
      rows = await sql`select id, source, pillar, title, summary, url from ms_materials
        where title ilike ${like} or summary ilike ${like} or content ilike ${like}
        order by created_at desc limit ${limit}`;
    }
  } else {
    console.error("用法：material <id> | topic <id> | search <q> [source] [limit]");
    process.exit(1);
  }
  console.log(JSON.stringify(rows, null, 2));
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
