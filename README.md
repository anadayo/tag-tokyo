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

Supabase未設定時やライブ停止中は架空プロフィールを表示せず、CROSS・MATCH・ランキングを0件の空状態で表示します。位置情報や通知は送信しません。

匿名評価は、満足度と改善テーマだけをGA4イベント `tagtokyo_feedback` として送信します。メールアドレス、写真、自由記述は評価イベントに含めません。

実在ユーザー同士の交流は、Supabaseを設定しただけでは有効になりません。年齢確認・届出・通報対応・データ削除の運用を完了し、デプロイ設定とデータベースの二重の開始制御をオーナーが承認した後にだけ限定ベータを開始します。詳細は [live launch checklist](docs/live-launch-checklist.md) と [live-beta runbook](docs/live-beta-runbook.md) を参照してください。

実メッセージは相互TAGで成立したマッチ内だけで利用できます。`010_live_messaging.sql` は、サーバー側の参加資格確認、直接INSERT禁止、重複・連投制限、ブロック、通報、Realtime配信を追加します。`011_profile_onboarding_alignment.sql` は認証後のプロフィール登録条件をUIと揃え、`012_report_write_hardening.sql` は通報を検証済みRPC経由に限定します。`013_manual_age_verification.sql` は、加工済み身分証画像を使う運営確認、非公開Storage、審査RPC、原本削除記録を追加します。

`014_age_verification_notifications.sql` と `send-age-verification-notifications` は、承認・再提出判定を通知キューへ記録し、設定済みの送信元から定型メールを送ります。メール送信に失敗しても審査結果は失われず、安全に再送できます。

`015_remove_demo_data.sql` は旧デモユーザー、デモ設定、デモ向け公開RLSを削除します。公開画面にも架空ランキング・架空プロフィール・端末内マッチはありません。

`016_official_owner_profile.sql` は、実在・稼働中・年齢確認済みの `owner` だけに公認表示を付けます。女性として登録したユーザーのCROSS最上部には、通常のすれ違いを装わない「公認・管理人」ウェルカムプロフィールを表示します。ブロック済みの場合は表示せず、架空のすれ違い・TAG・マッチは作成しません。

審査は [age verification review policy](docs/age-verification-review-policy.md) の客観的な3項目だけで行い、不鮮明・判断不能なケースは推測せずオーナー確認へ回します。

GitHub Pagesは公開クライアントを配信し、秘密鍵が必要な年齢確認通知・定期削除はSupabase Edge Functionsで処理します。

オーナー確認用URLでは全プロフィール項目と装飾を試着できます。本番のオーナー権限は `users.role = 'owner'` のアカウントだけに付与され、一般ユーザーのEXPやエリアランキング条件は変更しません。

## Safety

- 現在地・緯度経度・正確な距離は他ユーザーへ公開しません。
- 生の位置情報は判定専用テーブルに短期保存し、クライアントから取得できないRLS構成です。
- 実ユーザーとのTAG ON・TAG・チャットは、法令に適合する年齢確認と運営体制を有効化するまで開始しません。
- 架空プロフィール、架空ランキング、端末内の疑似マッチは表示・生成しません。
- MAPに一般ユーザーの現在地・移動履歴・正確な距離を表示しません。
- エリア投下時の現在地は1km判定だけに利用し、投下履歴には保存しません。
- TAG SPOT抽選は有料販売せず、現地利用の無料報酬として扱います。
- 本番の年齢確認は運営者による公的証明書の画像確認結果だけを使い、自己申告・誕生日入力・クライアント値では有効化しません。
- 身分証画像は氏名・住所・顔写真・番号を隠して提出し、非公開Storageで審査後ただちに削除します。Notionへは保存しません。

旧コンセプト版は `archive/v0.1-static/` に保存しています。
