import type { CrossItem, DemoProfile } from "./types";

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

function pickTags(index: number) {
  return Array.from({ length: 5 }, (_, offset) => tagPool[(index * 3 + offset * 5) % tagPool.length]);
}

export function generateDemoProfiles(): DemoProfile[] {
  return Array.from({ length: 230 }, (_, index) => {
    const gender = index < 150 ? "woman" : "man";
    const names = gender === "woman" ? women : men;
    return {
      id: `demo-${String(index + 1).padStart(3, "0")}`,
      displayName: names[index % names.length],
      age: 20 + ((index * 7) % 16),
      gender,
      occupation: occupations[(index * 5) % occupations.length],
      bio: bios[(index * 7) % bios.length],
      activityArea: areas[(index * 11) % areas.length],
      tags: pickTags(index),
      avatarIndex: index % 8,
      isDemo: true,
    };
  });
}

export function sampleCrossings(userTags: string[]): CrossItem[] {
  return generateDemoProfiles().slice(0, 12).map((profile, index) => {
    const sharedTags = profile.tags.filter((tag) => userTags.includes(tag));
    return {
      ...profile,
      sharedTags: sharedTags.length ? sharedTags : profile.tags.slice(0, 2),
      crossedLabel: index < 4 ? `今日・${profile.activityArea}エリア` : `昨日の夜・${profile.activityArea}エリア`,
    };
  });
}
