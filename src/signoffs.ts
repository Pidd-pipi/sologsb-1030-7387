import type {
  ChecklistItem,
  ChecklistProject,
  MaintenanceSignoff,
  SignoffCoverage
} from './types';

/** 签认覆盖在单个检查项上的状态。 */
export type CoverageState = 'covered' | 'stale' | 'expired' | 'uncovered';

export interface CoverageResult {
  itemId: string;
  state: CoverageState;
  /** 当前对该项有效的签认单（指纹一致且未过截止时间） */
  signoff?: MaintenanceSignoff;
  /** 内容或前置条件已变化、对该项失效的签认单 */
  staleSignoffs: MaintenanceSignoff[];
  /** 已超过截止时间的签认单 */
  expiredSignoffs: MaintenanceSignoff[];
  /** 覆盖了该项但当前不适用的全部签认单（失效/过期） */
  inactiveSignoffs: MaintenanceSignoff[];
}

/**
 * 检查项指纹：仅包含“检查项内容”（挑战语、回应、关键标记、异常处置）与“前置条件”。
 * 顺序、所属阶段变化不影响签认；其中任一字段变化后，旧签认只在该项上失效。
 */
export function itemFingerprint(item: ChecklistItem): string {
  const payload = {
    challenge: item.challenge,
    response: item.response,
    critical: item.critical,
    abnormalProcedure: item.abnormalProcedure,
    preconditionIds: item.preconditionIds.slice().sort()
  };
  return JSON.stringify(payload);
}

export function signoffExpired(signoff: MaintenanceSignoff, at: Date): boolean {
  const deadline = Date.parse(signoff.deadline);
  return Number.isFinite(deadline) && deadline < at.getTime();
}

/** 覆盖记录相对于检查项当前内容是否仍然吻合（内容/前置条件未变化）。 */
export function coverageMatches(coverage: SignoffCoverage, item: ChecklistItem): boolean {
  return coverage.fingerprint === itemFingerprint(item);
}

export function evaluateCoverage(
  items: ChecklistItem[],
  signoffs: MaintenanceSignoff[],
  at: Date = new Date()
): Map<string, CoverageResult> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const results = new Map<string, CoverageResult>();
  items.forEach((item) => results.set(item.id, { itemId: item.id, state: 'uncovered', staleSignoffs: [], expiredSignoffs: [], inactiveSignoffs: [] }));

  for (const signoff of signoffs) {
    for (const coverage of signoff.coverages) {
      const result = results.get(coverage.itemId);
      const item = byId.get(coverage.itemId);
      if (!result || !item) continue;
      if (signoffExpired(signoff, at)) {
        result.expiredSignoffs.push(signoff);
        result.inactiveSignoffs.push(signoff);
        continue;
      }
      if (!coverageMatches(coverage, item)) {
        result.staleSignoffs.push(signoff);
        result.inactiveSignoffs.push(signoff);
        continue;
      }
      // 多张有效单时保留截止时间最晚的一张作为当前签认依据。
      if (!result.signoff || Date.parse(signoff.deadline) > Date.parse(result.signoff.deadline)) {
        result.signoff = signoff;
      }
    }
  }

  for (const result of results.values()) {
    if (result.signoff) result.state = 'covered';
    else if (result.staleSignoffs.length > 0) result.state = 'stale';
    else if (result.expiredSignoffs.length > 0) result.state = 'expired';
    else result.state = 'uncovered';
  }
  return results;
}

export interface CriticalCoverageGap {
  item: ChecklistItem;
  result: CoverageResult;
  /** 未覆盖时给出“缺哪张单”的说明 */
  reason: string;
}

export function criticalCoverageGaps(
  items: ChecklistItem[],
  signoffs: MaintenanceSignoff[],
  at: Date = new Date()
): CriticalCoverageGap[] {
  const results = evaluateCoverage(items, signoffs, at);
  return items
    .filter((item) => item.critical)
    .filter((item) => results.get(item.id)?.state !== 'covered')
    .map((item) => {
      const result = results.get(item.id)!;
      return { item, result, reason: coverageReason(result) };
    });
}

/** 未覆盖/失效项的说明：指出缺哪张单或哪张单已对该项失效。 */
export function coverageReason(result: CoverageResult): string {
  if (result.state === 'stale') {
    return `内容或前置条件已变化，签认单 ${result.staleSignoffs.map((entry) => entry.sheetNo).join('、')} 已对该项失效，需重新补签`;
  }
  if (result.state === 'expired') {
    return `签认单 ${result.expiredSignoffs.map((entry) => entry.sheetNo).join('、')} 已过截止时间，需重新补签`;
  }
  return '缺少覆盖该项的机务签认单（复核时登记签认号、截止时间与覆盖项）';
}

export const coverageStateMeta: Record<CoverageState, { label: string; color: 'green' | 'amber' | 'red' | 'gray' }> = {
  covered: { label: '已签认', color: 'green' },
  stale: { label: '该项已失效', color: 'amber' },
  expired: { label: '已过截止', color: 'red' },
  uncovered: { label: '未覆盖', color: 'gray' }
};

/** 版本视图统一访问当前项目或某个冻结快照。 */
export interface VersionView {
  stages: ChecklistProject['stages'];
  items: ChecklistItem[];
  signoffs: MaintenanceSignoff[];
  /** 冻结快照时间；当前版本缺省为 now。 */
  createdAt?: string;
}

export function viewAtInstant(view: { createdAt?: string }): Date {
  const instant = view.createdAt ? Date.parse(view.createdAt) : NaN;
  return Number.isFinite(instant) ? new Date(instant) : new Date();
}

export function formatDeadline(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** datetime-local 输入框（本地时间，分钟精度）与 ISO 字符串互转。 */
export function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInputValue(value: string): string {
  return new Date(value).toISOString();
}

export function defaultDeadline(): string {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  date.setHours(18, 0, 0, 0);
  return date.toISOString();
}
