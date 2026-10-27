import { FERIADOS_DESLIGADOS, feriadosDasSettings, type ConfigDeFeriados } from '@/lib/tempo/feriados';

import type { Queryable } from '../queue/queue';

/**
 * Os feriados da organização para o bloco `## Agora` (`organizations.settings.feriados`,
 * `lib/tempo/feriados.ts`). Mesma regra do fuso: nunca lança — sem leitura, desligado,
 * e o bloco fica como sempre foi.
 */
export async function feriadosDaOrganizacao(db: Queryable, organizationId: string): Promise<ConfigDeFeriados> {
  try {
    const { rows } = await db.query<{ feriados: unknown }>(
      `select settings -> 'feriados' as feriados from organizations where id = $1`,
      [organizationId],
    );
    return feriadosDasSettings({ feriados: rows[0]?.feriados ?? null });
  } catch {
    return FERIADOS_DESLIGADOS;
  }
}
