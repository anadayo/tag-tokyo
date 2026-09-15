-- Editable profile fields unlocked by profile level.
alter table public.profiles
  add column if not exists weekend text not null default '',
  add column if not exists romance_view text not null default '',
  add column if not exists contact_frequency text not null default '',
  add column if not exists values_detail text not null default '',
  add column if not exists lifestyle text not null default '',
  add column if not exists work_detail text not null default '',
  add column if not exists money_style text not null default '',
  add column if not exists marriage_view text not null default '',
  add column if not exists extra_bio text not null default '';

comment on column public.profiles.weekend is 'Unlocked at profile level 3';
comment on column public.profiles.romance_view is 'Unlocked at profile level 5';
comment on column public.profiles.values_detail is 'Unlocked at profile level 7';
comment on column public.profiles.work_detail is 'Unlocked at profile level 9';
comment on column public.profiles.marriage_view is 'Unlocked at profile level 11';
