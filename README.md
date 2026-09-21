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
- Lvに応じてプロフィール項目が開放され、ME画面から編集可能
- フレーム・背景・称号をEXPで交換し、プロフィールへ個別に装備可能
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

Supabase未設定でも、位置情報を外部送信しないプレビューモードでUIを確認できます。プレビューに出る人物はすべて `DEMO` と表示され、端末内だけでTAG・MATCH・最初のメッセージを体験できます。実在ユーザーへの通知・連絡は発生しません。

実在ユーザー同士の交流は、Supabaseを設定しただけでは有効になりません。年齢確認・届出・通報対応・データ削除の運用を完了した後に、`NEXT_PUBLIC_TAG_TOKYO_LIVE_ENABLED=true` を明示して限定ベータを開始します。詳細は [live launch checklist](docs/live-launch-checklist.md) を参照してください。

オーナー確認用URLでは全プロフィール項目と装飾を試着できます。本番のオーナー権限は `users.role = 'owner'` のアカウントだけに付与され、一般ユーザーのEXPやエリアランキング条件は変更しません。

## Safety

- 現在地・緯度経度・正確な距離は他ユーザーへ公開しません。
- 生の位置情報は判定専用テーブルに短期保存し、クライアントから取得できないRLS構成です。
- プレビューの20歳以上チェックは自己申告であり、実交流の年齢確認には使いません。
- 実ユーザーとのTAG ON・TAG・チャットは、法令に適合する年齢確認と運営体制を有効化するまで開始しません。
- デモプロフィールは `is_demo = true` 固定で、マッチ・通知・チャットを禁止します。
- MAPに一般ユーザーの現在地・移動履歴・正確な距離を表示しません。
- エリア投下時の現在地は1km判定だけに利用し、投下履歴には保存しません。
- TAG SPOT抽選は有料販売せず、現地利用の無料報酬として扱います。

旧コンセプト版は `archive/v0.1-static/` に保存しています。
