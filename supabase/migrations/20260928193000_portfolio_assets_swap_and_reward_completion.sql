begin;

alter table public.wallets drop constraint if exists wallets_asset_check;
alter table public.wallets drop constraint if exists wallets_check;
alter table public.wallets drop constraint if exists wallets_network_check;
alter table public.wallets add constraint wallets_asset_check check (asset = any (array['TON','USDT','BTC','SOL','BNB']));
alter table public.wallets add constraint wallets_check check (
  (asset='TON' and network='TON') or
  (asset='USDT' and network='TRC-20') or
  (asset in ('BTC','SOL','BNB') and network='INTERNAL')
);
alter table public.wallets add constraint wallets_network_check check (network = any (array['TON','TRC-20','INTERNAL']));

create or replace function private.complete_exhausted_rewards()
returns trigger language plpgsql security definer set search_path=public,private as $$
begin
  if new.status='active' and coalesce(new.remaining_reward,0)<=0 then
    new.status='completed';
    new.completed_at=coalesce(new.completed_at,now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_complete_exhausted_rewards on public.user_rewards;
create trigger trg_complete_exhausted_rewards
before insert or update of remaining_reward,status on public.user_rewards
for each row execute function private.complete_exhausted_rewards();

update public.user_rewards set status='completed',completed_at=coalesce(completed_at,now())
where status='active' and coalesce(remaining_reward,0)<=0;

create or replace function private.swap_assets(p_user_id uuid,p_from_asset text,p_to_asset text,p_amount numeric,p_rate numeric)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_from public.wallets%rowtype; v_to public.wallets%rowtype; v_receive numeric; v_reference text;
begin
  if p_user_id is null then raise exception 'User is required'; end if;
  if p_from_asset=p_to_asset then raise exception 'Choose two different assets'; end if;
  if p_amount<=0 or p_rate<=0 then raise exception 'Invalid swap quote'; end if;
  if p_from_asset not in ('TON','USDT','BTC','SOL','BNB') or p_to_asset not in ('TON','USDT','BTC','SOL','BNB') then raise exception 'Asset is not supported'; end if;
  select * into v_from from public.wallets where user_id=p_user_id and asset=p_from_asset for update;
  if not found then raise exception 'Source wallet not found'; end if;
  if v_from.available_balance<p_amount then raise exception 'Insufficient available balance'; end if;
  select * into v_to from public.wallets where user_id=p_user_id and asset=p_to_asset for update;
  if not found then
    insert into public.wallets(user_id,asset,network,available_balance,locked_balance)
    values(p_user_id,p_to_asset,case when p_to_asset='TON' then 'TON' when p_to_asset='USDT' then 'TRC-20' else 'INTERNAL' end,0,0)
    returning * into v_to;
  end if;
  v_receive=round(p_amount*p_rate,10);
  v_reference='swap_'||gen_random_uuid()::text;
  update public.wallets set available_balance=available_balance-p_amount,updated_at=now() where id=v_from.id;
  update public.wallets set available_balance=available_balance+v_receive,updated_at=now() where id=v_to.id;
  insert into public.wallet_transactions(user_id,wallet_id,type,direction,amount,status,reference,network_fee)
  values(p_user_id,v_from.id,'adjustment','debit',p_amount,'completed',v_reference||'_out',0),
        (p_user_id,v_to.id,'adjustment','credit',v_receive,'completed',v_reference||'_in',0);
  return jsonb_build_object('ok',true,'from_asset',p_from_asset,'to_asset',p_to_asset,'amount',p_amount,'received',v_receive,'rate',p_rate,'reference',v_reference);
end;
$$;

revoke all on function private.swap_assets(uuid,text,text,numeric,numeric) from public,anon,authenticated;

create or replace function public.swap_assets(p_from_asset text,p_to_asset text,p_amount numeric,p_rate numeric)
returns jsonb language plpgsql security definer set search_path=public,private as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  return private.swap_assets(auth.uid(),p_from_asset,p_to_asset,p_amount,p_rate);
end;
$$;
revoke all on function public.swap_assets(text,text,numeric,numeric) from public,anon;
grant execute on function public.swap_assets(text,text,numeric,numeric) to authenticated;

commit;