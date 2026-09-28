import type { ChecklistItem, Signoff, SignoffState } from './types';

/**
 * 检查项内容指纹：覆盖“检查项内容或前置条件”。
 * 仅参与签认失效判定的字段进入指纹；顺序、阶段、关键标记、updatedAt 不影响旧签认。
 */
export function itemFingerprint(item: ChecklistItem): string {
  const basis = {
    challenge: item.challenge.trim(),
    response: item.response.trim(),
    abnormalProcedure: item.abnormalProcedure.trim(),
    preconditionIds: [...item.preconditionIds].sort()
  };
  return JSON.stringify(basis);
}

/**
 * 某张签认单对某个检查项的覆盖状态：
 * - 未覆盖：本单不含该项
 * - stale：登记后该项内容或前置条件变化，本单仅对该项失效
 * - expired：超过签认截止时间，本单整体失效（对该项也失效）
 * - valid：有效沿用
 */
export function coverageState(signoff: Signoff, item: ChecklistItem, nowMs: number): SignoffState | null {
  const fingerprint = signoff.covered[item.id];
  if (!fingerprint) return null;
  if (!Number.isNaN(new Date(signoff.deadline).getTime()) && new Date(signoff.deadline).getTime() < nowMs) return 'expired';
  return fingerprint === itemFingerprint(item) ? 'valid' : 'stale';
}

/** 覆盖该关键项的全部签认单及其状态 */
export function coveringsForItem(
  item: ChecklistItem,
  signoffs: Signoff[],
  nowMs: number
): { signoff: Signoff; state: SignoffState }[] {
  return signoffs
    .map((signoff) => ({ signoff, state: coverageState(signoff, item, nowMs) }))
    .filter((entry): entry is { signoff: Signoff; state: SignoffState } => entry.state !== null);
}

/** 关键项是否存在至少一张有效签认 */
export function hasValidSignoff(item: ChecklistItem, signoffs: Signoff[], nowMs: number): boolean {
  return coveringsForItem(item, signoffs, nowMs).some((entry) => entry.state === 'valid');
}

/**
 * 冻结前复核：每个关键项都必须有有效签认。
 * 返回缺失说明列表；同时返回失效（过期/内容变化）签认关系，便于提示“缺哪张单”。
 */
export interface SignoffGap {
  itemId: string;
  challenge: string;
  reason: 'missing' | 'stale' | 'expired';
  /** 已登记但对该项失效的签认号；missing 时为空 */
  failedNumbers: string[];
  detail: string;
}

export function reviewSignoffCoverage(
  items: ChecklistItem[],
  signoffs: Signoff[],
  nowMs: number = Date.now()
): SignoffGap[] {
  return items
    .filter((item) => item.critical)
    .flatMap((item) => {
      const coverings = coveringsForItem(item, signoffs, nowMs);
      if (coverings.some((entry) => entry.state === 'valid')) return [];
      const stale = coverings.filter((entry) => entry.state === 'stale').map((entry) => entry.signoff.number);
      const expired = coverings.filter((entry) => entry.state === 'expired').map((entry) => entry.signoff.number);
      const failedNumbers = [...stale, ...expired];
      const reason: SignoffGap['reason'] = stale.length ? 'stale' : expired.length ? 'expired' : 'missing';
      const detail =
        reason === 'missing'
          ? `关键项“${item.challenge || '未命名'}”未被任何机务签认单覆盖，需补签。`
          : reason === 'stale'
            ? `“${item.challenge || '未命名'}”内容或前置条件已变化，旧签认 ${stale.join('、')} 对该项失效，需重新补签该单项；其余未动项仍沿用原签认。`
            : `“${item.challenge || '未命名'}”的签认 ${expired.join('、')} 已过截止时间，需重新补签。`;
      return [{ itemId: item.id, challenge: item.challenge || '未命名', reason, failedNumbers, detail }];
    });
}

/** 冻结快照中某项是否有当时有效的签认（截止时间按冻结时刻判定） */
export function validSignoffNumbersForSnapshot(
  item: ChecklistItem,
  signoffs: Signoff[],
  frozenAt: string
): string[] {
  const frozenMs = new Date(frozenAt).getTime();
  return signoffs
    .filter((signoff) => {
      const fingerprint = signoff.covered[item.id];
      if (!fingerprint || fingerprint !== itemFingerprint(item)) return false;
      const deadlineMs = new Date(signoff.deadline).getTime();
      return Number.isNaN(deadlineMs) || deadlineMs >= frozenMs;
    })
    .map((signoff) => signoff.number);
}
/** 当前工作版本中某项的有效签认号（截止时间按当前时刻判定） */
export function validSignoffNumbers(item: ChecklistItem, signoffs: Signoff[], nowMs: number = Date.now()): string[] {
  return coveringsForItem(item, signoffs, nowMs)
    .filter((entry) => entry.state === 'valid')
    .map((entry) => entry.signoff.number);
}

/** 签认单覆盖项中已不存在的检查项 id（删除检查项后清理用） */
export function pruneMissingCovered(signoff: Signoff, itemIds: Set<string>): Signoff {
  const covered: Record<string, string> = {};
  for (const [id, fingerprint] of Object.entries(signoff.covered)) {
    if (itemIds.has(id)) covered[id] = fingerprint;
  }
  return { ...signoff, covered };
}

/** 截止时间展示 */
export function formatDeadline(deadline: string): string {
  const date = new Date(deadline);
  return Number.isNaN(date.getTime()) ? deadline : date.toLocaleString('zh-CN', { hour12: false });
}
