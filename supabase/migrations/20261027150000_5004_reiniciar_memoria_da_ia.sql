-- manifest: reiniciar a memória da IA de um contato (para testes): fn_reiniciar_memoria_da_ia apaga checkpoint, resumo e notas do lead, volta o funil do agente para new e grava contacts.ia_memoria_desde, que tira do contexto os desfechos anteriores

alter table public.contacts add column if not exists ia_memoria_desde timestamptz;

comment on column public.contacts.ia_memoria_desde is
  'Quando a memória da IA deste contato foi reiniciada (ação "Reiniciar memória da IA"). Desfechos de atendimento fechados antes disto não entram no contexto do agente. NULL = nunca reiniciada. Migration 5004.';

-- Uma transação só: checkpoint (com o resumo acumulado), notas do lead e
-- estágio do funil do agente. As mensagens NÃO são apagadas — saem do contexto
-- porque o atendimento é fechado antes (fn_service_status) e o histórico do
-- turno é o do atendimento atual. Sem seletor além de organização + contato,
-- e só a service role chama (a rota cobra manager+ antes).
create or replace function public.fn_reiniciar_memoria_da_ia(p_org uuid, p_contact uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checkpoints integer;
  v_notas integer;
  v_estagio text;
begin
  if not exists (select 1 from public.contacts where id = p_contact and organization_id = p_org) then
    raise exception 'contato_nao_encontrado' using errcode = 'P0002';
  end if;

  delete from public.lead_checkpoints where organization_id = p_org and contact_id = p_contact;
  get diagnostics v_checkpoints = row_count;

  delete from public.lead_notes where organization_id = p_org and contact_id = p_contact;
  get diagnostics v_notas = row_count;

  select stage into v_estagio from public.lead_state where organization_id = p_org and contact_id = p_contact;
  if v_estagio is not null and v_estagio <> 'new' then
    insert into public.lead_state_transitions (organization_id, contact_id, from_stage, to_stage, reason)
    values (p_org, p_contact, v_estagio, 'new', 'memoria_da_ia_reiniciada');
  end if;
  update public.lead_state
     set stage = 'new', qualification = '{}'::jsonb, next_action = null, updated_at = now()
   where organization_id = p_org and contact_id = p_contact;

  update public.contacts set ia_memoria_desde = now() where id = p_contact and organization_id = p_org;

  return jsonb_build_object('checkpoints', v_checkpoints, 'notas', v_notas, 'estagio_anterior', v_estagio);
end;
$$;

revoke execute on function public.fn_reiniciar_memoria_da_ia(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.fn_reiniciar_memoria_da_ia(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
