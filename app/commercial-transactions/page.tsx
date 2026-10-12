import type { Metadata } from "next";
import { commerceDisclosureReady, commerceOperator } from "@/lib/commerce-operator";

export const metadata: Metadata = { title: "特定商取引法に基づく表記 | TAG TOKYO" };

export default function CommercialTransactionsPage() {
  return <main className="policy-page">
    <h1>特定商取引法に基づく表記</h1>
    {!commerceDisclosureReady && <p><strong>現在、有料アイテムの販売は開始していません。</strong>以下の販売者情報と決済審査が完了するまで購入機能は無効です。</p>}
    <h2>販売事業者</h2><p>{commerceOperator.sellerName}</p>
    <h2>運営責任者</h2><p>{commerceOperator.responsiblePerson}</p>
    <h2>所在地・電話番号</h2><p>{commerceDisclosureReady ? <>{commerceOperator.address}<br />{commerceOperator.phone}</> : "販売開始前のため未掲載"}</p>
    <h2>問い合わせ</h2><p><a href={`mailto:${commerceOperator.email}`}>{commerceOperator.email}</a></p>
    <h2>販売価格</h2><p>BOOST 800円（税込） / SUPER BOOST 1,500円（税込）</p>
    <h2>販売価格以外の負担</h2><p>インターネット接続料金および通信料金は利用者の負担となります。</p>
    <h2>支払方法・時期</h2><p>Stripe Checkoutを利用したクレジットカード決済。購入手続き完了時に決済されます。</p>
    <h2>提供時期</h2><p>決済完了をサーバーで確認後、通常は直ちにアカウントへ付与します。通信状況により反映まで時間がかかる場合があります。</p>
    <h2>商品の内容</h2><p>BOOSTは発動から30分間、CROSS探索範囲を5kmに拡張します。SUPER BOOSTは発動から30分間、CROSS探索範囲を10kmに拡張します。購入しなくてもプロフィール、TAG、マッチ、メッセージを利用できます。</p>
    <h2>キャンセル・返金</h2><p>決済完了前はStripe Checkout画面からキャンセルできます。デジタルアイテムの性質上、付与後または使用後の利用者都合による返品・返金は原則受け付けません。二重決済、未付与、サービス上の不具合がある場合は問い合わせ窓口へご連絡ください。確認後、決済取消または返金を行います。</p>
    <h2>動作環境</h2><p>最新版のiPhone Safari、Android ChromeなどJavaScriptとCookieが利用できるブラウザが必要です。</p>
    <p><a href="/tag-tokyo/terms/">利用規約</a> / <a href="/tag-tokyo/privacy/">プライバシーポリシー</a></p>
  </main>;
}
