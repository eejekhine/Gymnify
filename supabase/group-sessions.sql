-- Gymnify group sessions. Lives in the shared Klander Supabase project, separate gym_* tables.
-- Privacy: a session is invite-only, invitees must be accepted Klander friends who opted in,
-- and only joined/left members of a session can read its sets. Everything is enforced here.

create table if not exists public.gym_prefs (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  group_ok boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.gym_sessions (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'Group session' check (char_length(title) between 1 and 60),
  plan jsonb not null default '[]'::jsonb check (jsonb_typeof(plan) = 'array' and jsonb_array_length(plan) <= 40),
  status text not null default 'open' check (status in ('open','ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.gym_session_members (
  session_id uuid not null references public.gym_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited','joined','declined','left')),
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz,
  primary key (session_id, user_id)
);
create index if not exists gym_session_members_user_idx on public.gym_session_members(user_id, status);

create table if not exists public.gym_session_sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.gym_sessions(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_key text not null check (char_length(client_key) <= 80),
  exercise text not null check (char_length(exercise) <= 80),
  set_no int not null default 1,
  weight_kg numeric check (weight_kg is null or (weight_kg >= 0 and weight_kg < 2000)),
  reps numeric check (reps is null or (reps >= 0 and reps < 10000)),
  is_pr boolean not null default false,
  created_at timestamptz not null default now(),
  unique (session_id, user_id, client_key)
);
create index if not exists gym_session_sets_session_idx on public.gym_session_sets(session_id, created_at);

create table if not exists public.gym_session_hi5 (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.gym_sessions(id) on delete cascade,
  from_user uuid not null default auth.uid() references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists gym_session_hi5_session_idx on public.gym_session_hi5(session_id, created_at);

alter table public.gym_prefs enable row level security;
alter table public.gym_sessions enable row level security;
alter table public.gym_session_members enable row level security;
alter table public.gym_session_sets enable row level security;
alter table public.gym_session_hi5 enable row level security;

-- helpers (security definer so policies do not recurse)
create or replace function public.gym_is_member(sid uuid, statuses text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.gym_session_members m
    where m.session_id = sid and m.user_id = (select auth.uid()) and m.status = any(statuses));
$$;

create or replace function public.gym_blocked(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocks x
    where (x.user_id = a and x.blocked_id = b) or (x.user_id = b and x.blocked_id = a));
$$;

create or replace function public.gym_friend_of(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships f where f.status = 'accepted'
    and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a)));
$$;

-- policies
create policy gym_prefs_own on public.gym_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy gym_sessions_read on public.gym_sessions for select to authenticated
  using (host_id = (select auth.uid()) or public.gym_is_member(id, array['invited','joined','left']));

create policy gym_members_read on public.gym_session_members for select to authenticated
  using (user_id = (select auth.uid()) or public.gym_is_member(session_id, array['joined','left']));

create policy gym_sets_read on public.gym_session_sets for select to authenticated
  using (public.gym_is_member(session_id, array['joined','left']));
create policy gym_sets_insert on public.gym_session_sets for insert to authenticated
  with check (user_id = (select auth.uid()) and public.gym_is_member(session_id, array['joined'])
    and exists (select 1 from public.gym_sessions s where s.id = session_id and s.status = 'open'));
create policy gym_sets_update on public.gym_session_sets for update to authenticated
  using (user_id = (select auth.uid()) and public.gym_is_member(session_id, array['joined']))
  with check (user_id = (select auth.uid()) and public.gym_is_member(session_id, array['joined']));
create policy gym_sets_delete on public.gym_session_sets for delete to authenticated
  using (user_id = (select auth.uid()) and public.gym_is_member(session_id, array['joined']));

create policy gym_hi5_read on public.gym_session_hi5 for select to authenticated
  using (public.gym_is_member(session_id, array['joined','left']));
create policy gym_hi5_insert on public.gym_session_hi5 for insert to authenticated
  with check (from_user = (select auth.uid()) and to_user <> (select auth.uid())
    and public.gym_is_member(session_id, array['joined'])
    and exists (select 1 from public.gym_session_members m where m.session_id = gym_session_hi5.session_id
      and m.user_id = to_user and m.status in ('joined','left')));

-- no direct writes to sessions/members: only through the functions below
revoke insert, update, delete on public.gym_sessions, public.gym_session_members from authenticated, anon;
revoke all on public.gym_prefs, public.gym_sessions, public.gym_session_members,
  public.gym_session_sets, public.gym_session_hi5 from anon;

-- friends who opted in
create or replace function public.gym_friends()
returns table(id uuid, display_name text, username text, colour text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, p.username::text, p.colour
  from public.friendships f
  join public.profiles p on p.id = case when f.requester = (select auth.uid()) then f.addressee else f.requester end
  join public.gym_prefs g on g.user_id = p.id and g.group_ok
  where f.status = 'accepted'
    and (f.requester = (select auth.uid()) or f.addressee = (select auth.uid()))
    and not public.gym_blocked((select auth.uid()), p.id)
  order by coalesce(p.display_name, p.username::text);
$$;

create or replace function public.gym_invite(sid uuid, ids uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); n int := 0; u uuid; cnt int; st text;
begin
  if me is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.gym_session_members m join public.gym_sessions s on s.id = m.session_id
      where m.session_id = sid and m.user_id = me and m.status = 'joined' and s.status = 'open') then
    raise exception 'you are not in this open session';
  end if;
  foreach u in array coalesce(ids, '{}') loop
    if u = me then continue; end if;
    if not public.gym_friend_of(me, u) or public.gym_blocked(me, u) then continue; end if;
    if not exists (select 1 from public.gym_prefs g where g.user_id = u and g.group_ok) then continue; end if;
    select count(*) into cnt from public.gym_session_members m where m.session_id = sid and m.status in ('invited','joined');
    select m.status into st from public.gym_session_members m where m.session_id = sid and m.user_id = u;
    if st in ('invited','joined') then continue; end if;
    if cnt >= 8 then exit; end if;
    insert into public.gym_session_members(session_id, user_id, status, invited_by)
      values (sid, u, 'invited', me)
      on conflict (session_id, user_id) do update set status = 'invited', invited_by = me
      where public.gym_session_members.status in ('declined','left');
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.gym_create_session(p_title text, p_plan jsonb, p_invite uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); sid uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if (select count(*) from public.gym_sessions s where s.host_id = me and s.status = 'open') >= 3 then
    raise exception 'too many open sessions: end one first';
  end if;
  insert into public.gym_sessions(host_id, title, plan)
    values (me, left(coalesce(nullif(trim(p_title), ''), 'Group session'), 60), coalesce(p_plan, '[]'::jsonb))
    returning id into sid;
  insert into public.gym_session_members(session_id, user_id, status, joined_at) values (sid, me, 'joined', now());
  perform public.gym_invite(sid, p_invite);
  return sid;
end $$;

create or replace function public.gym_respond(sid uuid, accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not signed in'; end if;
  update public.gym_session_members m
     set status = case when accept then 'joined' else 'declined' end,
         joined_at = case when accept then now() else m.joined_at end
   where m.session_id = sid and m.user_id = me and m.status = 'invited'
     and exists (select 1 from public.gym_sessions s where s.id = sid and s.status = 'open');
  if not found then raise exception 'no open invite'; end if;
end $$;

create or replace function public.gym_leave(sid uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not signed in'; end if;
  update public.gym_session_members m set status = 'left'
   where m.session_id = sid and m.user_id = me and m.status in ('joined','invited');
  if not exists (select 1 from public.gym_session_members m where m.session_id = sid and m.status = 'joined') then
    update public.gym_sessions s set status = 'ended', ended_at = now() where s.id = sid and s.status = 'open';
  end if;
end $$;

create or replace function public.gym_end(sid uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  update public.gym_sessions s set status = 'ended', ended_at = now()
   where s.id = sid and s.host_id = me and s.status = 'open';
  if not found then raise exception 'only the host can end an open session'; end if;
end $$;

create or replace function public.gym_my_sessions()
returns table(id uuid, title text, host_id uuid, status text, plan jsonb, created_at timestamptz,
              my_status text, members jsonb)
language sql stable security definer set search_path = '' as $$
  select s.id, s.title, s.host_id, s.status, s.plan, s.created_at, me.status,
    (select jsonb_agg(jsonb_build_object('id', m.user_id,
        'name', coalesce(nullif(p.display_name, ''), p.username::text, 'Friend'),
        'colour', p.colour, 'status', m.status) order by m.joined_at nulls last, p.username::text)
       from public.gym_session_members m left join public.profiles p on p.id = m.user_id
      where m.session_id = s.id and m.status in ('invited','joined','left'))
  from public.gym_session_members me
  join public.gym_sessions s on s.id = me.session_id
  where me.user_id = (select auth.uid()) and me.status in ('invited','joined','left')
    and (s.status = 'open' or s.ended_at > now() - interval '12 hours')
  order by s.created_at desc
  limit 20;
$$;

revoke execute on function public.gym_is_member(uuid, text[]), public.gym_blocked(uuid, uuid), public.gym_friend_of(uuid, uuid),
  public.gym_friends(), public.gym_invite(uuid, uuid[]), public.gym_create_session(text, jsonb, uuid[]),
  public.gym_respond(uuid, boolean), public.gym_leave(uuid), public.gym_end(uuid), public.gym_my_sessions() from public, anon;
grant execute on function public.gym_is_member(uuid, text[]), public.gym_friends(), public.gym_invite(uuid, uuid[]),
  public.gym_create_session(text, jsonb, uuid[]), public.gym_respond(uuid, boolean), public.gym_leave(uuid),
  public.gym_end(uuid), public.gym_my_sessions() to authenticated;
-- gym_blocked / gym_friend_of are internal: only the definer functions call them
-- (policies call gym_is_member, which authenticated must be able to execute)

-- keep data short-lived: sessions (and their sets) are deleted 30 days after they start
select cron.schedule('gym-session-cleanup', '23 3 * * *',
  $$delete from public.gym_sessions where created_at < now() - interval '30 days'$$);

comment on table public.gym_sessions is 'Gymnify group sessions: invite-only, friends only, auto-deleted after 30 days.';
