-- Flexa AI: restore real $25 welcome-credit semantics and make claiming atomic.
-- The welcome reward is trade credit, not cash: it is visible in trading power
-- and activity, can fund eligible trades, and only reward-derived profit reaches
-- the withdrawable wallet balance at settlement.

update public.reward_campaigns
set code = 'WELCOME_25',
    reward_amount = 25,
    expiry_days = 14
where code = 'WELCOME_50';

update public.app_settings
set value = 'WELCOME_25'::jsonb, updated_at = now()
where key = 'welcome_reward_campaign';

update public.app_settings
set value = '25'::jsonb, updated_at = now()
where key = 'welcome_reward_amount';

update public.app_settings
set value = '14'::jsonb, updated_at = now()
where key = 'welcome_reward_expiry_days';

update public.app_settings
set value = 'Only profit generated from the $25 welcome reward is eligible for withdrawal; the $25 reward itself is non-withdrawable. Reward-derived profit must be withdrawn before the reward expiry deadline.'::jsonb,
    updated_at = now()
where key = 'reward_withdrawal_policy';

-- Existing test/live reward records follow the new campaign amount.
update public.user_rewards ur
set reward_amount = 25,
    remaining_reward = case
      when ur.status = 'active' then least(ur.remaining_reward, 25)
      else least(ur.remaining_reward, 25)
    end,
    expires_at = case
      when ur.status = 'active' and ur.claimed_at is not null
        then greatest(ur.expires_at, ur.claimed_at + interval '14 days')
      else ur.expires_at
    end
from public.reward_campaigns rc
where ur.campaign_id = rc.id
  and rc.code = 'WELCOME_25';

create or replace function private.claim_welcome_reward(
  p_user_id uuid,
  p_campaign_code text default 'WELCOME_25'
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  campaign reward_campaigns%rowtype;
  reward user_rewards%rowtype;
  claimed boolean := false;
begin
  if p_user_id is null then
    raise exception 'User is required';
  end if;

  select *
  into campaign
  from reward_campaigns
  where code = p_campaign_code
    and active = true
  for update;

  if not found then
    raise exception 'Welcome campaign is unavailable';
  end if;

  select *
  into reward
  from user_rewards
  where user_id = p_user_id
    and campaign_id = campaign.id
  for update;

  if not found then
    insert into user_rewards(
      user_id, campaign_id, reward_amount, remaining_reward,
      profit_cap, status, expires_at
    )
    values(
      p_user_id, campaign.id, campaign.reward_amount, campaign.reward_amount,
      campaign.profit_cap, 'available',
      now() + make_interval(days => campaign.expiry_days)
    )
    returning * into reward;
  end if;

  if reward.status = 'available' then
    if reward.expires_at <= now() then
      update user_rewards
      set status = 'expired', updated_at = now()
      where id = reward.id
      returning * into reward;
    else
      update user_rewards
      set status = 'active',
          claimed_at = coalesce(claimed_at, now()),
          reward_amount = campaign.reward_amount,
          remaining_reward = least(remaining_reward, campaign.reward_amount),
          expires_at = now() + make_interval(days => campaign.expiry_days),
          updated_at = now()
      where id = reward.id
      returning * into reward;

      claimed := true;

      insert into wallet_transactions(
        user_id, wallet_id, type, direction, amount, status,
        reference, metadata, completed_at
      )
      values(
        p_user_id, null, 'bonus', 'credit', campaign.reward_amount,
        'completed',
        'welcome_bonus_claim_' || reward.id,
        jsonb_build_object(
          'reward_id', reward.id,
          'campaign_id', campaign.id,
          'campaign_code', campaign.code,
          'non_withdrawable', true
        ),
        now()
      )
      on conflict (reference) do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'id', reward.id,
    'status', reward.status,
    'reward_amount', reward.reward_amount,
    'remaining_reward', reward.remaining_reward,
    'profit_earned', reward.profit_earned,
    'profit_withdrawable', reward.profit_withdrawable,
    'profit_cap', reward.profit_cap,
    'claimed_at', reward.claimed_at,
    'expires_at', reward.expires_at,
    'claimed_now', claimed
  );
end;
$function$;

revoke all on function private.claim_welcome_reward(uuid, text) from public;
revoke all on function private.claim_welcome_reward(uuid, text) from anon;
revoke all on function private.claim_welcome_reward(uuid, text) from authenticated;
grant execute on function private.claim_welcome_reward(uuid, text) to service_role;
