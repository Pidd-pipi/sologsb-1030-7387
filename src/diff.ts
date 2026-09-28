import { evaluateCoverage, viewAtInstant, type VersionView } from './signoffs';
import type { ChecklistItem, ChecklistProject, ChecklistRevision, DiffEntry, MaintenanceSignoff, VersionOption } from './types';

const itemLabel = (item: ChecklistItem) => `${item.challenge || '未命名'} → ${item.response || '未填写'}`;

export function buildVersionOptions(project: ChecklistProject): VersionOption[] {
  return [
    { id: 'current', label: `当前 r${project.revision} · ${statusLabel(project.status)}` },
    ...project.revisions.map((revision) => ({ id: revision.id, label: `r${revision.revision} · ${statusLabel(revision.status)} · ${new Date(revision.createdAt).toLocaleDateString('zh-CN')}` }))
  ];
}

export function diffVersions(project: ChecklistProject, leftId: string, rightId: string): DiffEntry[] {
  const left = versionProject(project, leftId);
  const right = versionProject(project, rightId);
  if (!left || !right) return [];
  const entries: DiffEntry[] = [];
  const oldItems = new Map(left.items.map((item) => [item.id, item]));
  const newItems = new Map(right.items.map((item) => [item.id, item]));
  const allIds = new Set([...oldItems.keys(), ...newItems.keys()]);
  const leftCoverage = evaluateCoverage(left.items, left.signoffs, viewAtInstant(left));
  const rightCoverage = evaluateCoverage(right.items, right.signoffs, viewAtInstant(right));

  const stageName = (item?: ChecklistItem) => project.stages.find((stage) => stage.id === item?.stageId)?.name ?? '未分配阶段';

  for (const id of allIds) {
    const before = oldItems.get(id);
    const after = newItems.get(id);
    if (!before && after) {
      entries.push({ type: 'added', key: id, stage: stageName(after), before: '—', after: itemLabel(after) });
    } else if (before && !after) {
      entries.push({ type: 'removed', key: id, stage: stageName(before), before: itemLabel(before), after: '—' });
    } else if (before && after && JSON.stringify({ ...before, updatedAt: '' }) !== JSON.stringify({ ...after, updatedAt: '' })) {
      const afterCoverage = rightCoverage.get(id);
      const invalidated = after?.critical && afterCoverage && afterCoverage.state !== 'covered'
        ? afterCoverage.staleSignoffs.map((signoff) => `签认单 ${signoff.sheetNo} 已对该项失效`).join('；')
        : '';
      entries.push({
        type: 'changed',
        key: id,
        stage: stageName(after),
        before: `${itemLabel(before)}${before.critical ? ' [关键]' : ''}`,
        after: `${itemLabel(after)}${after.critical ? ' [关键]' : ''}${invalidated ? `\n${invalidated}` : ''}`
      });
    }
  }

  const oldStageIds = new Set(left.stages.map((stage) => stage.id));
  const newStageIds = new Set(right.stages.map((stage) => stage.id));
  right.stages.filter((stage) => !oldStageIds.has(stage.id)).forEach((stage) => {
    entries.push({ type: 'stage', key: stage.id, stage: stage.name, before: '—', after: `新增阶段：${stage.description || stage.name}` });
  });
  left.stages.filter((stage) => !newStageIds.has(stage.id)).forEach((stage) => {
    entries.push({ type: 'stage', key: stage.id, stage: stage.name, before: `移除阶段：${stage.description || stage.name}`, after: '—' });
  });

  const stageOrderChanged = left.stages.map((stage) => stage.id).join('|') !== right.stages.map((stage) => stage.id).join('|');
  if (stageOrderChanged) {
    entries.unshift({
      type: 'stage',
      key: 'stage-order',
      stage: '阶段排序',
      before: left.stages.sort((a, b) => a.order - b.order).map((stage) => stage.name).join(' → '),
      after: right.stages.sort((a, b) => a.order - b.order).map((stage) => stage.name).join(' → ')
    });
  }

  // 签认关系差异：保留每张单的签认号、截止时间与逐项覆盖，并标注关键项覆盖状态。
  const leftSheets = new Map(left.signoffs.map((signoff) => [signoff.id, signoff]));
  const rightSheets = new Map(right.signoffs.map((signoff) => [signoff.id, signoff]));
  const sheetIds = new Set([...leftSheets.keys(), ...rightSheets.keys()]);
  for (const sheetId of sheetIds) {
    const beforeSheet = leftSheets.get(sheetId);
    const afterSheet = rightSheets.get(sheetId);
    entries.push({
      type: 'signoff',
      key: `signoff-${sheetId}`,
      stage: '机务签认单',
      before: beforeSheet ? formatSheet(beforeSheet, left) : '— 未登记',
      after: afterSheet ? formatSheet(afterSheet, right) : '— 已删除'
    });
  }
  // 关键项的签认覆盖状态变化（有效 → 失效/未覆盖 等）。
  for (const item of right.items.filter((entry) => entry.critical)) {
    const beforeState = leftCoverage.get(item.id)?.state;
    const afterState = rightCoverage.get(item.id)?.state;
    if (beforeState && afterState && beforeState !== afterState) {
      entries.push({
        type: 'signoff',
        key: `signoff-coverage-${item.id}`,
        stage: `签认覆盖 · ${stageName(item)}`,
        before: `${item.challenge}：${coverageStateLabel(beforeState, leftCoverage.get(item.id)!.signoff?.sheetNo)}`,
        after: `${item.challenge}：${coverageStateLabel(afterState, rightCoverage.get(item.id)!.signoff?.sheetNo)}`
      });
    }
  }

  return entries;
}

function formatSheet(signoff: MaintenanceSignoff, view: VersionView): string {
  const items = new Map(view.items.map((item) => [item.id, item]));
  const coverage = evaluateCoverage(view.items, view.signoffs, viewAtInstant(view));
  const lines = signoff.coverages.map((entry) => {
    const item = items.get(entry.itemId);
    const state = coverage.get(entry.itemId);
    const validHere = state?.signoff?.id === signoff.id;
    const flag = item
      ? validHere ? '有效' : state?.staleSignoffs.some((sheet) => sheet.id === signoff.id) ? '该项已失效' : '失效/过期'
      : '检查项已删除';
    return `· [${flag}] ${item?.challenge ?? '已删除检查项'}${item?.critical ? ' (关键)' : ''}`;
  });
  return [`签认号 ${signoff.sheetNo}`, `截止 ${new Date(signoff.deadline).toLocaleString('zh-CN')}`, `登记 ${new Date(signoff.createdAt).toLocaleString('zh-CN')}`, ...lines].join('\n');
}

function coverageStateLabel(state: string, sheetNo?: string): string {
  const base = { covered: '有效签认', stale: '内容变化后该项失效', expired: '签认已过截止', uncovered: '未覆盖' }[state as 'covered' | 'stale' | 'expired' | 'uncovered'] ?? state;
  return sheetNo ? `${base}（${sheetNo}）` : base;
}

export function versionProject(project: ChecklistProject, id: string): VersionView | undefined {
  if (id === 'current') return { stages: project.stages, items: project.items, signoffs: project.signoffs };
  const revision: ChecklistRevision | undefined = project.revisions.find((entry) => entry.id === id);
  return revision ? { stages: revision.stages, items: revision.items, signoffs: revision.signoffs, createdAt: revision.createdAt } : undefined;
}

function statusLabel(status: ChecklistProject['status']): string {
  return { draft: '编辑中', review: '复核中', frozen: '已冻结' }[status];
}
