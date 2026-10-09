-- Keep public map coordinates and server-side action radii in sync.

insert into public.areas(id,name,map_x,map_y,latitude,longitude,contribution_radius_m,active)
values('asakusa','浅草',79,30,35.7119,139.7983,1000,true)
on conflict(id) do update set
  name=excluded.name,map_x=excluded.map_x,map_y=excluded.map_y,
  latitude=excluded.latitude,longitude=excluded.longitude,
  contribution_radius_m=excluded.contribution_radius_m,active=true;

insert into public.tag_spots(id,area_id,name,latitude,longitude,map_x,map_y,radius_m,active)
values
  ('spot-asakusa','asakusa','ASAKUSA TAG SPOT',35.7128,139.7983,80,32,150,true),
  ('spot-kitasenju','kitasenju','KITASENJU TAG SPOT',35.7508,139.8050,80,12,150,true)
on conflict(id) do update set
  area_id=excluded.area_id,name=excluded.name,
  latitude=excluded.latitude,longitude=excluded.longitude,
  map_x=excluded.map_x,map_y=excluded.map_y,radius_m=excluded.radius_m,active=true;
