-- TAG TOKYO v0.5: extensible TAG COLLECTION master and relevance matching.
-- Existing tags and user selections are preserved.

alter table public.tags
  add column if not exists category text not null default 'その他',
  add column if not exists aliases text[] not null default array[]::text[],
  add column if not exists popularity integer not null default 0,
  add column if not exists status text not null default 'active';

alter table public.tags drop constraint if exists tags_status_check;
alter table public.tags add constraint tags_status_check check (status in ('active','hidden','retired'));

alter table public.user_tags
  add column if not exists is_primary boolean not null default false,
  add column if not exists sort_order smallint not null default 0,
  add column if not exists selected_at timestamptz not null default now();

alter table public.matches
  add column if not exists ended_at timestamptz,
  add column if not exists ended_by uuid references public.users(id) on delete set null;

alter table public.users add column if not exists last_seen_at timestamptz not null default now();

create index if not exists tags_category_status_idx on public.tags (category,status,popularity desc);
create index if not exists tags_aliases_gin_idx on public.tags using gin (aliases);
create index if not exists user_tags_tag_selected_idx on public.user_tags (tag_id,selected_at desc);

with catalog(category,names) as (values
  ('音楽',array['J-POP','K-POP','洋楽','邦ロック','洋楽ロック','ヒップホップ','R&B','ジャズ','クラシック','EDM','ボカロ','初音ミク','重音テト','シティポップ','アニソン','アイドル','ライブ','フェス','カラオケ','楽器演奏','ギター','ピアノ','作曲','DTM','レコード']),
  ('アニメ',array['アニメ','新作アニメ','深夜アニメ','ジブリ','ディズニー','ジャンプ作品','ラブコメ','異世界アニメ','日常系アニメ','スポーツアニメ','ロボットアニメ','ミステリーアニメ','ホラーアニメ','泣けるアニメ','声優','アニメ映画','聖地巡礼','コスプレ','フィギュア','ガンダム','エヴァンゲリオン','鬼滅の刃','呪術廻戦','SPY×FAMILY','チェンソーマン']),
  ('ゲーム',array['ゲーム','Nintendo Switch','PlayStation','PCゲーム','スマホゲーム','インディーゲーム','RPG','アクションゲーム','FPS','TPS','格闘ゲーム','音楽ゲーム','パズルゲーム','シミュレーション','ホラーゲーム','協力プレイ','eスポーツ','レトロゲーム','ポケモン','どうぶつの森','スプラトゥーン','モンスターハンター','Minecraft','原神','ストリートファイター']),
  ('カードゲーム',array['カードゲーム','TCG','ポケカ','遊戯王','デュエル・マスターズ','ワンピースカード','ドラゴンボールカード','ヴァイスシュヴァルツ','MTG','デジモンカード','ユニオンアリーナ','シャドウバース','バトルスピリッツ','ロルカナ','カードショップ巡り','デッキ構築','カード収集','トレード','対戦会','大会参加','オリパ','鑑定カード','PSA','コレクション','ボードゲーム']),
  ('映画',array['映画','邦画','洋画','アクション映画','SF映画','恋愛映画','コメディ映画','ホラー映画','ミステリー映画','短編映画','ドキュメンタリー','韓国映画','フランス映画','インド映画','映画館','ミニシアター','IMAX','Netflix','Amazon Prime Video','Disney+','海外ドラマ','国内ドラマ','韓国ドラマ','舞台鑑賞','ミュージカル']),
  ('漫画',array['漫画','少年漫画','少女漫画','青年漫画','女性漫画','恋愛漫画','ギャグ漫画','スポーツ漫画','バトル漫画','ミステリー漫画','ホラー漫画','日常漫画','Web漫画','同人誌','コミケ','漫画喫茶','電子書籍','ライトノベル','小説','読書','書店巡り','図書館','エッセイ','詩','歴史小説']),
  ('食べ物',array['ラーメン','つけ麺','寿司','焼肉','焼き鳥','カレー','ハンバーグ','パスタ','ピザ','餃子','中華料理','韓国料理','タイ料理','ベトナム料理','インド料理','フレンチ','イタリアン','和食','スイーツ','パン','チョコレート','アイス','食べ歩き','料理','自炊']),
  ('カフェ',array['カフェ','喫茶店','カフェラテ','コーヒー','紅茶','抹茶','純喫茶','古民家カフェ','夜カフェ','朝カフェ','ブックカフェ','猫カフェ','コンセプトカフェ','アフタヌーンティー','モーニング','カフェ巡り','コーヒースタンド','スペシャルティコーヒー','ラテアート','プリン','パフェ','パンケーキ','ドーナツ','かき氷','テラス席']),
  ('お酒',array['お酒','ビール','クラフトビール','ワイン','日本酒','焼酎','ウイスキー','ハイボール','カクテル','サワー','梅酒','居酒屋','立ち飲み','バー','ワインバー','ビアガーデン','せんべろ','はしご酒','宅飲み','ノンアルコール','おつまみ','醸造所巡り','日本酒バー','ナチュールワイン','乾杯']),
  ('ファッション',array['ファッション','古着','ストリートファッション','モード','カジュアル','きれいめ','韓国ファッション','ヴィンテージ','スニーカー','革靴','アクセサリー','腕時計','帽子','デニム','セレクトショップ','古着屋巡り','ショッピング','美容','コスメ','ネイル','ヘアカラー','香水','メイク','スキンケア','サロン']),
  ('スポーツ',array['スポーツ','サッカー','野球','バスケットボール','バレーボール','テニス','卓球','バドミントン','ラグビー','アメフト','格闘技','ボクシング','プロレス','ゴルフ','ランニング','マラソン','筋トレ','ヨガ','ピラティス','水泳','ボルダリング','スケートボード','サイクリング','スポーツ観戦','ダンス']),
  ('旅行',array['旅行','国内旅行','海外旅行','ひとり旅','温泉旅行','日帰り旅行','ドライブ','鉄道旅行','飛行機','ホテル','旅館','キャンプ','グランピング','登山','ハイキング','海','離島','世界遺産','神社仏閣','御朱印','道の駅','絶景','夜景','写真旅行','食旅']),
  ('性格',array['よく笑う','穏やか','聞き上手','話し好き','人見知り','マイペース','好奇心旺盛','ポジティブ','慎重','行動派','インドア','アウトドア','几帳面','おおらか','素直','真面目','自由人','負けず嫌い','優しい','さっぱり','一途','甘えたい','甘えられたい','ツッコミ','ボケ']),
  ('MBTI',array['INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP','ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP','MBTI好き','内向型','外向型','直感型','感覚型','思考型','感情型','計画型','柔軟型']),
  ('恋愛観',array['まずは友達から','ゆっくり仲良く','真剣な出会い','結婚を見据えたい','気軽に話したい','趣味友達から','価値観重視','フィーリング重視','会話重視','安心感重視','尊重し合いたい','一緒に成長したい','自然体でいたい','連絡はまめ','連絡はゆっくり','電話も好き','会って話したい','お出かけしたい','おうち時間も好き','記念日を大切に','束縛しない','支え合いたい','笑いのある関係','長く付き合いたい','将来を話したい']),
  ('休日の過ごし方',array['散歩','街歩き','公園','美術館','博物館','水族館','動物園','テーマパーク','ライブハウス','お笑いライブ','買い物','カフェでのんびり','家でのんびり','ゲームで遊ぶ','読書する','料理する','スポーツする','友達と遊ぶ','推し活','イベント参加','写真を撮る','旅行に行く','ドライブする','銭湯','サウナ']),
  ('ライフスタイル',array['朝型','夜型','平日休み','土日休み','在宅勤務','出社勤務','シフト勤務','一人暮らし','家族と同居','ペットと暮らす','犬好き','猫好き','禁煙','喫煙','お酒は時々','お酒を飲まない','健康志向','ミニマリスト','節約','自己投資','資格勉強','語学学習','副業','ワークライフバランス','東京初心者']),
  ('クリエイティブ',array['写真','動画撮影','動画編集','イラスト','デザイン','グラフィックデザイン','Webデザイン','プログラミング','Web制作','アプリ開発','AI','生成AI','ブログ','ライティング','小説を書く','ハンドメイド','陶芸','絵画','映像制作','配信','歌ってみた','踊ってみた','音楽制作','DJ','創作活動']),
  ('SNS・インターネット文化',array['X','Instagram','TikTok','YouTube','Twitch','Discord','note','Pinterest','Reddit','VTuber','配信者','ネットミーム','ショート動画','ポッドキャスト','ラジオ','ライブ配信','ゲーム実況','歌い手','踊り手','Vlog','ガジェット','Apple','Android','自作PC','インターネット文化']),
  ('その他',array['友達募集','仕事','恋愛','東京','北千住','綾瀬','上野','浅草','秋葉原','池袋','新宿','渋谷','吉祥寺','下北沢','中野','高円寺','表参道','銀座','丸の内','お台場','横浜','埼玉','千葉','社会人','学生'])
), expanded as (
  select category,name,ordinality from catalog,unnest(names) with ordinality as item(name,ordinality)
)
insert into public.tags(name,category,popularity,status)
select name,category,greatest(1,30-ordinality::integer),'active' from expanded
on conflict(name) do update set category=excluded.category,status='active';

update public.tags set aliases=array['ポケモンカードゲーム','Pokemon Card Game','Pokemon TCG'] where name='ポケカ';
update public.tags set aliases=array['ONE PIECEカードゲーム','ワンピカード','ワンピカ'] where name='ワンピースカード';
update public.tags set aliases=array['マジック・ザ・ギャザリング','Magic: The Gathering'] where name='MTG';
update public.tags set aliases=array['トレーディングカードゲーム'] where name='TCG';
update public.tags set aliases=array['Twitter','ツイッター'] where name='X';
update public.tags set aliases=array['ボーカロイド','VOCALOID'] where name='ボカロ';
update public.tags set aliases=array['人工知能','ChatGPT'] where name='AI';
update public.tags set aliases=array['筋力トレーニング','ジム'] where name='筋トレ';

create or replace function public.get_tag_catalog(
  p_query text default '',p_category text default null,p_limit integer default 120
) returns table(
  tag_id bigint,name text,category text,aliases text[],popularity integer,recent_uses integer
) language sql stable security definer set search_path=public as $$
  with normalized as (
    select lower(regexp_replace(trim(coalesce(p_query,'')),'[[:space:]　・ー_-]+','','g')) q
  )
  select t.id,t.name,t.category,t.aliases,t.popularity,
    (select count(*)::integer from public.user_tags ut where ut.tag_id=t.id and ut.selected_at>now()-interval '7 days') recent_uses
  from public.tags t cross join normalized n
  where t.status='active'
    and (p_category is null or p_category='' or t.category=p_category)
    and (n.q='' or lower(regexp_replace(t.name,'[[:space:]　・ー_-]+','','g')) like '%'||n.q||'%'
      or exists(select 1 from unnest(t.aliases) a where lower(regexp_replace(a,'[[:space:]　・ー_-]+','','g')) like '%'||n.q||'%'))
  order by recent_uses desc,t.popularity desc,t.name
  limit least(greatest(coalesce(p_limit,120),1),500)
$$;

create or replace function public.set_my_profile_tags_v2(p_tag_names text[],p_primary_names text[] default array[]::text[])
returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid;v_count integer;v_primary_count integer;
begin
  v_user:=public.current_app_user_id();
  if v_user is null then raise exception 'authenticated user required';end if;
  select count(distinct x) into v_count from unnest(coalesce(p_tag_names,array[]::text[])) x;
  select count(distinct x) into v_primary_count from unnest(coalesce(p_primary_names,array[]::text[])) x;
  if v_count not between 5 and 50 then raise exception 'select between 5 and 50 tags';end if;
  if v_primary_count>5 then raise exception 'up to 5 primary tags can be selected';end if;
  if exists(select 1 from unnest(coalesce(p_primary_names,array[]::text[])) x where not(x=any(p_tag_names))) then raise exception 'primary tags must be selected';end if;
  if exists(select 1 from unnest(p_tag_names) x where not exists(select 1 from public.tags t where t.name=x and t.status='active')) then raise exception 'unknown profile tag';end if;
  delete from public.user_tags where user_id=v_user;
  insert into public.user_tags(user_id,tag_id,is_primary,sort_order,selected_at)
    select v_user,t.id,t.name=any(coalesce(p_primary_names,array[]::text[])),array_position(p_tag_names,t.name),now()
    from public.tags t where t.name=any(p_tag_names);
end $$;

drop function if exists public.get_discovery_profiles(integer);
create function public.get_discovery_profiles(p_limit integer default 24)
returns table(
  user_id uuid,display_name text,handle text,bio text,avatar_url text,is_official boolean,liked boolean,
  profile_tags text[],primary_tags text[],common_tag_count integer,activity_status text,relevance_score numeric
) language sql stable security definer set search_path=public as $$
  with viewer as (
    select public.current_app_user_id() id
  ), candidates as (
    select u.id,p.display_name,p.handle,p.bio,p.avatar_url,u.role,u.last_seen_at,
      exists(select 1 from public.discovery_likes dl,viewer v where dl.sender_id=v.id and dl.receiver_id=u.id) liked,
      coalesce((select array_agg(t.name order by ut.is_primary desc,ut.sort_order,t.name) from public.user_tags ut join public.tags t on t.id=ut.tag_id where ut.user_id=u.id),array[]::text[]) tags,
      coalesce((select array_agg(t.name order by ut.sort_order,t.name) from public.user_tags ut join public.tags t on t.id=ut.tag_id where ut.user_id=u.id and ut.is_primary),array[]::text[]) primaries,
      (select count(*)::integer from public.user_tags a join public.user_tags b on b.tag_id=a.tag_id,viewer v where a.user_id=v.id and b.user_id=u.id) common_count,
      (select coalesce(sum(1.0/sqrt(greatest(1,(select count(*) from public.user_tags all_ut where all_ut.tag_id=a.tag_id)))),0) from public.user_tags a join public.user_tags b on b.tag_id=a.tag_id,viewer v where a.user_id=v.id and b.user_id=u.id) rare_score,
      (select count(*) from public.user_tags where user_id=u.id) tag_count
    from public.users u join public.profiles p on p.user_id=u.id,viewer v
    where u.id<>v.id and u.status='active' and not u.is_demo and u.age_verified and u.age_verification_status='verified'
      and u.terms_accepted_at is not null and u.privacy_accepted_at is not null
      and not exists(select 1 from public.blocks b where (b.blocker_id,b.blocked_id) in ((v.id,u.id),(u.id,v.id)))
      and not exists(select 1 from public.matches m where m.ended_at is null and v.id in(m.user_a,m.user_b) and u.id in(m.user_a,m.user_b))
  )
  select c.id,c.display_name,c.handle,c.bio,c.avatar_url,c.role='owner',c.liked,c.tags,c.primaries,c.common_count,
    case when c.last_seen_at>now()-interval '3 days' then 'recent' when c.last_seen_at>now()-interval '30 days' then 'away' else 'inactive' end,
    round(((c.common_count/greatest(1,sqrt(c.tag_count::numeric)))+c.rare_score)::numeric,3) as score
  from candidates c where c.common_count>=5
  order by score desc,c.last_seen_at desc
  limit least(greatest(coalesce(p_limit,24),1),50)
$$;

revoke all on function public.get_tag_catalog(text,text,integer) from public;
revoke all on function public.set_my_profile_tags_v2(text[],text[]) from public,anon;
revoke all on function public.get_discovery_profiles(integer) from public,anon;
grant execute on function public.get_tag_catalog(text,text,integer) to anon,authenticated;
grant execute on function public.set_my_profile_tags_v2(text[],text[]) to authenticated;
grant execute on function public.get_discovery_profiles(integer) to authenticated;
