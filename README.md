# TAG TOKYO

「東京を歩くほど、出会いと自分が育つ。」すれ違いとプロフィール育成を組み合わせたスマートフォン向けPWAです。

## Stack

- Next.js / TypeScript
- Supabase Auth / PostgreSQL / Realtime
- PWA / Geolocation API

## Growth loop (v0.3)

- すれ違い・ミッション・無料TAG SPOTでEXPを獲得
- 累計獲得EXPでプロフィールLvが成長
- 所持EXPはエリア競争やプロフィール装飾に利用
- エリアへのEXP投下は各拠点の1km圏内だけ許可し、距離はサーバー側で判定
- EXPを使っても累計獲得EXPとプロフィールLvは減少しない
- MAPにはTAG SPOTと各エリアの現在1位だけを表示
- TAG SPOTは現地判定・1日1回・完全無料・必ず報酬あり

本番データは `supabase/migrations/003_growth_spots_areas.sql` のEXP台帳とRPCで処理します。EXP付与、抽選、消費はクライアントから直接更新できません。

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
- 20歳以上の年齢確認が完了するまで、実ユーザーとのTAG ON・TAG・チャットは利用できません。
- デモプロフィールは `is_demo = true` 固定で、マッチ・通知・チャットを禁止します。
- MAPに一般ユーザーの現在地・移動履歴・正確な距離を表示しません。
- エリア投下時の現在地は1km判定だけに利用し、投下履歴には保存しません。
- TAG SPOT抽選は有料販売せず、現地利用の無料報酬として扱います。

旧コンセプト版は `archive/v0.1-static/` に保存しています。
