-- Align the profile constraint with the 50-character onboarding contract.

alter table public.profiles drop constraint if exists profiles_display_name_check;
alter table public.profiles
  add constraint profiles_display_name_check
  check (char_length(display_name) between 1 and 50);
