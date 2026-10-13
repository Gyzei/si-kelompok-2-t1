-- Run once in the SQL Editor of a dedicated Supabase project.
begin;
create table if not exists public.da_runs (
 id uuid primary key default gen_random_uuid(), semester text not null check(semester ~ '^\d{4}[12]$'),
 phase text not null default 'pt', status text not null default 'running', cursor integer not null default 1,
 total_pt integer, total_pages integer, publish_offset integer not null default 0, total_dosen integer, plan_ready boolean not null default false,
 owner uuid, lease_until timestamptz, error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz
);
alter table public.da_runs add column if not exists plan_ready boolean not null default false;
create table if not exists public.da_state (singleton boolean primary key default true check(singleton), active_run uuid references public.da_runs(id));
insert into public.da_state(singleton) values(true) on conflict do nothing;
create table if not exists public.da_pt (
 run_id uuid references public.da_runs(id) on delete cascade, id text not null, payload jsonb not null, processed boolean not null default false,
 primary key(run_id,id)
);
create table if not exists public.da_programs (
 run_id uuid references public.da_runs(id) on delete cascade, id text not null, id_pt text not null, payload jsonb not null,
 processed boolean not null default false, raw jsonb, retrieved integer, primary key(run_id,id),
 foreign key(run_id,id_pt) references public.da_pt(run_id,id) on delete cascade
);
create table if not exists public.da_publish_chunks (
 run_id uuid references public.da_runs(id) on delete cascade, page_offset integer not null, items jsonb not null, total integer not null,
 primary key(run_id,page_offset)
);
create or replace function public.da_normalize(value text) returns text language sql immutable as $$
 select trim(regexp_replace(translate(lower(coalesce(value,'')),'áàâäãåéèêëíìîïóòôöõúùûüñç','aaaaaaeeeeiiiiooooouuuunc'), '[^[:alnum:]]+', ' ', 'g'))
$$;
create table if not exists public.da_lecturers (
 run_id uuid references public.da_runs(id) on delete cascade, id text not null, nama text not null, nidn text not null default '', nuptk text not null default '',
 payload jsonb not null, primary key(run_id,id)
);
create index if not exists da_lecturers_name on public.da_lecturers(run_id,lower(nama),id);
create index if not exists da_lecturers_nidn on public.da_lecturers(run_id,nidn);
create index if not exists da_lecturers_nuptk on public.da_lecturers(run_id,nuptk);
create table if not exists public.da_affiliations (
 run_id uuid not null, lecturer_id text not null, id_pt text not null, id_prodi text not null, status_pt text not null,
 search_text text not null, search_vector tsvector generated always as (to_tsvector('simple',public.da_normalize(search_text))) stored,
 primary key(run_id,lecturer_id,id_pt,id_prodi), foreign key(run_id,lecturer_id) references public.da_lecturers(run_id,id) on delete cascade
);
create index if not exists da_affiliations_search on public.da_affiliations using gin(search_vector);
create index if not exists da_affiliations_filters on public.da_affiliations(run_id,id_pt,id_prodi,status_pt,lecturer_id);

create or replace function public.da_metadata() returns jsonb language sql security invoker set search_path=public as $$
 select jsonb_build_object('run_id',r.id,'semester',r.semester,'updated_at',r.completed_at,
  'total_dosen',(select count(*) from da_lecturers where run_id=r.id),
  'perguruan_tinggi',coalesce((select jsonb_agg(p.payload || jsonb_build_object('dosen_count',(select count(distinct a.lecturer_id) from da_affiliations a where a.run_id=r.id and a.id_pt=p.id)) order by p.payload->>'nama') from da_pt p where p.run_id=r.id),'[]'::jsonb),
  'prodi',coalesce((select jsonb_agg(p.payload || jsonb_build_object('jumlah_dosen_terambil',p.retrieved) order by p.payload->>'nama') from da_programs p where p.run_id=r.id),'[]'::jsonb),
  'sync',(select jsonb_build_object('status',status,'phase',phase,'updated_at',updated_at) from da_runs order by created_at desc limit 1))
 from da_state s left join da_runs r on r.id=s.active_run where s.singleton
$$;

create or replace function public.da_search(p_query text default '',p_pt text default '',p_prodi text default '',p_status text default '',p_page integer default 1,p_size integer default 25,p_desc boolean default false)
 returns jsonb language plpgsql security invoker set search_path=public as $$
declare active uuid; terms tsquery; normalized text; compact text; result jsonb;
begin
 if p_page<1 or p_size not in (25,50,100,500) or length(p_query)>120 then raise exception 'Invalid search parameters'; end if;
 select active_run into active from da_state where singleton;
 normalized:=da_normalize(p_query);compact:=regexp_replace(p_query,'[ .\-[:space:]]','','g');
 if normalized<>'' then select to_tsquery('simple',string_agg(quote_literal(token)||':*',' & ')) into terms from regexp_split_to_table(normalized,' +') token;end if;
 with matched as materialized (
  select l.*,case when da_normalize(l.nama)=normalized then 3 when da_normalize(l.nama) like normalized||'%' then 2 else 1 end rank
  from da_lecturers l where l.run_id=active and exists (
   select 1 from da_affiliations a where a.run_id=l.run_id and a.lecturer_id=l.id
    and (p_pt='' or a.id_pt=p_pt) and (p_prodi='' or a.id_prodi=p_prodi) and (p_status='' or a.status_pt=p_status)
    and (normalized='' or (compact ~ '^(\d{10}|\d{16})$' and (l.nidn=compact or l.nuptk=compact))
      or (compact !~ '^(\d{10}|\d{16})$' and a.search_vector @@ terms))
  )
 ), page as (
  select * from matched order by rank desc,case when not p_desc then lower(nama) end asc,case when p_desc then lower(nama) end desc,id
  limit p_size offset (p_page::bigint-1)*p_size
 )
 select jsonb_build_object('run_id',active,'total',(select count(*) from matched),'page',p_page,'size',p_size,'items',coalesce((select jsonb_agg(payload order by rank desc,case when not p_desc then lower(nama) end asc,case when p_desc then lower(nama) end desc,id) from page),'[]'::jsonb)) into result;
 return result;
end $$;

create or replace function public.da_sync_claim(p_semester text,p_owner uuid,p_restart boolean default false) returns jsonb
 language plpgsql security invoker set search_path=public as $$
declare job da_runs; task jsonb;
begin
 perform pg_advisory_xact_lock(hashtext('dosen-aceh-sync'));
 if p_semester !~ '^\d{4}[12]$' then raise exception 'Invalid semester';end if;
 select * into job from da_runs where status in ('running','paused') order by created_at desc limit 1 for update;
 if job.id is not null and job.lease_until>now() then return jsonb_build_object('busy',true);end if;
 if p_restart and job.id is not null then update da_runs set status='cancelled',owner=null,lease_until=null where id=job.id;job.id:=null;end if;
 if job.id is null then insert into da_runs(semester) values(p_semester) returning * into job;
 elsif job.semester<>p_semester then raise exception 'Resume the existing semester or explicitly restart';end if;
 delete from da_runs where status='cancelled' and id is distinct from (select active_run from da_state where singleton);
 update da_runs set owner=p_owner,lease_until=now()+interval '6 minutes',status='running',error=null,updated_at=now() where id=job.id returning * into job;
 if job.phase='pt' then task:=jsonb_build_object('action','pt','page',job.cursor);
 elsif job.phase='prodi' then select jsonb_build_object('action','prodi','pt',payload) into task from da_pt where run_id=job.id and not processed order by payload->>'nama',id limit 1;
 elsif job.phase='dosen' then select jsonb_build_object('action','dosen','program',payload) into task from da_programs where run_id=job.id and not processed order by id_pt,payload->>'nama',id limit 1;
 elsif job.phase='publish' then task:=jsonb_build_object('action','publish','offset',job.publish_offset);
 end if;
 if task is null then raise exception 'Sync task missing';end if;
 return jsonb_build_object('run',to_jsonb(job)-'owner'-'lease_until','task',task);
end $$;

create or replace function public.da_sync_commit(p_run uuid,p_owner uuid,p_task jsonb,p_data jsonb) returns jsonb
 language plpgsql security invoker set search_path=public as $$
declare job da_runs; item jsonb; aff jsonb; pt jsonb; program jsonb; old_active uuid; action text:=p_task->>'action';
begin
 select * into job from da_runs where id=p_run and owner=p_owner and lease_until>now() for update;
 if job.id is null then raise exception 'Sync lease expired';end if;
 if action<>job.phase then raise exception 'Sync phase mismatch';end if;
 if action='pt' then
  if (p_data->>'page')::int<>job.cursor or (p_task->>'page')::int<>job.cursor then raise exception 'Page mismatch';end if;
  if job.total_pt is not null and (job.total_pt<>(p_data->>'totalItems')::int or job.total_pages<>(p_data->>'totalPages')::int) then raise exception 'PT totals changed';end if;
  for item in select value from jsonb_array_elements(p_data->'items') loop
   insert into da_pt(run_id,id,payload) values(job.id,item->>'id',item) on conflict(run_id,id) do update set payload=excluded.payload;
  end loop;
  update da_runs set total_pt=(p_data->>'totalItems')::int,total_pages=(p_data->>'totalPages')::int,cursor=cursor+1 where id=job.id;
  if job.cursor=(p_data->>'totalPages')::int then
   if (select count(*) from da_pt where run_id=job.id)<>(p_data->>'totalItems')::int then raise exception 'PT unique total mismatch';end if;
   update da_runs set phase=case when (p_data->>'totalItems')::int=0 then 'publish' else 'prodi' end where id=job.id;
  end if;
 elsif action='prodi' then
  select payload into pt from da_pt where run_id=job.id and id=p_task->'pt'->>'id' and not processed;
  if pt is null then raise exception 'PT already processed';end if;
  for item in select value from jsonb_array_elements(p_data->'items') loop
   if item->>'id_pt'<>pt->>'id' then raise exception 'PT affiliation mismatch';end if;
   item:=item || jsonb_build_object('nama_pt',pt->>'nama','status_pt',pt->>'status','kab_kota',pt->>'kab_kota');
   insert into da_programs(run_id,id,id_pt,payload) values(job.id,item->>'id',pt->>'id',item) on conflict(run_id,id) do update set payload=excluded.payload;
  end loop;
  update da_pt set processed=true where run_id=job.id and id=pt->>'id';
  if not exists(select 1 from da_pt where run_id=job.id and not processed) then
   update da_runs set phase=case when exists(select 1 from da_programs where run_id=job.id) then 'dosen' else 'publish' end where id=job.id;
  end if;
 elsif action='dosen' then
  select payload into program from da_programs where run_id=job.id and id=p_task->'program'->>'id' and not processed;
  if program is null then raise exception 'Program already processed';end if;
  if coalesce((p_data->>'empty_response')::boolean,false) and coalesce((program->>'jumlah_dosen_api')::int,-1)<>0 then raise exception 'Unexpected empty homebase';end if;
  update da_programs set raw=p_data->'items',retrieved=jsonb_array_length(p_data->'items'),processed=true where run_id=job.id and id=program->>'id';
  if not exists(select 1 from da_programs where run_id=job.id and not processed) then update da_runs set phase='publish' where id=job.id;end if;
 elsif action='publish' then
  if not job.plan_ready or job.total_dosen<>(p_data->>'total')::int then raise exception 'Publish plan not ready';end if;
  if (p_task->>'offset')::int<>job.publish_offset then raise exception 'Publish offset mismatch';end if;
  for item in select value from jsonb_array_elements(p_data->'items') loop
   insert into da_lecturers(run_id,id,nama,nidn,nuptk,payload) values(job.id,item->>'id',item->>'nama',item->>'nidn',item->>'nuptk',item)
    on conflict(run_id,id) do update set payload=excluded.payload,nama=excluded.nama,nidn=excluded.nidn,nuptk=excluded.nuptk;
   delete from da_affiliations where run_id=job.id and lecturer_id=item->>'id';
   for aff in select value from jsonb_array_elements(item->'afiliasi') loop
    insert into da_affiliations(run_id,lecturer_id,id_pt,id_prodi,status_pt,search_text) values(job.id,item->>'id',aff->>'id_pt',aff->>'id_prodi',coalesce(aff->>'status_pt',''),
     concat_ws(' ',item->>'nama',item->>'nama_lain',item->>'nidn',item->>'nuptk',aff->>'nama_pt',aff->>'nama_prodi',aff->>'kab_kota',aff->>'jenjang'));
   end loop;
  end loop;
  update da_runs set publish_offset=publish_offset+jsonb_array_length(p_data->'items'),total_dosen=(p_data->>'total')::int where id=job.id;
  if job.publish_offset+jsonb_array_length(p_data->'items')=(p_data->>'total')::int then
   if exists(select 1 from da_pt where run_id=job.id and not processed) or exists(select 1 from da_programs where run_id=job.id and not processed)
     or (select count(*) from da_lecturers where run_id=job.id)<>(p_data->>'total')::int then raise exception 'Snapshot is incomplete';end if;
   select active_run into old_active from da_state where singleton for update;
   update da_state set active_run=job.id where singleton;
   update da_runs set status='complete',phase='complete',completed_at=now() where id=job.id;
   update da_programs set raw=null where run_id=job.id;
   delete from da_publish_chunks where run_id=job.id;
   delete from da_runs where id<>job.id and id is distinct from old_active;
  end if;
 end if;
 update da_runs set owner=null,lease_until=null,error=null,updated_at=now() where id=job.id;
 return (select to_jsonb(r)-'owner'-'lease_until' from da_runs r where id=job.id);
end $$;

create or replace function public.da_prepare_chunk(p_run uuid,p_owner uuid,p_offset integer,p_items jsonb,p_total integer) returns void
 language plpgsql security invoker set search_path=public as $$
begin
 if not exists(select 1 from da_runs where id=p_run and owner=p_owner and lease_until>now() and phase='publish' and not plan_ready) then raise exception 'Sync lease expired';end if;
 if p_offset<0 or p_offset%500<>0 or jsonb_array_length(p_items)>500 then raise exception 'Invalid publish chunk';end if;
 insert into da_publish_chunks(run_id,page_offset,items,total) values(p_run,p_offset,p_items,p_total) on conflict(run_id,page_offset) do update set items=excluded.items,total=excluded.total;
end $$;
create or replace function public.da_plan_ready(p_run uuid,p_owner uuid,p_total integer) returns void
 language plpgsql security invoker set search_path=public as $$
begin
 if not exists(select 1 from da_runs where id=p_run and owner=p_owner and lease_until>now() and phase='publish') then raise exception 'Sync lease expired';end if;
 if (select coalesce(sum(jsonb_array_length(items)),0) from da_publish_chunks where run_id=p_run)<>p_total
   or (select count(*) from da_publish_chunks where run_id=p_run)<>greatest(1,ceil(p_total/500.0)::int) then raise exception 'Publish plan incomplete';end if;
 update da_runs set plan_ready=true,total_dosen=p_total where id=p_run;
end $$;
create or replace function public.da_publish_chunk(p_run uuid,p_offset integer) returns jsonb language sql security invoker set search_path=public as $$
 select jsonb_build_object('items',items,'total',total) from da_publish_chunks where run_id=p_run and page_offset=p_offset
$$;

create or replace function public.da_sync_fail(p_run uuid,p_owner uuid,p_error text) returns void language sql security invoker set search_path=public as $$
 update da_runs set status='paused',error=left(p_error,1000),owner=null,lease_until=null,updated_at=now() where id=p_run and owner=p_owner
$$;
create or replace function public.da_sync_records(p_run uuid,p_offset integer,p_limit integer default 500) returns jsonb language sql security invoker set search_path=public as $$
 select coalesce(jsonb_agg(record order by id,ordinal),'[]'::jsonb) from (
  select p.id,d.ordinal, d.item || jsonb_build_object('afiliasi',jsonb_build_object('id_pt',p.id_pt,'nama_pt',p.payload->>'nama_pt','status_pt',p.payload->>'status_pt','kab_kota',p.payload->>'kab_kota',
   'id_prodi',p.id,'nama_prodi',p.payload->>'nama','jenjang',p.payload->>'jenjang','status_prodi',p.payload->>'status','semester',r.semester)) record
  from da_programs p join da_runs r on r.id=p.run_id cross join lateral jsonb_array_elements(p.raw) with ordinality d(item,ordinal)
  where p.run_id=p_run order by p.id,d.ordinal limit least(p_limit,500) offset p_offset
 ) records
$$;
create or replace function public.da_sync_status() returns jsonb language sql security invoker set search_path=public as $$
 select to_jsonb(r)-'owner'-'lease_until' || jsonb_build_object('pt_processed',(select count(*) from da_pt where run_id=r.id and processed),'prodi_total',(select count(*) from da_programs where run_id=r.id),
 'prodi_processed',(select count(*) from da_programs where run_id=r.id and processed)) from da_runs r order by created_at desc limit 1
$$;

alter table public.da_runs enable row level security;
alter table public.da_state enable row level security;
alter table public.da_pt enable row level security;
alter table public.da_programs enable row level security;
alter table public.da_lecturers enable row level security;
alter table public.da_affiliations enable row level security;
alter table public.da_publish_chunks enable row level security;
revoke all on public.da_runs,public.da_state,public.da_pt,public.da_programs,public.da_lecturers,public.da_affiliations,public.da_publish_chunks from public,anon,authenticated;
grant all on public.da_runs,public.da_state,public.da_pt,public.da_programs,public.da_lecturers,public.da_affiliations,public.da_publish_chunks to service_role;
do $$ declare f record; begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'da_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
