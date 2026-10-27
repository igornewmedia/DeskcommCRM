/**
 * QUEM RECEBE AS PASSAGENS (migration 5003) — `ai_agent_versions.handoff_target_user_id`.
 *
 * Vazio = comportamento de sempre: a passagem e o caso vão para a fila e o aviso
 * da Central é da empresa inteira. Preenchido, a passagem e o caso abertos pelo
 * agente:
 *
 *   1. atribuem a conversa à pessoa, pela MESMA função da distribuição e do
 *      `crm_assign_conversation` (`fn_conversation_assign`): na passagem com o
 *      motivo `handoff` (a IA já foi calada pelo `force_human`); no caso com
 *      `routing`, que não mexe no silêncio — o caso espera a pessoa, mas a IA
 *      continua falando com o cliente enquanto isso;
 *   2. dão DONO ao aviso da Central (`agent_inbox_items.para_user_id`): só ela o
 *      vê na Central e no sino, e o push vai só ao celular dela
 *      (`push-dos-avisos.ts`, a mesma regra de `avisoVisivelPara`).
 *
 * A pessoa precisa seguir membro `agent`+ da organização. Se saiu, nada é
 * direcionado e a passagem segue para a fila — falhar fechado aqui seria deixar
 * o cliente sem ninguém.
 */
import type pg from 'pg';

import { loadConversationAgentConfig, loadPublishedAgentConfigById, type PublishedAgentConfig } from './agent-config';
import type { Logger } from '../obs/logger';

export async function destinatarioDaPassagem(
  db: pg.Pool,
  ids: { tenantId: string; conversationId: string; agentId?: string | null },
  log?: Logger,
): Promise<string | null> {
  try {
    let agentConfig: PublishedAgentConfig | null = null;
    if (ids.agentId) {
      agentConfig = await loadPublishedAgentConfigById(db, ids.tenantId, ids.agentId);
    } else {
      const { rows } = await db.query<{ channel_session_id: string | null }>(
        'select channel_session_id from conversations where organization_id = $1 and id = $2',
        [ids.tenantId, ids.conversationId],
      );
      const canal = rows[0]?.channel_session_id;
      if (canal) agentConfig = await loadConversationAgentConfig(db, ids.tenantId, ids.conversationId, canal);
    }
    const alvo = agentConfig?.handoffTargetUserId ?? null;
    if (!alvo) return null;
    const { rows: membro } = await db.query(
      `select 1 from user_organizations
        where organization_id = $1 and user_id = $2 and revoked_at is null
          and role in ('agent', 'manager', 'admin')`,
      [ids.tenantId, alvo],
    );
    if (membro.length === 0) {
      log?.warn('destinatario_da_passagem_fora_da_equipe', { organizationId: ids.tenantId });
      return null;
    }
    return alvo;
  } catch (err) {
    // A passagem não pode cair por causa do direcionamento: sem ele, vai para a fila.
    log?.warn('destinatario_da_passagem_falhou', { organizationId: ids.tenantId, err: String(err) });
    return null;
  }
}

export async function atribuirAoDestinatario(
  db: pg.Pool,
  ids: { tenantId: string; conversationId: string },
  destinatario: string,
  motivo: 'handoff' | 'routing',
  log?: Logger,
): Promise<boolean> {
  try {
    const { rows } = await db.query(
      'select id from public.fn_conversation_assign($1, $2, $3, $4, null, false)',
      [ids.tenantId, ids.conversationId, destinatario, motivo],
    );
    return rows.length > 0;
  } catch (err) {
    log?.warn('atribuir_ao_destinatario_falhou', { organizationId: ids.tenantId, err: String(err) });
    return false;
  }
}
