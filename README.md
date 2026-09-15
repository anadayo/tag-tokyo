# TAG TOKYO

「東京ですれ違った人と、あとからつながる。」スマートフォン向けPWAです。

## Stack

- Next.js / TypeScript
- Supabase Auth / PostgreSQL / Realtime
- PWA / Geolocation API

## Local development

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Supabase未設定でも、位置情報を外部送信しないプレビューモードでUIを確認できます。プレビューに出る人物はすべて `DEMO` と表示され、TAG・MATCH・チャットはできません。

## Safety

- 現在地・緯度経度・正確な距離は他ユーザーへ公開しません。
- 生の位置情報は判定専用テーブルに短期保存し、クライアントから取得できないRLS構成です。
- 年齢確認が完了するまで、実ユーザーとのTAG ON・TAG・チャットは利用できません。
- デモプロフィールは `is_demo = true` 固定で、マッチ・通知・チャットを禁止します。

旧コンセプト版は `archive/v0.1-static/` に保存しています。
