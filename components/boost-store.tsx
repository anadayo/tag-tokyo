"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, History, MapPin, Rocket, ShieldCheck, Zap } from "lucide-react";
import { track } from "@/lib/analytics";
import { supabase } from "@/lib/supabase";

type Product = {
  productKey: "boost" | "super-boost";
  name: string;
  description: string;
  unitAmount: number;
  durationMinutes: number;
  rangeMeters: number;
  purchasesEnabled: boolean;
};

type InventoryItem = { itemKey: "boost" | "super-boost"; quantity: number; activeUntil: string | null; activeItemKey: string | null };
type Order = { orderId: string; productKey: string; amountTotal: number; status: string; amountRefunded: number; createdAt: string };

const ASSET_PREFIX = process.env.NODE_ENV === "production" ? "/tag-tokyo" : "";
const PRELAUNCH_PRODUCTS: Product[] = [
  { productKey: "boost", name: "BOOST", description: "CROSS探索範囲を30分間5kmへ拡張", unitAmount: 800, durationMinutes: 30, rangeMeters: 5000, purchasesEnabled: false },
  { productKey: "super-boost", name: "SUPER BOOST", description: "CROSS探索範囲を30分間10kmへ拡張", unitAmount: 1500, durationMinutes: 30, rangeMeters: 10000, purchasesEnabled: false },
];

const STATUS_LABELS: Record<string, string> = {
  created: "決済待ち", paid: "購入完了", failed: "決済失敗", cancelled: "キャンセル", refunded: "返金済み", partially_refunded: "一部返金",
};

export function BoostStore({ memberReady, onRequireAccount, onInventoryChanged }: {
  memberReady: boolean;
  onRequireAccount: () => void;
  onInventoryChanged: () => void;
}) {
  const [products, setProducts] = useState<Product[]>(PRELAUNCH_PRODUCTS);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const { data: catalog } = await supabase.rpc("get_commerce_catalog");
    const nextProducts = ((catalog ?? []) as Array<Record<string, unknown>>).map((row) => ({
      productKey: row.product_key as Product["productKey"],
      name: String(row.name), description: String(row.description), unitAmount: Number(row.unit_amount),
      durationMinutes: Number(row.duration_minutes), rangeMeters: Number(row.range_meters), purchasesEnabled: Boolean(row.purchases_enabled),
    }));
    if (nextProducts.length > 0) setProducts(nextProducts);
    if (!memberReady) return;
    const [{ data: stock }, { data: history }] = await Promise.all([
      supabase.rpc("get_my_commerce_inventory"),
      supabase.rpc("get_my_commerce_history"),
    ]);
    setInventory(((stock ?? []) as Array<Record<string, unknown>>).map((row) => ({
      itemKey: row.item_key as InventoryItem["itemKey"], quantity: Number(row.quantity),
      activeUntil: row.active_until ? String(row.active_until) : null, activeItemKey: row.active_item_key ? String(row.active_item_key) : null,
    })));
    setOrders(((history ?? []) as Array<Record<string, unknown>>).map((row) => ({
      orderId: String(row.order_id), productKey: String(row.product_key), amountTotal: Number(row.amount_total),
      status: String(row.status), amountRefunded: Number(row.amount_refunded), createdAt: String(row.created_at),
    })));
  }, [memberReady]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const purchase = params.get("purchase");
    if (!purchase) return;
    params.delete("purchase");
    params.delete("order");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    const noticeTimer = window.setTimeout(() => {
      if (purchase === "success") {
        setNotice("決済を確認しています。通常は数秒でアイテムが反映されます。");
        track("purchase_returned", { result: "success" });
      } else {
        setNotice("購入はキャンセルされました。料金は発生していません。");
        track("purchase_returned", { result: "cancel" });
      }
    }, 0);
    const refreshTimer = purchase === "success" ? window.setTimeout(() => void refresh(), 2500) : null;
    return () => {
      window.clearTimeout(noticeTimer);
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [refresh]);

  async function checkout(product: Product) {
    if (!memberReady) return onRequireAccount();
    if (!product.purchasesEnabled || !supabase) return setNotice("販売開始前です");
    setPendingKey(product.productKey);
    setNotice("");
    track("checkout_started", { product_key: product.productKey, value: product.unitAmount, currency: "JPY" });
    const { data, error } = await supabase.functions.invoke("create-stripe-checkout", { body: { productKey: product.productKey } });
    if (error || !data?.checkoutUrl) {
      setNotice(data?.error ?? "決済画面を開けませんでした。時間をおいてお試しください。");
      setPendingKey(null);
      return;
    }
    window.location.assign(data.checkoutUrl);
  }

  async function activate(item: InventoryItem) {
    if (!supabase || item.quantity < 1) return;
    setPendingKey(`activate-${item.itemKey}`);
    const { data, error } = await supabase.rpc("activate_consumable", { p_item_key: item.itemKey });
    if (error) setNotice(error.message === "boost already active" ? "現在のBOOST終了後に使用できます" : "アイテムを使用できませんでした");
    else {
      const row = Array.isArray(data) ? data[0] : data;
      setNotice(`${item.itemKey === "super-boost" ? "SUPER BOOST" : "BOOST"}を発動しました。${Math.round(Number(row?.range_meters ?? 0) / 1000)}km・30分間有効です。`);
      track("paid_boost_activated", { item_key: item.itemKey });
      await refresh();
      onInventoryChanged();
    }
    setPendingKey(null);
  }

  const enabled = products.some((product) => product.purchasesEnabled);
  const active = inventory.find((item) => item.activeUntil);

  return <section className="boost-store" aria-labelledby="boost-store-title">
    <div className="section-heading"><div><small>BOOST STORE</small><h3 id="boost-store-title">探索範囲を広げる</h3></div><Rocket /></div>
    <p className="store-intro">購入しなくても、TAG・マッチ・メッセージは利用できます。BOOSTは探索範囲だけを一時的に広げます。</p>
    {!enabled && <div className="store-guard"><ShieldCheck /><span><b>販売準備中</b><small>決済・法令表示の確認が完了するまで購入はできません</small></span></div>}
    {active && <div className="store-active"><Zap /><span><b>{active.activeItemKey === "super-boost" ? "SUPER BOOST" : "BOOST"} 発動中</b><small>{new Date(active.activeUntil!).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}まで</small></span></div>}
    <div className="store-products">
      {products.map((product) => {
        const stock = inventory.find((item) => item.itemKey === product.productKey)?.quantity ?? 0;
        return <article key={product.productKey} className={product.productKey === "super-boost" ? "is-super" : ""}>
          <header><span><Zap /></span><div><small>{product.productKey === "super-boost" ? "WIDE RANGE" : "STANDARD"}</small><h4>{product.name}</h4></div><strong>¥{product.unitAmount.toLocaleString()}</strong></header>
          <div className="store-effect"><span><MapPin />{product.rangeMeters / 1000}km</span><span>{product.durationMinutes}分</span></div>
          <p>{product.description}</p>
          {stock > 0
            ? <button disabled={Boolean(active) || pendingKey !== null} onClick={() => void activate(inventory.find((item) => item.itemKey === product.productKey)!)}><Zap />所持 {stock}個を使う</button>
            : <button disabled={!product.purchasesEnabled || pendingKey !== null} onClick={() => void checkout(product)}><CreditCard />{pendingKey === product.productKey ? "準備中…" : product.purchasesEnabled ? "購入手続きへ" : "販売開始前"}</button>}
        </article>;
      })}
    </div>
    <p className="store-policy">効果は購入後に手動で発動します。返金条件と販売者情報は<a href={`${ASSET_PREFIX}/commercial-transactions/`} target="_blank" rel="noreferrer">特定商取引法に基づく表記</a>をご確認ください。</p>
    {notice && <p className="store-notice" role="status">{notice}</p>}
    {orders.length > 0 && <details className="purchase-history"><summary><History />購入履歴</summary>{orders.map((order) => <div key={order.orderId}><span><b>{order.productKey === "super-boost" ? "SUPER BOOST" : "BOOST"}</b><small>{new Date(order.createdAt).toLocaleDateString("ja-JP")}</small></span><span><b>¥{order.amountTotal.toLocaleString()}</b><small>{STATUS_LABELS[order.status] ?? order.status}</small></span></div>)}</details>}
  </section>;
}
