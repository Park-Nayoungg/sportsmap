-- =========================================
-- 0) 확장
-- =========================================
create extension if not exists citext;

-- =========================================
-- 1) 관리자 화이트리스트 + 판별 함수
-- =========================================
create table if not exists public.admin_users(
  user_id uuid primary key
);
alter table public.admin_users enable row level security;

drop policy if exists "no select admin_users" on public.admin_users;
create policy "no select admin_users"
on public.admin_users for select to authenticated using (false);

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(select 1 from public.admin_users u where u.user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- =========================================
-- 2) 프로필
-- =========================================
create table if not exists public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nickname text,
  fullname text,
  birthdate date,
  is_admin boolean default false, -- 표시용(실권은 admin_users)
  updated_at timestamptz default now()
);
alter table public.profiles enable row level security;

drop policy if exists "read own profile"   on public.profiles;
drop policy if exists "insert own profile" on public.profiles;
drop policy if exists "update own profile" on public.profiles;

create policy "read own profile"
on public.profiles for select to authenticated
using (auth.uid() = id);

create policy "insert own profile"
on public.profiles for insert to authenticated
with check (auth.uid() = id);

create policy "update own profile"
on public.profiles for update to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);


-- 닉네임 가드 트리거
create or replace function public.profiles_nickname_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean := coalesce(public.is_admin(), false);
begin
  NEW.updated_at := now();

  -- 관리자이면 강제로 고정
  if v_is_admin then
    NEW.nickname := '[관리자]';
    return NEW;
  end if;

  -- 일반 사용자가 '[관리자]' 또는 '관리자' 를 입력하면 차단
  if NEW.nickname is not null and (NEW.nickname = '[관리자]' or lower(NEW.nickname) = '관리자') then
    raise exception '해당 닉네임은 예약어입니다.' using errcode = '22023';
  end if;

  -- 일반 검증
  if NEW.nickname is null then
    raise exception '닉네임은 필수입니다.' using errcode = '22023';
  end if;

  NEW.nickname := regexp_replace(NEW.nickname, '\s+', ' ', 'g');
  NEW.nickname := btrim(NEW.nickname);

  if length(NEW.nickname) < 2 or length(NEW.nickname) > 20 then
    raise exception '닉네임은 2~20자여야 합니다.' using errcode = '22023';
  end if;

  if NEW.nickname !~ '^[A-Za-z0-9가-힣 _\-\(\)·\.]+$' then
    raise exception '허용되지 않는 문자가 포함되었습니다.' using errcode = '22023';
  end if;

  return NEW;
end;
$$;

drop index if exists public.uniq_profiles_nickname_lower;
create unique index if not exists uniq_profiles_nickname
  on public.profiles (lower(nickname))
  where nickname is not null and nickname <> '[관리자]';

drop trigger if exists trg_profiles_nickname_guard on public.profiles;
create trigger trg_profiles_nickname_guard
before insert or update of nickname on public.profiles
for each row execute function public.profiles_nickname_guard();

-- =========================================
-- 3) 일일참여 게시글
-- =========================================
create table if not exists public.daily_posts(
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);
alter table public.daily_posts enable row level security;

-- 컬럼 보강
alter table public.daily_posts
  add column if not exists type         text,
  add column if not exists sport_label  text,
  add column if not exists address      text,
  add column if not exists start        timestamptz,
  add column if not exists "end"        timestamptz,
  add column if not exists capacity     int,
  add column if not exists host         text,
  add column if not exists note         text,
  add column if not exists contact      text;

alter table public.daily_posts
  add column if not exists recruit_mode text;

alter table public.daily_posts alter column recruit_mode set default 'selection';
alter table public.daily_posts
  drop constraint if exists daily_posts_recruit_mode_chk,
  add  constraint daily_posts_recruit_mode_chk
  check (recruit_mode in ('fcfs','selection'));

-- 시간 제약
alter table public.daily_posts
  drop constraint if exists daily_time_order;
alter table public.daily_posts
  add constraint daily_time_order
  check ("end" is null or start is null or "end" >= start);

-- RLS
drop policy if exists "read all posts"   on public.daily_posts;
drop policy if exists "insert own post"  on public.daily_posts;
drop policy if exists "update own post"  on public.daily_posts;
drop policy if exists "delete own post"  on public.daily_posts;

create policy "read all posts"
on public.daily_posts for select to anon, authenticated
using (true);

create policy "insert own post"
on public.daily_posts for insert to authenticated
with check (auth.uid() = user_id);

create policy "update own post"
on public.daily_posts for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "delete own post"
on public.daily_posts for delete to authenticated
using (auth.uid() = user_id);

create policy "admin delete"
on public.daily_posts for delete to authenticated
using (public.is_admin());

-- =========================================
-- 4) 신청 테이블 (단일 표준: participation_apps)
-- =========================================
create table if not exists public.participation_apps(
  id bigserial primary key,
  post_id bigint not null references public.daily_posts(id) on delete cascade,
  applicant_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','accepted','rejected','cancelled')),
  created_at timestamptz default now(),
  decided_at timestamptz,
  unique(post_id, applicant_id)
);
alter table public.participation_apps enable row level security;

-- 조회: 본인 신청 또는 해당 게시글 호스트
drop policy if exists "apps select scoped" on public.participation_apps;
create policy "apps select scoped"
on public.participation_apps for select to authenticated
using (
  applicant_id = auth.uid()
  or exists (select 1 from public.daily_posts p where p.id = post_id and p.user_id = auth.uid())
);

-- 본인만 insert 가능
drop policy if exists "apps insert self" on public.participation_apps;
create policy "apps insert self"
on public.participation_apps for insert to authenticated
with check (applicant_id = auth.uid());

-- 호스트는 상태 변경 가능
drop policy if exists "apps host update" on public.participation_apps;
create policy "apps host update"
on public.participation_apps for update to authenticated
using (exists (select 1 from public.daily_posts p where p.id = post_id and p.user_id = auth.uid()))
with check (exists (select 1 from public.daily_posts p where p.id = post_id and p.user_id = auth.uid()));

-- 신청자 본인은 'cancelled'로만 변경(원하면 유지)
drop policy if exists "apps self cancel" on public.participation_apps;
create policy "apps self cancel"
on public.participation_apps for update to authenticated
using (applicant_id = auth.uid())
with check (applicant_id = auth.uid() and status = 'cancelled');

-- 인덱스
create index if not exists idx_apps_post on public.participation_apps(post_id);
create index if not exists idx_apps_applicant on public.participation_apps(applicant_id);
create index if not exists idx_apps_post_status on public.participation_apps(post_id) where status='accepted';

-- =========================================
-- 5) 알림
-- =========================================
create table if not exists public.notifications (
  id bigserial primary key,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'post_deleted',
  payload jsonb not null,
  category text default 'system',
  created_at timestamptz default now(),
  read_at timestamptz
);
alter table public.notifications enable row level security;

alter table public.notifications
  drop constraint if exists notifications_category_check,
  add  constraint notifications_category_check
  check (category in ('notice','system','participation','moderation'));

drop policy if exists "read own notifications"   on public.notifications;
drop policy if exists "no insert from client"    on public.notifications;
drop policy if exists "update own notifications" on public.notifications;
drop policy if exists "delete own notifications" on public.notifications;

create policy "read own notifications"
on public.notifications for select to authenticated
using (auth.uid() = recipient_id);

create policy "no insert from client"
on public.notifications for insert to authenticated
with check (false);

create policy "update own notifications"
on public.notifications for update to authenticated
using (auth.uid() = recipient_id)
with check (auth.uid() = recipient_id);

create policy "delete own notifications"
on public.notifications for delete to authenticated
using (auth.uid() = recipient_id);

create index if not exists idx_notif_rec_created
  on public.notifications(recipient_id, created_at desc);

create index if not exists idx_notif_rec_cat_created
  on public.notifications(recipient_id, category, created_at desc);

-- 글 삭제 시 알림(시스템)
create or replace function public.notify_post_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.notifications(recipient_id, type, payload, category)
  values (
    old.user_id,
    'post_deleted',
    jsonb_build_object(
      'post_id',     old.id,
      'sport_label', old.sport_label,
      'address',     old.address,
      'deleted_by',  auth.uid(),
      'deleted_at',  now()
    ),
    'system'
  );
  return null;
end;
$fn$;
revoke all on function public.notify_post_deleted() from public;

drop trigger if exists trg_notify_post_deleted on public.daily_posts;
create trigger trg_notify_post_deleted
after delete on public.daily_posts
for each row execute function public.notify_post_deleted();

-- =========================================
-- 6) 신청 RPC: submit_application(post_id)
--    선착순(fcfs)면 즉시 확정, 선발(selection)이면 pending
--    중복신청/정원 초과 방지 및 알림 발송
-- =========================================
create or replace function public.submit_application(p_post_id bigint, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_post record;
  v_status text;
  v_app_id bigint;
  v_accepted_count int;
  v_nick text;
  v_email text;
  v_prev_status text;
begin
  if v_user is null then
    raise exception 'not authenticated' using ERRCODE = '28000';
  end if;

  select id, user_id, capacity,
         coalesce(recruit_mode,'selection') as recruit_mode,
         sport_label, address
    into v_post
  from public.daily_posts
  where id = p_post_id
  for update;

  if not found then
    raise exception 'post not found' using ERRCODE = 'P0002';
  end if;

  if v_post.user_id = v_user then
    raise exception 'host cannot apply' using ERRCODE = 'P0001';
  end if;

  -- 표시 정보: 닉네임은 profiles.nickname, 이메일은 auth.users.email만 사용
  select p.nickname, u.email
    into v_nick, v_email
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = v_user;

  -- 중복 신청 방지
  if exists (
    select 1 from public.participation_apps
    where post_id = p_post_id
      and applicant_id = v_user
      and status in ('pending','accepted')
  ) then
    raise exception 'already applied' using ERRCODE = '23505';
  end if;

  -- 선착순 처리
  if v_post.recruit_mode = 'fcfs' then
    select count(*) into v_accepted_count
    from public.participation_apps
    where post_id = p_post_id and status = 'accepted';

    if v_post.capacity is not null and v_accepted_count >= v_post.capacity then
      raise exception 'capacity full' using ERRCODE = 'P0001';
    end if;

    v_status := 'accepted';
  else
    v_status := 'pending';
  end if;
  -- 기존 신청 여부 확인 (재신청 처리 정책)
  select status into v_prev_status
  from public.participation_apps
  where post_id = p_post_id and applicant_id = v_user;

  if v_prev_status is not null then
    if v_prev_status in ('pending','accepted') then
      raise exception 'already applied' using ERRCODE = '23505';
    elsif v_prev_status = 'rejected' then
      raise exception 'already rejected' using ERRCODE = 'P0001';
    elsif v_prev_status = 'cancelled' then
      raise exception 'already cancelled' using ERRCODE = 'P0001';
    end if;
  end if;

  insert into public.participation_apps
    (post_id, applicant_id, status, message, decided_at)
  values
    (p_post_id, v_user, v_status, p_message,
     case when v_status='accepted' then now() else null end)
  returning id into v_app_id;

  -- 호스트에게 새 신청 알림
  insert into public.notifications(recipient_id, type, payload, category)
  values (
    v_post.user_id,
    'new_application',
    jsonb_build_object(
      'post_id',         p_post_id,
      'sport_label',     v_post.sport_label,
      'address',         v_post.address,
      'status',          v_status,
      'applicant_id',    v_user,
      'applicant_nick',  coalesce(nullif(v_nick,''), split_part(coalesce(v_email,''), '@', 1)),
      'applicant_email', v_email
    ),
    'participation'
  );

  -- 선착순 즉시 확정이면 신청자에게도 알림
  if v_status = 'accepted' then
    insert into public.notifications(recipient_id, type, payload, category)
    values (
      v_user,
      'application_accepted',
      jsonb_build_object(
        'post_id',     p_post_id,
        'sport_label', v_post.sport_label,
        'address',     v_post.address
      ),
      'participation'
    );
  end if;

  return jsonb_build_object('app_id', v_app_id, 'status', v_status);
end;
$$;

revoke all on function public.submit_application(bigint) from public;
grant execute on function public.submit_application(bigint) to authenticated;

-- 신청 승인/거절 RPC
create or replace function public.decide_application(p_app_id bigint, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_act  text := lower(p_action);
  v_app  public.participation_apps%rowtype;
  v_post record;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode='28000';
  end if;

  if v_act not in ('accept','reject') then
    raise exception 'invalid action' using errcode='22023';
  end if;

  select * into v_app from public.participation_apps where id = p_app_id for update;
  if not found then
    raise exception 'application not found' using errcode='P0002';
  end if;

  select id, user_id, capacity, sport_label, address
  into v_post
  from public.daily_posts where id = v_app.post_id;
  if not found then
    raise exception 'post not found' using errcode='P0002';
  end if;

  -- 글 주인만 결정 가능
  if v_post.user_id <> v_user then
    raise exception 'forbidden' using errcode='42501';
  end if;

  -- 이미 결정된 건이면 그대로 반환
  if v_app.status in ('accepted','rejected','cancelled') then
    return jsonb_build_object('status', v_app.status);
  end if;

  if v_act='accept' then
    -- 정원 체크(있을 때만)
    if v_post.capacity is not null then
      if (select count(*) from public.participation_apps
          where post_id=v_app.post_id and status='accepted') >= v_post.capacity then
        raise exception 'capacity full' using errcode='P0001';
      end if;
    end if;

    update public.participation_apps
      set status='accepted', decided_at=now()
      where id = p_app_id;

    insert into public.notifications(recipient_id, type, payload, category)
    values (
      v_app.applicant_id,
      'application_accepted',
      jsonb_build_object(
        'post_id', v_app.post_id,
        'sport_label', v_post.sport_label,
        'address', v_post.address
      ),
      'participation'
    );
    return jsonb_build_object('status','accepted');
  else
    update public.participation_apps
      set status='rejected', decided_at=now()
      where id = p_app_id;

    insert into public.notifications(recipient_id, type, payload, category)
    values (
      v_app.applicant_id,
      'application_rejected',
      jsonb_build_object(
        'post_id', v_app.post_id,
        'sport_label', v_post.sport_label,
        'address', v_post.address
      ),
      'participation'
    );
    return jsonb_build_object('status','rejected');
  end if;
end;
$$;

revoke all on function public.decide_application(bigint,text) from public;
grant execute on function public.decide_application(bigint,text) to authenticated;
-- 1) 기존 함수 삭제 (없어도 에러 안 나게 IF EXISTS)
drop function if exists public.host_decide_application(bigint, text);

-- 2) 새 함수 생성
create function public.host_decide_application(p_app_id bigint, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_app  record;
  v_new  public.participation_apps%rowtype;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select a.*, d.user_id as host_id, d.capacity
  into v_app
  from public.participation_apps a
  join public.daily_posts d on d.id = a.post_id
  where a.id = p_app_id;

  if not found then
    raise exception 'application not found' using errcode = 'P0002';
  end if;
  if v_app.host_id <> v_user then
    raise exception 'not owner' using errcode = '42501';
  end if;

  if p_action = 'accept' then
    update public.participation_apps a
    set status='accepted', decided_at=now()
    where a.id = p_app_id
      and a.status='pending'
      and exists (
        select 1
        from public.daily_posts p
        where p.id = a.post_id
          and (
            p.capacity is null
            or (select count(*) from public.participation_apps pa
                where pa.post_id=p.id and pa.status='accepted') < p.capacity
          )
      )
    returning * into v_new;

    if not found then
      raise exception 'capacity full or already decided' using errcode = 'P0001';
    end if;

  elsif p_action = 'reject' then
    update public.participation_apps
    set status='rejected', decided_at=now()
    where id = p_app_id
      and status in ('pending','accepted')
    returning * into v_new;

    if not found then
      raise exception 'already decided' using errcode = 'P0001';
    end if;

  else
    raise exception 'invalid action' using errcode = '22P02';
  end if;

  insert into public.notifications(recipient_id, type, payload, category)
  values (
    v_app.applicant_id,
    case when v_new.status='accepted' then 'application_accepted' else 'application_rejected' end,
    jsonb_build_object('post_id', v_app.post_id),
    'participation'
  );

  return jsonb_build_object('id', v_new.id, 'status', v_new.status);
end;
$$;

-- 3) 권한 부여
grant execute on function public.host_decide_application(bigint, text) to authenticated;

-- =========================================
-- 7) 호스트용 신청자 조회 RPC
--     (닉네임/이메일만, 호스트 본인 글만)
-- =========================================
create or replace function public.list_applicants(_post_id bigint)
returns table(
  applicant_id uuid,
  nickname     text,
  email        text,
  status       text,
  message      text,
  created_at   timestamptz
)
language sql
security definer
set search_path = public
as $$
  select a.applicant_id,
         p.nickname,
         u.email,
         a.status,
         a.message,
         a.created_at
  from public.participation_apps a
  join public.daily_posts d   on d.id = a.post_id
  left join public.profiles p on p.id = a.applicant_id
  left join auth.users u      on u.id = a.applicant_id
  where a.post_id = _post_id
    and d.user_id = auth.uid()
  order by a.created_at asc;
$$;

revoke all on function public.list_applicants(bigint) from public;
grant execute on function public.list_applicants(bigint) to authenticated;

--=======================
--수락 인원 카운터 칼럼
--=======================
-- 1) 컬럼 추가 (없으면)
alter table public.daily_posts
  add column if not exists accepted_count integer not null default 0;

-- 2) 카운터 동기화 트리거 함수
create or replace function public.sync_accepted_count()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  -- INSERT
  if tg_op = 'INSERT' then
    if new.status = 'accepted' then
      update public.daily_posts
         set accepted_count = greatest(0, accepted_count + 1)
       where id = new.post_id;
    end if;
    return new;
  end if;

  -- UPDATE
  if tg_op = 'UPDATE' then
    if coalesce(old.status,'') <> 'accepted' and new.status = 'accepted' then
      update public.daily_posts
         set accepted_count = greatest(0, accepted_count + 1)
       where id = new.post_id;
    elsif old.status = 'accepted' and coalesce(new.status,'') <> 'accepted' then
      update public.daily_posts
         set accepted_count = greatest(0, accepted_count - 1)
       where id = new.post_id;
    end if;
    return new;
  end if;

  -- DELETE
  if tg_op = 'DELETE' then
    if old.status = 'accepted' then
      update public.daily_posts
         set accepted_count = greatest(0, accepted_count - 1)
       where id = old.post_id;
    end if;
    return old;
  end if;

  return null;
end;
$$;

revoke all on function public.sync_accepted_count() from public;

-- 3) 트리거(신청 테이블 이름에 맞춰 적용)
drop trigger if exists trg_sync_accepted_count_ins on public.participation_apps;
drop trigger if exists trg_sync_accepted_count_upd on public.participation_apps;
drop trigger if exists trg_sync_accepted_count_del on public.participation_apps;

-- (선택) 초기 데이터가 있으면 한 번 재계산
update public.daily_posts p
set accepted_count = coalesce(x.cnt,0)
from (
  select post_id, count(*)::int as cnt
  from public.participation_apps
  where status='accepted'
  group by post_id
) x
where x.post_id = p.id;


-- =========================================
-- 8) 프로그램 즐겨찾기 기능
--     메인 지도페이지 및 하루참여 모집
-- =========================================
-- 즐겨찾기
create table if not exists public.daily_favorites(
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id bigint not null references public.daily_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, post_id)
);
alter table public.daily_favorites enable row level security;

-- RLS
drop policy if exists "fav select own" on public.daily_favorites;
drop policy if exists "fav insert own" on public.daily_favorites;
drop policy if exists "fav delete own" on public.daily_favorites;

create policy "fav select own"
on public.daily_favorites for select to authenticated
using (auth.uid() = user_id);

create policy "fav insert own"
on public.daily_favorites for insert to authenticated
with check (auth.uid() = user_id);

create policy "fav delete own"
on public.daily_favorites for delete to authenticated
using (auth.uid() = user_id);

-- 인덱스
create index if not exists idx_fav_user on public.daily_favorites(user_id);
create index if not exists idx_fav_post on public.daily_favorites(post_id);

-- (옵션) 개수 캐시
alter table public.daily_posts
  add column if not exists favorite_count integer not null default 0;

create or replace function public.sync_favorite_count()
returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    update public.daily_posts set favorite_count = greatest(0,favorite_count+1)
    where id = new.post_id; return new;
  elsif tg_op='DELETE' then
    update public.daily_posts set favorite_count = greatest(0,favorite_count-1)
    where id = old.post_id; return old;
  end if;
  return null;
end; $$;
revoke all on function public.sync_favorite_count() from public;

drop trigger if exists trg_fav_ins on public.daily_favorites;
drop trigger if exists trg_fav_del on public.daily_favorites;
create trigger trg_fav_ins after insert on public.daily_favorites
for each row execute function public.sync_favorite_count();
create trigger trg_fav_del after delete on public.daily_favorites
for each row execute function public.sync_favorite_count();

-- 초기 동기화(선택)
update public.daily_posts p
set favorite_count = coalesce(x.cnt,0)
from (select post_id, count(*)::int cnt from public.daily_favorites group by post_id) x
where x.post_id = p.id;

-- (옵션) 마이페이지용 RPC
create or replace function public.list_my_favorites()
returns table(
  post_id bigint,
  sport_label text,
  address text,
  start timestamptz,
  "end" timestamptz,
  created_at timestamptz
)
language sql security definer set search_path=public as $$
  select f.post_id, d.sport_label, d.address, d.start, d."end", f.created_at
  from public.daily_favorites f
  join public.daily_posts d on d.id = f.post_id
  where f.user_id = auth.uid()
  order by f.created_at desc;
$$;
revoke all on function public.list_my_favorites() from public;
grant execute on function public.list_my_favorites() to authenticated;

-- 내 게시글 삭제 기능
-- 작성자만 삭제 허용하는 RPC
create or replace function host_delete_post(p_post_id bigint)
returns void
language plpgsql
security definer
as $$
declare v_owner uuid;
begin
  select user_id into v_owner from daily_posts where id = p_post_id;
  if v_owner is null then raise exception 'post not found'; end if;
  if v_owner <> auth.uid() then raise exception 'not allowed'; end if;
  delete from daily_posts where id = p_post_id; -- CASCADE로 하위 정리
end;
$$;
grant execute on function host_delete_post(bigint) to authenticated;


ALTER TABLE daily_posts
  ADD COLUMN difficulty text
  CHECK (difficulty IN ('easy','normal','hard'))
  DEFAULT 'normal';

create index if not exists idx_daily_posts_type         on public.daily_posts(type);
create index if not exists idx_daily_posts_recruit_mode on public.daily_posts(recruit_mode);
create index if not exists idx_daily_posts_difficulty   on public.daily_posts(difficulty);
create index if not exists idx_daily_posts_start        on public.daily_posts(start);
create index if not exists idx_daily_posts_end          on public.daily_posts("end");

create extension if not exists pg_trgm;
create index if not exists idx_daily_posts_kw on public.daily_posts
  using gin ((coalesce(address,'')||' '||coalesce(note,'')||' '||coalesce(contact,'')||' '||coalesce(host,'')||' '||coalesce(sport_label,'')) gin_trgm_ops);

-- 컬럼
alter table public.daily_posts
  add column if not exists accepted_count int not null default 0;

-- 초기 백필
update public.daily_posts p
set accepted_count = coalesce(a.cnt,0)
from (
  select post_id, count(*) cnt
  from public.participation_apps
  where status = 'accepted'
  group by post_id
) a
where p.id = a.post_id;

-- 트리거 함수
create or replace function public.sync_accepted_count()
returns trigger
language plpgsql
security definer
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'accepted' then
      update public.daily_posts set accepted_count = accepted_count + 1 where id = new.post_id;
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if old.status <> 'accepted' and new.status = 'accepted' then
      update public.daily_posts set accepted_count = accepted_count + 1 where id = new.post_id;
    elsif old.status = 'accepted' and new.status <> 'accepted' then
      update public.daily_posts set accepted_count = accepted_count - 1 where id = new.post_id;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.status = 'accepted' then
      update public.daily_posts set accepted_count = accepted_count - 1 where id = old.post_id;
    end if;
    return old;
  end if;
end;
$$;

-- 트리거
drop trigger if exists trg_sync_accepted_count on public.participation_apps;
create trigger trg_sync_accepted_count
after insert or update or delete on public.participation_apps
for each row execute function public.sync_accepted_count();

-- 일일신청 메시지 작성
alter table public.participation_apps
  add column if not exists message text;

begin;

-- 기존 함수 제거
drop function if exists public.submit_application(bigint);

-- 메시지 파라미터 포함해 재생성
create or replace function public.submit_application(p_post_id bigint, p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_post record;
  v_status text := 'pending';
  v_app_id bigint;
  v_accepted_count int;
  v_nick text;
  v_email text;
  v_prev_status text;
  v_msg text := nullif(btrim(coalesce(p_message,'')), '');
begin
  if v_user is null then
    raise exception 'not authenticated' using ERRCODE = '28000';
  end if;

  select id, user_id, capacity,
         coalesce(recruit_mode,'selection') as recruit_mode,
         sport_label, address
    into v_post
  from public.daily_posts
  where id = p_post_id
  for update;

  if not found then
    raise exception 'post not found' using ERRCODE = 'P0002';
  end if;

  if v_post.user_id = v_user then
    raise exception 'host cannot apply' using ERRCODE = 'P0001';
  end if;

  select p.nickname, u.email
    into v_nick, v_email
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = v_user;

  if exists (
    select 1 from public.participation_apps
    where post_id = p_post_id
      and applicant_id = v_user
      and status in ('pending','accepted')
  ) then
    raise exception 'already applied' using ERRCODE = '23505';
  end if;

  if v_post.recruit_mode = 'fcfs' then
    select count(*) into v_accepted_count
    from public.participation_apps
    where post_id = p_post_id and status = 'accepted';

    if v_post.capacity is not null and v_accepted_count >= v_post.capacity then
      raise exception 'capacity full' using ERRCODE = 'P0001';
    end if;

    v_status := 'accepted';
  else
    v_status := 'pending';
  end if;

  select status into v_prev_status
  from public.participation_apps
  where post_id = p_post_id and applicant_id = v_user;

  if v_prev_status is not null then
    if v_prev_status in ('pending','accepted') then
      raise exception 'already applied' using ERRCODE = '23505';
    elsif v_prev_status in ('rejected','cancelled') then
      raise exception 'already %', v_prev_status using ERRCODE = 'P0001';
    end if;
  end if;

  insert into public.participation_apps(post_id, applicant_id, status, message)
  values (p_post_id, v_user, v_status, v_msg)
  returning id into v_app_id;

  -- 호스트 알림에 신청 메시지도 포함
  insert into public.notifications(recipient_id, type, payload, category)
  values (
    v_post.user_id,
    'new_application',
    jsonb_build_object(
      'post_id',         p_post_id,
      'sport_label',     v_post.sport_label,
      'address',         v_post.address,
      'status',          v_status,
      'applicant_id',    v_user,
      'applicant_nick',  coalesce(nullif(v_nick,''), split_part(coalesce(v_email,''), '@', 1)),
      'applicant_email', v_email,
      'message',         coalesce(v_msg,'')
    ),
    'participation'
  );

  if v_status = 'accepted' then
    insert into public.notifications(recipient_id, type, payload, category)
    values (
      v_user,
      'application_accepted',
      jsonb_build_object('post_id', p_post_id, 'sport_label', v_post.sport_label, 'address', v_post.address),
      'participation'
    );
  end if;

  return jsonb_build_object('app_id', v_app_id, 'status', v_status);
end;
$$;

revoke all on function public.submit_application(bigint, text) from public;
grant execute on function public.submit_application(bigint, text) to authenticated;

commit;


select tgname, tgfoid::regprocedure as func
from pg_trigger
where tgrelid = 'public.participation_apps'::regclass
  and not tgisinternal;

-- 전부 제거
drop trigger if exists trg_sync_accepted_count       on public.participation_apps;
drop trigger if exists trg_sync_accepted_count_ins   on public.participation_apps;
drop trigger if exists trg_sync_accepted_count_upd   on public.participation_apps;
drop trigger if exists trg_sync_accepted_count_del   on public.participation_apps;

-- 함수는 하나만 유지(이미 있다면 재생성 가능)
create or replace function public.sync_accepted_count()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'accepted' then
      update public.daily_posts
         set accepted_count = greatest(0, accepted_count + 1)
       where id = new.post_id;
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if coalesce(old.status,'') <> 'accepted' and new.status = 'accepted' then
      update public.daily_posts
         set accepted_count = greatest(0, accepted_count + 1)
       where id = new.post_id;
    elsif old.status = 'accepted' and coalesce(new.status,'') <> 'accepted' then
      update public.daily_posts
         set accepted_count = greatest(0, accepted_count - 1)
       where id = new.post_id;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.status = 'accepted' then
      update public.daily_posts
         set accepted_count = greatest(0, accepted_count - 1)
       where id = old.post_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

revoke all on function public.sync_accepted_count() from public;

-- 단일 트리거만 생성
create trigger trg_sync_accepted_count
after insert or update or delete on public.participation_apps
for each row execute function public.sync_accepted_count();

-- 우선 0으로 초기화
update public.daily_posts set accepted_count = 0;

-- 다시 집계
update public.daily_posts p
set accepted_count = x.cnt
from (
  select post_id, count(*)::int as cnt
  from public.participation_apps
  where status = 'accepted'
  group by post_id
) x
where p.id = x.post_id;

-- ===================================
-- 커뮤니티 스키마 전체(안전 재실행용)
-- ===================================

-- 1) 테이블
create table if not exists public.community_posts (
  id             bigserial primary key,
  author_id      uuid not null references public.profiles(id) on delete cascade,
  title          text not null check (char_length(title) between 1 and 120),
  body_md        text not null,
  images         text[] default '{}',
  tags           text[] default '{}',
  pinned         boolean default false,
  visibility     text not null default 'public' check (visibility in ('public','followers','private')),
  like_count     integer not null default 0,
  comment_count  integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create table if not exists public.community_comments (
  id           bigserial primary key,
  post_id      bigint not null references public.community_posts(id) on delete cascade,
  author_id    uuid not null references public.profiles(id) on delete cascade,
  body_md      text not null,
  parent_id    bigint references public.community_comments(id) on delete cascade,
  like_count   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create table if not exists public.community_reactions (
  post_id    bigint not null references public.community_posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(post_id, user_id)
);

create table if not exists public.user_relations (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key(follower_id, followee_id),
  check (follower_id <> followee_id)
);

create table if not exists public.community_reports (
  id         bigserial primary key,
  target     text not null check (target in ('post','comment')),
  target_id  bigint not null,
  reporter   uuid not null references public.profiles(id) on delete cascade,
  reason     text not null,
  created_at timestamptz not null default now(),
  unique(target, target_id, reporter)
);

create table if not exists public.user_blocks (
  blocker uuid not null references public.profiles(id) on delete cascade,
  blocked uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(blocker, blocked),
  check (blocker <> blocked)
);

-- 2) 인덱스
create index if not exists idx_cp_author    on public.community_posts(author_id);
create index if not exists idx_cp_created   on public.community_posts(created_at desc);
create index if not exists idx_cp_tags_gin  on public.community_posts using gin (tags);
create index if not exists idx_cc_post_time on public.community_comments(post_id, created_at);
create index if not exists idx_cc_author    on public.community_comments(author_id);
create index if not exists idx_ur_followee  on public.user_relations(followee_id);
create index if not exists notif_unread_idx on public.notifications(recipient_id, read_at);

-- 3) RLS 활성화
alter table public.community_posts     enable row level security;
alter table public.community_comments  enable row level security;
alter table public.community_reactions enable row level security;
alter table public.user_relations      enable row level security;
alter table public.community_reports   enable row level security;
alter table public.user_blocks         enable row level security;

-- 4) 정책(기존 것 정리 후 생성)
drop policy if exists cp_select       on public.community_posts;
drop policy if exists cp_insert       on public.community_posts;
drop policy if exists cp_update_own   on public.community_posts;
drop policy if exists cp_delete_soft  on public.community_posts;

create policy cp_select on public.community_posts
for select using (
  deleted_at is null
  and (
    visibility = 'public'
    or (visibility='followers' and exists(
      select 1 from public.user_relations r
      where r.follower_id = auth.uid() and r.followee_id = author_id
    ))
    or author_id = auth.uid()
  )
  and not exists (
    select 1 from public.user_blocks b
    where (b.blocker = auth.uid() and b.blocked = author_id)
       or (b.blocker = author_id and b.blocked = auth.uid())
  )
);
create policy cp_insert      on public.community_posts for insert with check (author_id = auth.uid());
create policy cp_update_own  on public.community_posts for update using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy cp_delete_soft on public.community_posts for update using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists cc_select      on public.community_comments;
drop policy if exists cc_insert      on public.community_comments;
drop policy if exists cc_update_own  on public.community_comments;

create policy cc_select     on public.community_comments for select using (deleted_at is null);
create policy cc_insert     on public.community_comments for insert with check (author_id = auth.uid());
create policy cc_update_own on public.community_comments for update using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists cr_all on public.community_reactions;
create policy cr_all on public.community_reactions
for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists ur_all on public.user_relations;
create policy ur_all on public.user_relations
for all using (follower_id = auth.uid()) with check (follower_id = auth.uid());

drop policy if exists rep_insert       on public.community_reports;
drop policy if exists rep_select_admin on public.community_reports;

create policy rep_insert on public.community_reports
for insert with check (reporter = auth.uid());

-- 관리자 판독은 bigint 테이블 비교 대신 함수 사용
create policy rep_select_admin on public.community_reports
for select using (public.is_admin());

-- 5) 공용 함수·트리거
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists t_cp_touch on public.community_posts;
create trigger t_cp_touch before update on public.community_posts
for each row execute function public.touch_updated_at();

drop trigger if exists t_cc_touch on public.community_comments;
create trigger t_cc_touch before update on public.community_comments
for each row execute function public.touch_updated_at();

create or replace function public.bump_post_counters()
returns trigger language plpgsql as $$
begin
  if tg_table_name = 'community_comments' then
    if tg_op='INSERT' then
      update public.community_posts set comment_count = comment_count + 1 where id = new.post_id;
    elsif tg_op='DELETE' then
      update public.community_posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id;
    end if;
  elsif tg_table_name = 'community_reactions' then
    if tg_op='INSERT' then
      update public.community_posts set like_count = like_count + 1 where id = new.post_id;
    elsif tg_op='DELETE' then
      update public.community_posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists t_cc_counter on public.community_comments;
create trigger t_cc_counter after insert or delete on public.community_comments
for each row execute function public.bump_post_counters();

drop trigger if exists t_cr_counter on public.community_reactions;
create trigger t_cr_counter after insert or delete on public.community_reactions
for each row execute function public.bump_post_counters();

-- 알림(댓글)
create or replace function public.notify_on_comment()
returns trigger language plpgsql security definer set search_path=public as $$
declare post_author uuid;
begin
  select author_id into post_author from public.community_posts where id = new.post_id;
  if post_author is not null and post_author <> new.author_id then
    insert into public.notifications(recipient_id, type, payload)
    values (post_author, 'comment_created', jsonb_build_object('post_id', new.post_id, 'comment_id', new.id));
  end if;
  return new;
end $$;

drop trigger if exists t_cc_notify on public.community_comments;
create trigger t_cc_notify after insert on public.community_comments
for each row execute function public.notify_on_comment();

-- 알림(좋아요)
create or replace function public.notify_on_like()
returns trigger language plpgsql security definer set search_path=public as $$
declare post_author uuid;
begin
  select author_id into post_author from public.community_posts where id = new.post_id;
  if post_author is not null and post_author <> new.user_id then
    insert into public.notifications(recipient_id, type, payload)
    values (post_author, 'post_liked', jsonb_build_object('post_id', new.post_id));
  end if;
  return new;
end $$;

drop trigger if exists t_like_notify on public.community_reactions;
create trigger t_like_notify after insert on public.community_reactions
for each row execute function public.notify_on_like();

-- 6) RPC
create or replace function public.create_post(
  p_title text, p_body_md text, p_images text[], p_tags text[], p_visibility text default 'public'
) returns bigint
language plpgsql security definer set search_path=public as $$
declare v_uid uuid := auth.uid(); v_id bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='28000'; end if;
  insert into public.community_posts(author_id, title, body_md, images, tags, visibility)
  values (v_uid, p_title, p_body_md, coalesce(p_images,'{}'), coalesce(p_tags,'{}'), coalesce(p_visibility,'public'))
  returning id into v_id;
  return v_id;
end $$;

-- 관리자 예외는 is_admin()으로 판단
create or replace function public.soft_delete_post(p_post_id bigint)
returns void
language plpgsql security definer set search_path=public as $$
declare v_uid uuid := auth.uid(); v_author uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='28000'; end if;
  select author_id into v_author from public.community_posts where id = p_post_id;
  if v_author is null then raise exception 'not found' using errcode='02000'; end if;
  if v_author <> v_uid and not public.is_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  update public.community_posts set deleted_at = now() where id = p_post_id;
end $$;

create or replace function public.toggle_like(p_post_id bigint)
returns boolean
language plpgsql security definer set search_path=public as $$
declare v_uid uuid := auth.uid(); v_exists boolean;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='28000'; end if;
  select exists(select 1 from public.community_reactions where post_id = p_post_id and user_id = v_uid) into v_exists;
  if v_exists then
    delete from public.community_reactions where post_id = p_post_id and user_id = v_uid;
    return false;
  else
    insert into public.community_reactions(post_id, user_id) values (p_post_id, v_uid);
    return true;
  end if;
end $$;

create or replace function public.add_comment(p_post_id bigint, p_body_md text, p_parent_id bigint default null)
returns bigint
language plpgsql security definer set search_path=public as $$
declare v_uid uuid := auth.uid(); v_id bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='28000'; end if;
  insert into public.community_comments(post_id, author_id, body_md, parent_id)
  values (p_post_id, v_uid, p_body_md, p_parent_id)
  returning id into v_id;
  return v_id;
end $$;


-- 1) 기존 함수 제거(서명 일치)
drop function if exists public.list_applicants(bigint);

-- 2) 새 함수 생성( id + message 포함 )
create function public.list_applicants(_post_id bigint)
returns table(
  id           bigint,
  applicant_id uuid,
  nickname     text,
  email        text,
  status       text,
  message      text,
  created_at   timestamptz
)
language sql
security definer
set search_path = public
as $$
  select a.id,
         a.applicant_id,
         p.nickname,
         u.email,
         a.status,
         a.message,
         a.created_at
  from public.participation_apps a
  join public.daily_posts d   on d.id = a.post_id
  left join public.profiles p on p.id = a.applicant_id
  left join auth.users u      on u.id = a.applicant_id
  where a.post_id = _post_id
    and d.user_id = auth.uid()
  order by a.created_at asc;
$$;

-- 3) 권한 부여
grant execute on function public.list_applicants(bigint) to authenticated;


create policy "read public posts"
on public.community_posts
for select
to anon, authenticated
using (deleted_at is null and visibility = 'public');


-- storage 스키마에 어떤 함수들이 있는지 전부 나열
select n.nspname, p.proname, p.oid::regprocedure as sig,
       pg_get_function_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'storage'
order by proname;


--어떤 칼럼이 있는 지 확
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='storage' and table_name='buckets'
order by ordinal_position;

-- 생성(없으면) 또는 공개로 갱신(있으면)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-images',
  'post-images',
  true,
  5242880, -- 5MB
  ARRAY['image/jpeg','image/png','image/webp','image/gif']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;


select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id='post-images';


-- 공개 읽기
drop policy if exists "read post-images" on storage.objects;
create policy "read post-images"
on storage.objects for select
to public
using (bucket_id = 'post-images');

-- 로그인 사용자만 업로드. 본인 UID/ 경로만 허용
drop policy if exists "upload own" on storage.objects;
create policy "upload own"
on storage.objects for insert
to authenticated
with check (bucket_id='post-images' and name like auth.uid()::text || '/%');

drop policy if exists "update own objects" on storage.objects;
create policy "update own objects"
on storage.objects for update
to authenticated
using     (bucket_id='post-images' and name like auth.uid()::text || '/%')
with check(bucket_id='post-images' and name like auth.uid()::text || '/%');

drop policy if exists "delete own objects" on storage.objects;
create policy "delete own objects"
on storage.objects for delete
to authenticated
using (bucket_id='post-images' and name like auth.uid()::text || '/%');

--20251025 추가내용
-- 관리자 커뮤니티 관리 기능
-- 2) 관리자 전용 조회(삭제글 포함) 정책 추가(선택)
CREATE POLICY cp_select_admin ON public.community_posts
FOR SELECT TO authenticated
USING ( is_admin() );  -- 삭제 여부, 가시성 무시하고 전부 조회

-- 3) 관리자 강제 삭제 + 경고 전송용 RPC (SECURITY DEFINER)
create or replace function public.admin_remove_post(p_post_id bigint, p_reason text)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_author uuid;
  v_title  text;
  v_reason text;
  v_body   text;
begin
  if not is_admin() then raise exception 'forbidden'; end if;

  select author_id, title into v_author, v_title
  from community_posts where id = p_post_id for update;
  if not found then raise exception 'post not found'; end if;

  update community_posts set deleted_at = now() where id = p_post_id;

  v_reason := coalesce(p_reason, '욕설/비방 등 운영정책 위반');
  v_body   := v_reason || '으로 게시글이 삭제되었습니다.' ||
              E'\n제목: ' || coalesce(v_title,'(제목 없음)');

  insert into notifications(
    recipient_id, type, title, body, link, payload
  ) values (
    v_author,
    'warning',
    '커뮤니티 게시글 삭제 안내',
    v_body,
    '/community.html?post='|| p_post_id,
    jsonb_build_object('post_id', p_post_id, 'reason', v_reason)
  );

  return jsonb_build_object('status','ok','post_id',p_post_id);
end; $$;

revoke all on function public.admin_remove_post(bigint,text) from public;
grant execute on function public.admin_remove_post(bigint,text) to authenticated;

-- 4) 신고목록 관리자 조회 RPC(SECURITY DEFINER)
create or replace function public.admin_list_reports_v4(
  p_limit  int default 50,
  p_offset int default 0
) returns table(
  id                bigint,
  target            text,
  target_id         bigint,
  reporter          uuid,
  reason            text,
  created_at        timestamptz,
  post_title        text,
  post_author       uuid,
  author_nickname   text,
  author_email      text
) language sql security definer
set search_path=public
as $$
  select
    r.id,
    r.target,
    r.target_id,
    r.reporter,
    r.reason,
    r.created_at,
    p.title                      as post_title,
    p.author_id                  as post_author,
    coalesce(pr.nickname, pr.full_name, pr.fullname, split_part(au.email,'@',1), '[미설정]')
                                 as author_nickname,
    au.email                     as author_email
  from public.community_reports r
  left join public.community_posts p on p.id = r.target_id
  left join public.profiles pr       on pr.id = p.author_id
  left join auth.users au            on au.id = p.author_id
  where is_admin()
  order by r.created_at desc
  limit coalesce(p_limit,50) offset coalesce(p_offset,0);
$$;

revoke all on function public.admin_list_reports_v4(int,int) from public;
grant execute on function public.admin_list_reports_v4(int,int) to authenticated;

-- 없으면 생성
create table if not exists public.notifications (
  id           bigserial primary key,
  recipient_id uuid not null,
  type         text not null check (type in ('info','warning','system')),
  title        text not null,
  body         text,
  link         text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

-- 조회·카운트 성능
create index if not exists idx_notif_recipient_unread
  on public.notifications(recipient_id, read_at) where read_at is null;
create index if not exists idx_notif_recipient_created
  on public.notifications(recipient_id, created_at desc);


alter table public.notifications enable row level security;

-- 내가 받은 알림만 읽기
create policy notif_select_mine on public.notifications
for select to authenticated
using (recipient_id = auth.uid());

-- 내가 받은 알림만 읽음표시(업데이트)
create policy notif_update_read on public.notifications
for update to authenticated
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

-- 일반 사용자의 insert는 금지(SECURITY DEFINER RPC로만 생성 권장)
revoke insert on public.notifications from anon, authenticated;


-- 미확인 개수
create or replace function public.unread_count()
returns int language sql security definer set search_path=public as $$
  select count(*)::int from notifications
  where recipient_id = auth.uid() and read_at is null;
$$;
revoke all on function public.unread_count() from public;
grant execute on function public.unread_count() to authenticated;

-- 읽음 처리(단건)
create or replace function public.mark_read(p_id bigint)
returns void language sql security definer set search_path=public as $$
  update notifications
     set read_at = now()
   where id = p_id and recipient_id = auth.uid();
$$;
revoke all on function public.mark_read(bigint) from public;
grant execute on function public.mark_read(bigint) to authenticated;

-- 모두 읽음
create or replace function public.mark_all_read()
returns void language sql security definer set search_path=public as $$
  update notifications
     set read_at = now()
   where recipient_id = auth.uid() and read_at is null;
$$;
revoke all on function public.mark_all_read() from public;
grant execute on function public.mark_all_read() to authenticated;

--14:49 수정내역
CREATE OR REPLACE FUNCTION public.admin_remove_post(p_post_id bigint, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_author uuid;
  v_title  text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT author_id, title INTO v_author, v_title
  FROM community_posts
  WHERE id = p_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'post not found';
  END IF;

  UPDATE community_posts
     SET deleted_at = now()
   WHERE id = p_post_id;

  -- notifications 스키마에 맞춰 입력
  INSERT INTO notifications(
    recipient_id,
    type,
    category,
    title,
    body,
    link,
    payload
  ) VALUES (
    v_author,
    'warning',                          -- 알림 유형
    'community',                        -- 카테고리(원하시는 값으로)
    '커뮤니티 게시글이 삭제되었습니다',
    coalesce(p_reason,'운영정책 위반 의심') || E'\n제목: '|| coalesce(v_title,'(제목 없음)'),
    '/community.html?post='|| p_post_id,
    jsonb_build_object(                 -- 부가 데이터
      'post_id', p_post_id,
      'reason',  coalesce(p_reason, null)
    )
  );

  RETURN jsonb_build_object('status','ok','post_id',p_post_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_remove_post(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_remove_post(bigint, text) TO authenticated;


create or replace function public.admin_remove_post(p_post_id bigint, p_reason text)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_author uuid;
  v_title  text;
begin
  if not is_admin() then raise exception 'forbidden'; end if;

  select author_id, title into v_author, v_title
  from community_posts where id = p_post_id for update;
  if not found then raise exception 'post not found'; end if;

  update community_posts set deleted_at = now() where id = p_post_id;

  insert into notifications(                -- ★ category 제거
    recipient_id, type, title, body, link, payload
  ) values (
    v_author,
    'warning',
    '커뮤니티 게시글이 삭제되었습니다',
    coalesce(p_reason,'운영정책 위반 의심') || E'\n제목: '|| coalesce(v_title,'(제목 없음)'),
    '/community.html?post='|| p_post_id,
    jsonb_build_object('post_id', p_post_id, 'reason', coalesce(p_reason, null))
  );

  return jsonb_build_object('status','ok','post_id',p_post_id);
end; $$;

revoke all on function public.admin_remove_post(bigint,text) from public;
grant execute on function public.admin_remove_post(bigint,text) to authenticated;


-- RLS 켜짐 전제. 켜려면: ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 1) 기존 정책 정리
drop policy if exists notif_admin_insert         on public.notifications;
drop policy if exists notif_select_self_or_admin on public.notifications;
drop policy if exists notif_update_self          on public.notifications;
drop policy if exists notif_delete_self          on public.notifications;

-- 2) 관리자만 INSERT 허용 (INSERT는 WITH CHECK만 가능)
create policy notif_admin_insert
on public.notifications
as permissive
for insert
to authenticated
with check ( is_admin() );

-- 3) 조회: 본인 또는 관리자
create policy notif_select_self_or_admin
on public.notifications
as permissive
for select
to authenticated
using ( recipient_id = auth.uid() or is_admin() );

-- 4) 수정: 본인만
create policy notif_update_self
on public.notifications
as permissive
for update
to authenticated
using ( recipient_id = auth.uid() )
with check ( recipient_id = auth.uid() );

-- 5) 삭제: 본인 또는 관리자
create policy notif_delete_self
on public.notifications
as permissive
for delete
to authenticated
using ( recipient_id = auth.uid() or is_admin() );

alter table public.notifications
  add column if not exists title text,
  add column if not exists body text,
  add column if not exists link text,
  add column if not exists payload jsonb;

-- 1) 기존 제약 삭제
alter table public.notifications
  drop constraint if exists notifications_type_check;

-- 2) 현행 값 3종만 허용하도록 재생성
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('post_deleted','post_liked','warning'));



