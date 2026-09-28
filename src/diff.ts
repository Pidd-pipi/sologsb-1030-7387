import { validSignoffNumbers, validSignoffNumbersForSnapshot } from './signoff';
import type { ChecklistItem, ChecklistProject, ChecklistRevision, DiffEntry, Signoff, VersionOption } from './types';

const itemLabel = (item: ChecklistItem) => `${item.challenge || '未命名'} → ${item.response || '未填写'}`;

export function buildVersionOptions(project: ChecklistProject): VersionOption[] {
  return [
    { id: 'current', label: `当前 r${project.revision} · ${statusLabel(project.status)}` },
    ...project.revisions.map((revision) => ({ id: revision.id, label: `r${revision.revision} · ${statusLabel(revision.status)} · ${new Date(revision.createdAt).toLocaleDateString('zh-CN')}` }))
  ];
}

interface VersionData {
  stages: ChecklistProject['stages'];
  items: ChecklistItem[];
  signoffs: Signoff[];
  frozenAt?: string;
}

function versionData(project: ChecklistProject, id: string): VersionData | undefined {
  if (id === 'current') return { stages: project.stages, items: project.items, signoffs: project.signoffs ?? [] };
  const revision: ChecklistRevision | undefined = project.revisions.find((entry) => entry.id === id);
  return revision
    ? { stages: revision.stages, items: revision.items, signoffs: revision.signoffs ?? [], frozenAt: revision.createdAt }
    : undefined;
}

/** 某版本内某项当前（快照时刻）有效的签认号 */
function coveringNumbers(item: ChecklistItem, data: VersionData): string[] {
  return data.frozenAt
    ? validSignoffNumbersForSnapshot(item, data.signoffs, data.frozenAt)
    : validSignoffNumbers(item, data.signoffs);
}

const signoffLabel = (signoff: Signoff) =>
  `${signoff.number} · ${signoff.inspector || '未署名'} · 截止 ${new Date(signoff.deadline).toLocaleString('zh-CN', { hour12: false })} · 覆盖 ${Object.keys(signoff.covered).length} 项`;

export function diffVersions(project: ChecklistProject, leftId: string, rightId: string): DiffEntry[] {
  const left = versionData(project, leftId);
  const right = versionData(project, rightId);
  if (!left || !right) return [];
  const entries: DiffEntry[] = [];
  const oldItems = new Map(left.items.map((item) => [item.id, item]));
  const newItems = new Map(right.items.map((item) => [item.id, item]));
  const allIds = new Set([...oldItems.keys(), ...newItems.keys()]);

  for (const id of allIds) {
    const before = oldItems.get(id);
    const after = newItems.get(id);
    const stageName = (item?: ChecklistItem) => project.stages.find((stage) => stage.id === item?.stageId)?.name ?? '未分配阶段';
    if (!before && after) {
      entries.push({ type: 'added', key: id, stage: stageName(after), before: '—', after: itemLabel(after), beforeSignoffs: [], afterSignoffs: coveringNumbers(after, right) });
    } else if (before && !after) {
      entries.push({ type: 'removed', key: id, stage: stageName(before), before: itemLabel(before), after: '—', beforeSignoffs: coveringNumbers(before, left), afterSignoffs: [] });
    } else if (before && after && JSON.stringify({ ...before, updatedAt: '' }) !== JSON.stringify({ ...after, updatedAt: '' })) {
      entries.push({
        type: 'changed',
        key: id,
        stage: stageName(after),
        before: `${itemLabel(before)}${before.critical ? ' [关键]' : ''}`,
        after: `${itemLabel(after)}${after.critical ? ' [关键]' : ''}`,
        beforeSignoffs: before.critical ? coveringNumbers(before, left) : [],
        afterSignoffs: after.critical ? coveringNumbers(after, right) : []
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

  // 签认关系变化：按签认号匹配，登记新单 / 旧单消失 / 覆盖项集合变化均保留在差异中。
  const leftSheets = new Map(left.signoffs.map((signoff) => [signoff.number, signoff]));
  const rightSheets = new Map(right.signoffs.map((signoff) => [signoff.number, signoff]));
  const sheetNumbers = new Set([...leftSheets.keys(), ...rightSheets.keys()]);
  const itemName = (data: VersionData, itemId: string) => data.items.find((item) => item.id === itemId)?.challenge ?? itemId;
  sheetNumbers.forEach((number) => {
    const leftSheet = leftSheets.get(number);
    const rightSheet = rightSheets.get(number);
    if (leftSheet && !rightSheet) {
      entries.push({ type: 'signoff', key: `signoff-${number}`, stage: '机务签认', before: signoffLabel(leftSheet), after: '—' });
    } else if (!leftSheet && rightSheet) {
      entries.push({ type: 'signoff', key: `signoff-${number}`, stage: '机务签认', before: '—', after: signoffLabel(rightSheet) });
    } else if (leftSheet && rightSheet) {
      const leftCovered = Object.keys(leftSheet.covered).sort();
      const rightCovered = Object.keys(rightSheet.covered).sort();
      const addedCovered = rightCovered.filter((id) => !leftCovered.includes(id)).map((id) => itemName(right, id));
      const removedCovered = leftCovered.filter((id) => !rightCovered.includes(id)).map((id) => itemName(left, id));
      if (addedCovered.length || removedCovered.length) {
        entries.push({
          type: 'signoff',
          key: `signoff-${number}`,
          stage: '机务签认',
          before: signoffLabel(leftSheet) + (removedCovered.length ? `\n不再覆盖：${removedCovered.join('、')}` : ''),
          after: signoffLabel(rightSheet) + (addedCovered.length ? `\n新增覆盖：${addedCovered.join('、')}` : '')
        });
      }
    }
  });

  return entries;
}

function statusLabel(status: ChecklistProject['status']): string {
  return { draft: '编辑中', review: '复核中', frozen: '已冻结' }[status];
}
