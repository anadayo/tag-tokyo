import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const client = createClient(url, key, { auth: { persistSession: false } });

const women = ["Mio", "Yui", "Rin", "Aoi", "Nana", "Sara", "Mei", "Hina", "Riko", "Aya", "Nao", "Emi", "Kaho", "Miku", "Rei"];
const men = ["Ren", "Sota", "Kaito", "Haru", "Yuto", "Riku", "Sho", "Kei", "Jun", "Toma", "Nao", "Reo"];
const occupations = ["デザイナー", "美容関係", "IT・Web", "医療関係", "企画職", "販売", "公務員", "教育関係", "マーケター", "飲食関係", "映像制作", "会社員"];
const areas = ["新宿", "渋谷", "池袋", "北千住", "上野", "浅草", "秋葉原", "吉祥寺", "下北沢", "高円寺", "中目黒", "恵比寿", "六本木", "錦糸町", "東京駅周辺"];
const tagPool = ["音楽", "ゲーム", "ラーメン", "古着", "カフェ", "お笑い", "映画", "アニメ", "旅行", "美術館", "サウナ", "スポーツ", "カードゲーム", "読書", "散歩", "居酒屋"];
const bios = [
  "休日はカフェを探したり、気になる展示を見に行きます。",
  "仕事帰りに寄り道するのが好きです。まずは気軽に話せたら。",
  "音楽と映画が好き。東京のまだ知らない場所を開拓したいです。",
  "おいしい店と散歩が休日の定番です。よく笑う人だとうれしいです。",
  "趣味の話から自然に仲良くなれたら。無理のないペースが好きです。",
  "最近はサウナと読書。気の合う人と短い時間から会ってみたいです。",
];
const idFor = (index) => `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`;

const { data: tags, error: tagError } = await client.from("tags").select("id,name");
if (tagError) throw tagError;
const tagId = new Map(tags.map((tag) => [tag.name, tag.id]));
const users = [];
const profiles = [];
const userTags = [];

for (let index = 0; index < 230; index += 1) {
  const gender = index < 150 ? "woman" : "man";
  const names = gender === "woman" ? women : men;
  const id = idFor(index);
  const selectedTags = Array.from({ length: 5 }, (_, offset) => tagPool[(index * 3 + offset * 5) % tagPool.length]);
  users.push({ id, auth_user_id: null, email: null, age_verified: true, status: "active", is_demo: true });
  profiles.push({
    user_id: id,
    display_name: names[index % names.length],
    bio: bios[(index * 7) % bios.length],
    avatar_url: `/profile-sprite-v1.png#${index % 8}`,
    gender,
    activity_area: areas[(index * 11) % areas.length],
    occupation: occupations[(index * 5) % occupations.length],
  });
  for (const name of selectedTags) userTags.push({ user_id: id, tag_id: tagId.get(name) });
}

for (const [table, rows] of [["users", users], ["profiles", profiles], ["user_tags", userTags]]) {
  const { error } = await client.from(table).upsert(rows, { onConflict: table === "user_tags" ? "user_id,tag_id" : table === "profiles" ? "user_id" : "id" });
  if (error) throw error;
}
console.log(`Seeded ${profiles.length} DEMO profiles: 150 women / 80 men`);
