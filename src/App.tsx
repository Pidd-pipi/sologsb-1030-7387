import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Checkbox,
  Dialog,
  Flex,
  Grid,
  Heading,
  IconButton,
  Progress,
  ScrollArea,
  Select,
  Separator,
  Switch,
  Tabs,
  Text,
  TextArea,
  TextField,
  Theme,
  Tooltip
} from '@radix-ui/themes';
import { buildVersionOptions, diffVersions, versionProject } from './diff';
import { useChecklistStore } from './store';
import {
  coverageReason,
  coverageStateMeta,
  criticalCoverageGaps,
  defaultDeadline,
  evaluateCoverage,
  formatDeadline,
  fromLocalInputValue,
  toLocalInputValue,
  viewAtInstant,
  type CoverageResult
} from './signoffs';
import type { ChecklistItem, ChecklistProject, IssueLevel, MaintenanceSignoff, ValidationIssue, WorkflowStatus } from './types';
import { validateProject } from './validation';

const statusMeta: Record<WorkflowStatus, { label: string; color: 'gray' | 'amber' | 'green'; description: string }> = {
  draft: { label: '编辑中', color: 'gray', description: '内容可修改，完成校验后提交复核。' },
  review: { label: '复核中', color: 'amber', description: '内容已锁定，复核人确认后冻结发布。' },
  frozen: { label: '已冻结', color: 'green', description: '只读发布版本；需要修改时创建新修订。' }
};

const issueMeta: Record<IssueLevel, { color: 'red' | 'amber' | 'blue'; label: string }> = {
  error: { color: 'red', label: '阻断' },
  warning: { color: 'amber', label: '警告' },
  info: { color: 'blue', label: '提示' }
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}

function App() {
  const store = useChecklistStore();
  const project = store.selectedProject;
  const [appearance, setAppearance] = useState<'light' | 'dark'>(() => (localStorage.getItem('sologsb-1030-theme') === 'dark' ? 'dark' : 'light'));
  const [search, setSearch] = useState('');
  const [selectedItemId, setSelectedItemId] = useState(project.items[0]?.id ?? '');
  const [quickStageId, setQuickStageId] = useState(project.stages[0]?.id ?? '');
  const [newChallenge, setNewChallenge] = useState('');
  const [newResponse, setNewResponse] = useState('');
  const [activeTab, setActiveTab] = useState('editor');
  const [showHelp, setShowHelp] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [freezeNote, setFreezeNote] = useState('');
  const [registerOpen, setRegisterOpen] = useState(false);
  const [signoffNo, setSignoffNo] = useState('');
  const [signoffDeadline, setSignoffDeadline] = useState(toLocalInputValue(defaultDeadline()));
  const [signoffItemIds, setSignoffItemIds] = useState<string[]>([]);
  const [leftVersion, setLeftVersion] = useState('current');
  const [rightVersion, setRightVersion] = useState(project.revisions[0]?.id ?? '');
  const [savePulse, setSavePulse] = useState(false);
  const challengeRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const issues = useMemo(() => validateProject(project), [project]);
  const errors = issues.filter((issue) => issue.level === 'error').length;
  const warnings = issues.filter((issue) => issue.level === 'warning').length;
  // 结构类阻断（不含签认闸门）：提交复核只看检查单结构；冻结额外校验签认覆盖。
  const structuralErrors = issues.filter((issue) => issue.level === 'error' && issue.type !== 'missing-signoff').length;
  const coverage = useMemo(() => evaluateCoverage(project.items, project.signoffs), [project.items, project.signoffs]);
  const criticalGaps = useMemo(() => criticalCoverageGaps(project.items, project.signoffs), [project.items, project.signoffs]);
  const criticalItems = useMemo(() => project.items.filter((item) => item.critical), [project.items]);
  const coveredCriticalCount = criticalItems.filter((item) => coverage.get(item.id)?.state === 'covered').length;
  const selectedItem = project.items.find((item) => item.id === selectedItemId);
  const versionOptions = useMemo(() => buildVersionOptions(project), [project]);
  const diffEntries = useMemo(() => diffVersions(project, leftVersion, rightVersion), [project, leftVersion, rightVersion]);
  const filteredStages = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('zh-CN');
    return project.stages
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((stage) => ({
        stage,
        items: project.items
          .filter((item) => item.stageId === stage.id)
          .filter((item) => !query || [stage.name, stage.description, item.challenge, item.response, item.abnormalProcedure].some((value) => value.toLocaleLowerCase('zh-CN').includes(query)))
          .sort((a, b) => a.order - b.order)
      }))
      .filter((group) => !query || group.items.length > 0 || group.stage.name.toLocaleLowerCase('zh-CN').includes(query));
  }, [project, search]);

  useEffect(() => {
    if (!project.items.some((item) => item.id === selectedItemId)) setSelectedItemId(project.items[0]?.id ?? '');
    if (!project.stages.some((stage) => stage.id === quickStageId)) setQuickStageId(project.stages[0]?.id ?? '');
    if (!versionOptions.some((option) => option.id === leftVersion)) setLeftVersion('current');
    if (!versionOptions.some((option) => option.id === rightVersion)) setRightVersion(versionOptions[1]?.id ?? '');
  }, [project.id, project.items, project.stages, project.revision, selectedItemId, quickStageId, versionOptions, leftVersion, rightVersion]);

  useEffect(() => {
    localStorage.setItem('sologsb-1030-theme', appearance);
  }, [appearance]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      const target = event.target as HTMLElement | null;
      const typing = target?.matches('input, textarea, [contenteditable="true"]') ?? false;
      if (modifier && event.key.toLocaleLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? store.redo() : store.undo();
        return;
      }
      if (modifier && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (modifier && event.key.toLocaleLowerCase() === 's') {
        event.preventDefault();
        store.saveNow();
        setSavePulse(true);
        window.setTimeout(() => setSavePulse(false), 1200);
        return;
      }
      if (modifier && event.key === 'Enter') {
        event.preventDefault();
        quickAddItem();
        return;
      }
      if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key) && selectedItemId) {
        event.preventDefault();
        store.nudgeItem(selectedItemId, event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (event.key === '/' && !typing) {
        event.preventDefault();
        challengeRef.current?.focus();
        return;
      }
      if (event.key === '?' && !typing) {
        event.preventDefault();
        setShowHelp(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function quickAddItem() {
    if (!quickStageId || !newChallenge.trim()) return;
    const id = store.addItem(quickStageId, newChallenge.trim(), newResponse.trim());
    setSelectedItemId(id);
    setNewChallenge('');
    setNewResponse('');
    challengeRef.current?.focus();
  }

  function selectIssue(issue: ValidationIssue) {
    if (issue.itemId) setSelectedItemId(issue.itemId);
    setActiveTab('editor');
    if (issue.stageId) setQuickStageId(issue.stageId);
  }

  function exportPrintableHtml() {
    const printCoverage = evaluateCoverage(project.items, project.signoffs);
    const stageOrder = project.stages.slice().sort((a, b) => a.order - b.order);
    const body = stageOrder.map((stage) => {
      const rows = project.items.filter((item) => item.stageId === stage.id).sort((a, b) => a.order - b.order).map((item) => {
        const result = printCoverage.get(item.id);
        const signoffText = !item.critical ? '—' : result?.state === 'covered' && result.signoff
          ? `${escapeHtml(result.signoff.sheetNo)}<br>截止 ${escapeHtml(formatDeadline(result.signoff.deadline))}`
          : `<span style="color:#c00">缺有效签认：${escapeHtml(coverageReason(result!))}</span>`;
        return `<tr${item.critical && result?.state !== 'covered' ? ' style="background:#fff3f3"' : ''}><td>${item.critical ? '<strong>◆</strong> ' : ''}${escapeHtml(item.challenge)}</td><td>${escapeHtml(item.response || '未填写')}</td><td>${escapeHtml(item.abnormalProcedure || '—')}</td><td>${signoffText}</td></tr>`;
      }).join('');
      return `<section><h2>${escapeHtml(stage.name)}</h2><p>${escapeHtml(stage.description)}</p><table><thead><tr><th>挑战语</th><th>预期回应</th><th>异常处置</th><th>机务签认</th></tr></thead><tbody>${rows || '<tr><td colspan="4">本阶段暂无项目</td></tr>'}</tbody></table></section>`;
    }).join('');
    const signoffIndex = project.signoffs.length ? `<section><h2>机务签认单索引</h2><table><thead><tr><th>签认号</th><th>截止时间</th><th>登记时间</th><th>覆盖项（逐项状态）</th></tr></thead><tbody>${project.signoffs.map((signoff) => {
      const covered = signoff.coverages.map((entry) => {
        const target = project.items.find((candidate) => candidate.id === entry.itemId);
        const valid = printCoverage.get(entry.itemId)?.signoff?.id === signoff.id;
        return `${escapeHtml(target?.challenge ?? '已删除检查项')}：${valid ? '有效' : '该项失效/过期'}`;
      }).join('；');
      return `<tr><td><strong>${escapeHtml(signoff.sheetNo)}</strong></td><td>${escapeHtml(formatDeadline(signoff.deadline))}</td><td>${escapeHtml(formatDeadline(signoff.createdAt))}</td><td>${covered}</td></tr>`;
    }).join('')}</tbody></table></section>` : '';
    const documentHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(project.name)}</title><style>
      body{font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111;margin:36px}
      h1{margin:0 0 4px} .meta{color:#666;margin-bottom:28px} h2{border-bottom:2px solid #222;padding-bottom:5px;margin-top:26px}
      table{width:100%;border-collapse:collapse} th,td{border:1px solid #bbb;padding:7px;text-align:left;vertical-align:top} th{background:#eee}
      @media print{body{margin:15mm}section{break-inside:avoid}}
    </style></head><body><h1>${escapeHtml(project.name)}</h1><div class="meta">${escapeHtml(project.aircraft)} · r${project.revision} · ${escapeHtml(statusMeta[project.status].label)} · 导出 ${new Date().toLocaleString('zh-CN')}</div>${body}${signoffIndex}</body></html>`;
    const url = URL.createObjectURL(new Blob([documentHtml], { type: 'text/html;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${project.name.replace(/[^\p{L}\p{N}-]+/gu, '-')}-r${project.revision}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function togglePrecondition(item: ChecklistItem, preconditionId: string) {
    const ids = new Set(item.preconditionIds);
    ids.has(preconditionId) ? ids.delete(preconditionId) : ids.add(preconditionId);
    store.updateItem(item.id, { preconditionIds: [...ids] });
  }

  function openSignoffRegister() {
    // 默认勾选关键项（尤其是尚无有效签认的项），普通项可手动加选但不强制。
    const preset = project.items
      .filter((item) => item.critical && coverage.get(item.id)?.state !== 'covered')
      .map((item) => item.id);
    setSignoffItemIds(preset);
    setSignoffNo('');
    setSignoffDeadline(toLocalInputValue(defaultDeadline()));
    setRegisterOpen(true);
  }

  function toggleSignoffItem(itemId: string, checked: boolean) {
    setSignoffItemIds((ids) => checked ? Array.from(new Set([...ids, itemId])) : ids.filter((id) => id !== itemId));
  }

  function submitSignoff() {
    const deadline = fromLocalInputValue(signoffDeadline);
    if (!signoffNo.trim() || !signoffDeadline || !signoffItemIds.length || Number.isNaN(Date.parse(deadline))) return;
    store.registerSignoff(signoffNo, deadline, signoffItemIds);
    setRegisterOpen(false);
  }

  function duplicateItem(item: ChecklistItem) {
    const id = store.addItem(item.stageId, `${item.challenge} - COPY`, item.response);
    window.setTimeout(() => {
      store.updateItem(id, {
        critical: item.critical,
        preconditionIds: [...item.preconditionIds],
        abnormalProcedure: item.abnormalProcedure
      });
      setSelectedItemId(id);
    }, 0);
  }

  return (
    <Theme appearance={appearance} accentColor="blue" grayColor="slate" radius="large" scaling="100%">
      <div className="app-frame">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">FL</div>
            <div><Heading size="5">Flightline</Heading><Text size="1" color="gray">飞行检查单编写与校验</Text></div>
          </div>
          <div className="project-switcher">
            <Select.Root value={project.id} onValueChange={store.selectProject}>
              <Select.Trigger aria-label="选择检查单项目" variant="soft" />
              <Select.Content position="popper">
                {store.state.projects.map((entry) => <Select.Item key={entry.id} value={entry.id}>{entry.name}</Select.Item>)}
              </Select.Content>
            </Select.Root>
            <Button variant="soft" onClick={store.addProject}>新建项目</Button>
          </div>
          <div className="top-actions">
            <TextField.Root ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索检查项 / Ctrl+K" style={{ minWidth: 220 }}>
              <TextField.Slot>⌕</TextField.Slot>
            </TextField.Root>
            <Tooltip content="撤销 Ctrl/⌘+Z"><Button variant="soft" disabled={!store.canUndo} onClick={store.undo}>撤销</Button></Tooltip>
            <Tooltip content="重做 Shift+Ctrl/⌘+Z"><Button variant="soft" disabled={!store.canRedo} onClick={store.redo}>重做</Button></Tooltip>
            <Tooltip content="手动保存 Ctrl/⌘+S"><Button variant="soft" onClick={() => { store.saveNow(); setSavePulse(true); window.setTimeout(() => setSavePulse(false), 1200); }}>{savePulse ? '已保存' : '保存'}</Button></Tooltip>
            <Tooltip content="切换外观"><IconButton variant="soft" aria-label="切换明暗主题" onClick={() => setAppearance(appearance === 'light' ? 'dark' : 'light')}>{appearance === 'light' ? '◐' : '☀'}</IconButton></Tooltip>
            <Tooltip content="键盘帮助"><IconButton variant="soft" aria-label="键盘帮助" onClick={() => setShowHelp(true)}>?</IconButton></Tooltip>
          </div>
        </header>

        <div className="workflow-bar">
          <div className="workflow-steps">
            {(['draft', 'review', 'frozen'] as WorkflowStatus[]).map((status, index) => (
              <div key={status} className={`workflow-step ${project.status === status ? 'active' : ''} ${status === 'draft' || project.revision > 1 ? 'done' : ''}`}>
                <span>{index + 1}</span><div><strong>{statusMeta[status].label}</strong><small>{statusMeta[status].description}</small></div>
              </div>
            ))}
          </div>
          <Flex gap="2" align="center" wrap="wrap">
            <Badge color={statusMeta[project.status].color} size="2">r{project.revision} · {statusMeta[project.status].label}</Badge>
            <Text size="1" color="gray">{errors ? `${errors} 个阻断` : '无阻断问题'} · {warnings} 个警告</Text>
            {criticalItems.length > 0 && <Badge color={criticalGaps.length ? 'amber' : 'green'} size="2">关键项签认 {coveredCriticalCount}/{criticalItems.length}</Badge>}
            {project.status === 'draft' && <Button color="amber" onClick={store.submitForReview} disabled={structuralErrors > 0}>提交复核</Button>}
            {project.status === 'review' && <Button color="green" onClick={() => setFreezeOpen(true)} disabled={errors > 0}>复核通过并冻结</Button>}
            {project.status === 'frozen' && <Button onClick={store.createRevision}>创建修订 r{project.revision + 1}</Button>}
            <Button variant="soft" onClick={() => setShowPreview(true)}>只读预览</Button>
            <Button variant="soft" onClick={() => window.print()}>打印</Button>
            <Button variant="soft" onClick={exportPrintableHtml}>导出打印版</Button>
          </Flex>
        </div>

        <main className="workspace">
          <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
            <Tabs.List className="main-tabs">
              <Tabs.Trigger value="editor">编辑清单</Tabs.Trigger>
              <Tabs.Trigger value="signoffs">签认覆盖 {criticalGaps.length > 0 && <Badge color="amber" size="1">{criticalGaps.length}</Badge>}</Tabs.Trigger>
              <Tabs.Trigger value="versions">版本差异 <Badge size="1" variant="soft">{project.revisions.length}</Badge></Tabs.Trigger>
              <Tabs.Trigger value="print">打印预览</Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="editor">
              <div className="editor-grid">
                <aside className="stage-sidebar">
                  <Flex justify="between" align="center" mb="3">
                    <Heading size="3">飞行阶段</Heading>
                    <Button size="1" variant="soft" disabled={project.status !== 'draft'} onClick={store.addStage}>＋阶段</Button>
                  </Flex>
                  <ScrollArea type="auto" scrollbars="vertical" style={{ height: 'calc(100vh - 250px)' }}>
                    <div className="stage-nav">
                      {project.stages.slice().sort((a, b) => a.order - b.order).map((stage, index) => {
                        const count = project.items.filter((item) => item.stageId === stage.id).length;
                        const issueCount = issues.filter((issue) => issue.stageId === stage.id).length;
                        return (
                          <button key={stage.id} className={`stage-nav-item ${quickStageId === stage.id ? 'active' : ''}`} onClick={() => setQuickStageId(stage.id)}>
                            <span className="stage-index">{String(index + 1).padStart(2, '0')}</span>
                            <span><strong>{stage.name}</strong><small>{count} 项{issueCount ? ` · ${issueCount} 个问题` : ''}</small></span>
                          </button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                  <Card className="project-card">
                    <Text size="1" color="gray">项目资料</Text>
                    <label><span>检查单名称</span><TextField.Root value={project.name} disabled={project.status !== 'draft'} onChange={(event) => store.updateProject({ name: event.target.value })} /></label>
                    <label><span>机型 / 注册号</span><TextField.Root value={project.aircraft} disabled={project.status !== 'draft'} onChange={(event) => store.updateProject({ aircraft: event.target.value })} /></label>
                  </Card>
                </aside>

                <section className="checklist-main">
                  <div className="list-heading">
                    <div><Heading size="6">{project.name}</Heading><Text color="gray">{project.aircraft} · {project.items.length} 个检查项 · {project.stages.length} 个阶段</Text></div>
                    <Badge color={project.status === 'draft' ? 'gray' : project.status === 'review' ? 'amber' : 'green'}>{statusMeta[project.status].label}</Badge>
                  </div>
                  {project.status !== 'draft' && <Callout.Root color={project.status === 'review' ? 'amber' : 'green'} mb="4"><Callout.Text>{statusMeta[project.status].description} 当前内容不能直接编辑。</Callout.Text></Callout.Root>}

                  <div className="quick-entry">
                    <Select.Root value={quickStageId || undefined} onValueChange={setQuickStageId} disabled={project.status !== 'draft'}>
                      <Select.Trigger variant="soft" aria-label="新检查项所属阶段" />
                      <Select.Content position="popper">{project.stages.map((stage) => <Select.Item key={stage.id} value={stage.id}>{stage.name}</Select.Item>)}</Select.Content>
                    </Select.Root>
                    <TextField.Root ref={challengeRef} value={newChallenge} disabled={project.status !== 'draft'} placeholder="挑战语，如 起飞构型（按 / 聚焦）" onChange={(event) => setNewChallenge(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) quickAddItem(); }} />
                    <TextField.Root value={newResponse} disabled={project.status !== 'draft'} placeholder="预期回应" onChange={(event) => setNewResponse(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) quickAddItem(); }} />
                    <Button disabled={project.status !== 'draft' || !newChallenge.trim()} onClick={quickAddItem}>新增</Button>
                    <Text size="1" color="gray">Ctrl/⌘+Enter</Text>
                  </div>

                  <div className="stage-list">
                    {filteredStages.map(({ stage, items }, stageIndex) => (
                      <Card key={stage.id} className="stage-card">
                        <div className="stage-card-head">
                          <div className="drag-handle" title="阶段排序">⋮⋮</div>
                          <div className="stage-title">
                            <span className="sequence-chip">{stageIndex + 1}</span>
                            <input aria-label={`${stage.name} 阶段名称`} value={stage.name} disabled={project.status !== 'draft'} onChange={(event) => store.updateStage(stage.id, { name: event.target.value })} />
                            <TextField.Root value={stage.description} disabled={project.status !== 'draft'} onChange={(event) => store.updateStage(stage.id, { description: event.target.value })} />
                          </div>
                          <Flex gap="1">
                            <Button size="1" variant="soft" disabled={project.status !== 'draft' || stage.order === 0} onClick={() => store.moveStage(stage.id, -1)}>上移</Button>
                            <Button size="1" variant="soft" disabled={project.status !== 'draft' || stage.order === project.stages.length - 1} onClick={() => store.moveStage(stage.id, 1)}>下移</Button>
                            <Button size="1" color="red" variant="soft" disabled={project.status !== 'draft' || items.length > 0} onClick={() => store.deleteStage(stage.id)}>删除</Button>
                          </Flex>
                        </div>
                        <div className="item-table">
                          {items.map((item) => {
                            const itemIssues = issues.filter((issue) => issue.itemId === item.id);
                            return (
                              <article
                                key={item.id}
                                className={`checklist-row ${selectedItemId === item.id ? 'selected' : ''}`}
                                draggable={project.status === 'draft'}
                                onDragStart={(event) => event.dataTransfer.setData('text/plain', item.id)}
                                onDragOver={(event) => { if (project.status === 'draft') event.preventDefault(); }}
                                onDrop={(event) => { event.preventDefault(); const source = event.dataTransfer.getData('text/plain'); if (source) store.reorderItem(source, item.id, true); }}
                                onClick={() => setSelectedItemId(item.id)}
                              >
                                <span className="drag-handle">⋮⋮</span>
                                <div className="check-item-copy">
                                  <Flex gap="2" align="center" wrap="wrap">
                                    <strong>{item.challenge || '未命名检查项'}</strong>
                                    {item.critical && <Badge color="red" size="1">关键</Badge>}
                                    {item.preconditionIds.length > 0 && <Badge color="blue" size="1">{item.preconditionIds.length} 前置</Badge>}
                                    {itemIssues.length > 0 && <Badge color={itemIssues.some((issue) => issue.level === 'error') ? 'red' : 'amber'} size="1">{itemIssues.length} 问题</Badge>}
                                  </Flex>
                                  <span className={`response-preview ${!item.response ? 'missing' : ''}`}>{item.response || '缺少预期回应'}</span>
                                  {item.abnormalProcedure && <small>异常：{item.abnormalProcedure}</small>}
                                </div>
                                <div className="row-actions">
                                  <Button size="1" variant="ghost" disabled={project.status !== 'draft'} onClick={(event) => { event.stopPropagation(); store.nudgeItem(item.id, -1); }}>↑</Button>
                                  <Button size="1" variant="ghost" disabled={project.status !== 'draft'} onClick={(event) => { event.stopPropagation(); store.nudgeItem(item.id, 1); }}>↓</Button>
                                  <Button size="1" variant="ghost" disabled={project.status !== 'draft'} onClick={(event) => { event.stopPropagation(); duplicateItem(item); }}>复制</Button>
                                  <Button size="1" color="red" variant="ghost" disabled={project.status !== 'draft'} onClick={(event) => { event.stopPropagation(); if (window.confirm(`删除“${item.challenge}”？`)) store.deleteItem(item.id); }}>删除</Button>
                                </div>
                              </article>
                            );
                          })}
                          {!items.length && <button className="empty-row" disabled={project.status !== 'draft'} onClick={() => { setQuickStageId(stage.id); challengeRef.current?.focus(); }}>＋ 为本阶段新增第一个检查项</button>}
                        </div>
                      </Card>
                    ))}
                  </div>
                </section>

                <aside className="inspector">
                  <ScrollArea type="auto" scrollbars="vertical" style={{ height: 'calc(100vh - 200px)' }}>
                    <div className="inspector-inner">
                      <section>
                        <Flex justify="between" align="center" mb="3"><Heading size="4">检查项详情</Heading>{selectedItem && <Badge variant="soft">#{selectedItem.order + 1}</Badge>}</Flex>
                        {selectedItem ? (
                          <div className="inspector-form">
                            <label><span>挑战语</span><TextField.Root value={selectedItem.challenge} disabled={project.status !== 'draft'} onChange={(event) => store.updateItem(selectedItem.id, { challenge: event.target.value })} /></label>
                            <label><span>预期回应</span><TextField.Root value={selectedItem.response} disabled={project.status !== 'draft'} onChange={(event) => store.updateItem(selectedItem.id, { response: event.target.value })} /></label>
                            <Flex justify="between" align="center"><Text size="2" weight="bold">关键标记</Text><Switch checked={selectedItem.critical} disabled={project.status !== 'draft'} onCheckedChange={(checked) => store.updateItem(selectedItem.id, { critical: checked })} /></Flex>
                            {selectedItem.critical && (
                              <div className="inspector-signoff">
                                <Flex justify="between" align="center">
                                  <Text size="2" weight="bold">机务签认</Text>
                                  <Badge color={coverageStateMeta[coverage.get(selectedItem.id)?.state ?? 'uncovered'].color}>{coverageStateMeta[coverage.get(selectedItem.id)?.state ?? 'uncovered'].label}</Badge>
                                </Flex>
                                <Text size="1" color="gray" as="p">
                                  {coverage.get(selectedItem.id)?.state === 'covered'
                                    ? `签认号 ${coverage.get(selectedItem.id)!.signoff!.sheetNo} · 截止 ${formatDeadline(coverage.get(selectedItem.id)!.signoff!.deadline)}`
                                    : coverageReason(coverage.get(selectedItem.id) ?? { itemId: selectedItem.id, state: 'uncovered', staleSignoffs: [], expiredSignoffs: [], inactiveSignoffs: [] })}
                                </Text>
                              </div>
                            )}
                            <label><span>异常处理</span><TextArea value={selectedItem.abnormalProcedure} disabled={project.status !== 'draft'} onChange={(event) => store.updateItem(selectedItem.id, { abnormalProcedure: event.target.value })} placeholder="异常条件、立即动作和后续步骤" /></label>
                            <div>
                              <Text size="2" weight="bold" mb="2" as="p">前置条件</Text>
                              <div className="precondition-list">
                                {project.items.filter((item) => item.id !== selectedItem.id).sort((a, b) => a.order - b.order).map((item) => (
                                  <label key={item.id} className="check-row">
                                    <input type="checkbox" checked={selectedItem.preconditionIds.includes(item.id)} disabled={project.status !== 'draft'} onChange={() => togglePrecondition(selectedItem, item.id)} />
                                    <span>{item.challenge || '未命名'}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                            <Text size="1" color="gray">Alt+↑/↓ 调整顺序 · 拖动左侧把手可跨阶段移动</Text>
                          </div>
                        ) : <Text color="gray">从清单中选择一个检查项进行编辑。</Text>}
                      </section>
                      <Separator size="4" />
                      <section>
                        <Flex justify="between" align="center" mb="2"><Heading size="4">发布校验</Heading><Badge color={errors ? 'red' : warnings ? 'amber' : 'green'}>{errors ? '未通过' : warnings ? '需确认' : '通过'}</Badge></Flex>
                        <Progress value={issues.length ? Math.max(8, 100 - errors * 22 - warnings * 8) : 100} color={errors ? 'red' : warnings ? 'amber' : 'green'} />
                        <div className="issue-list">
                          {issues.length ? issues.map((issue) => (
                            <button key={issue.id} className={`issue-card ${issue.level}`} onClick={() => selectIssue(issue)}>
                              <Badge color={issueMeta[issue.level].color} size="1">{issueMeta[issue.level].label}</Badge>
                              <span><strong>{issue.title}</strong><small>{issue.detail}</small></span>
                            </button>
                          )) : <Callout.Root color="green"><Callout.Text>当前检查单通过全部结构与顺序校验。</Callout.Text></Callout.Root>}
                        </div>
                      </section>
                      <Separator size="4" />
                      <section>
                        <Heading size="4" mb="3">键盘操作</Heading>
                        <div className="shortcut-grid">
                          <span><kbd>/</kbd> 聚焦快速录入</span>
                          <span><kbd>⌘/Ctrl+Enter</kbd> 新增检查项</span>
                          <span><kbd>Alt+↑/↓</kbd> 移动选中项</span>
                          <span><kbd>⌘/Ctrl+Z</kbd> 撤销编辑</span>
                        </div>
                      </section>
                    </div>
                  </ScrollArea>
                </aside>
              </div>
            </Tabs.Content>

            <Tabs.Content value="signoffs">
              <div className="content-page">
                <Flex justify="between" align="start" gap="4" mb="4">
                  <div>
                    <Heading size="7">机务签认覆盖</Heading>
                    <Text color="gray" as="p">一张签认单可覆盖多个关键检查项；某项内容或前置条件变化后，旧签认仅在该项失效，其余覆盖项继续沿用。</Text>
                  </div>
                  <Button color="blue" disabled={project.status === 'frozen'} onClick={openSignoffRegister}>登记签认单</Button>
                </Flex>

                <Card className="signoff-summary" mb="4">
                  <Flex justify="between" align="center" wrap="wrap" gap="3">
                    <Flex gap="4" align="center" wrap="wrap">
                      <Text size="2">关键项有效签认 <strong>{coveredCriticalCount}/{criticalItems.length}</strong></Text>
                      <Text size="2" color="gray">签认单 {project.signoffs.length} 张</Text>
                      <Text size="2" color="gray">普通项不参与冻结前签认闸门</Text>
                    </Flex>
                    <Badge size="2" color={criticalGaps.length ? 'red' : 'green'}>{criticalGaps.length ? `${criticalGaps.length} 项阻断冻结` : '可冻结'}</Badge>
                  </Flex>
                </Card>

                {criticalGaps.length > 0 && (
                  <Callout.Root color="red" mb="4">
                    <Callout.Text>
                      以下关键项缺少有效签认，冻结前必须补齐：
                      <span className="gap-list">
                        {criticalGaps.map(({ item, reason }) => <span key={item.id} className="gap-chip"><strong>{item.challenge}</strong>（{reason}）</span>)}
                      </span>
                    </Callout.Text>
                  </Callout.Root>
                )}

                <Heading size="4" mb="3">关键项覆盖状态</Heading>
                <div className="signoff-matrix">
                  {project.stages.slice().sort((a, b) => a.order - b.order).map((stage) => {
                    const criticals = project.items.filter((item) => item.stageId === stage.id && item.critical).sort((a, b) => a.order - b.order);
                    if (!criticals.length) return null;
                    return (
                      <Card key={stage.id} className="signoff-stage-card">
                        <Heading size="3" mb="3">{stage.name}</Heading>
                        <div className="signoff-rows">
                          {criticals.map((item) => {
                            const result = coverage.get(item.id)!;
                            const meta = coverageStateMeta[result.state];
                            return (
                              <div key={item.id} className="signoff-row">
                                <div className="signoff-row-main">
                                  <strong>{item.challenge}</strong>
                                  <small>{item.response || '缺少预期回应'}</small>
                                  {result.state !== 'covered' && <small className="signoff-reason">{coverageReason(result)}</small>}
                                  {result.state === 'covered' && <small className="signoff-reason ok">签认号 {result.signoff?.sheetNo} · 截止 {formatDeadline(result.signoff!.deadline)}</small>}
                                </div>
                                <Badge color={meta.color}>{meta.label}</Badge>
                              </div>
                            );
                          })}
                        </div>
                      </Card>
                    );
                  })}
                  {!criticalItems.length && <div className="empty-page"><strong>暂无关键检查项</strong><span>在检查项详情中开启“关键标记”后，才需要登记机务签认。</span></div>}
                </div>

                <Heading size="4" mt="6" mb="3">签认单台账</Heading>
                <div className="signoff-ledger">
                  {project.signoffs.length ? project.signoffs.map((signoff) => (
                    <SignoffSheetCard key={signoff.id} signoff={signoff} project={project} coverage={coverage} frozen={project.status === 'frozen'} onDelete={() => store.deleteSignoff(signoff.id)} />
                  )) : <div className="empty-page"><strong>尚未登记签认单</strong><span>复核时点击“登记签认单”，填写签认号、截止时间并勾选覆盖项。</span></div>}
                </div>
              </div>
            </Tabs.Content>

            <Tabs.Content value="versions">
              <div className="content-page">
                <Heading size="7">版本差异</Heading>
                <Text color="gray" as="p">冻结版本不可修改；创建修订后形成新的编辑中版本。</Text>
                <div className="version-controls">
                  <label><span>基准版本</span><Select.Root value={leftVersion} onValueChange={setLeftVersion}><Select.Trigger variant="soft" /><Select.Content position="popper">{versionOptions.map((option) => <Select.Item key={option.id} value={option.id}>{option.label}</Select.Item>)}</Select.Content></Select.Root></label>
                  <span className="version-arrow">→</span>
                  <label><span>比较版本</span><Select.Root value={rightVersion} onValueChange={setRightVersion}><Select.Trigger variant="soft" /><Select.Content position="popper">{versionOptions.map((option) => <Select.Item key={option.id} value={option.id}>{option.label}</Select.Item>)}</Select.Content></Select.Root></label>
                </div>
                <div className="diff-list">
                  {diffEntries.length ? diffEntries.map((entry) => (
                    <Card key={`${entry.type}-${entry.key}`} className="diff-card">
                      <Flex justify="between" align="center"><Badge color={entry.type === 'added' ? 'green' : entry.type === 'removed' ? 'red' : entry.type === 'stage' ? 'blue' : entry.type === 'signoff' ? 'violet' : 'amber'}>{entry.type === 'added' ? '新增' : entry.type === 'removed' ? '删除' : entry.type === 'stage' ? '阶段' : entry.type === 'signoff' ? '签认' : '修改'}</Badge><Text size="1" color="gray">{entry.stage}</Text></Flex>
                      <Grid columns="2" gap="3" mt="3" className="diff-columns">
                        <div className="diff-before"><Text size="1" weight="bold">基准</Text><pre>{entry.before}</pre></div>
                        <div className="diff-after"><Text size="1" weight="bold">比较版本</Text><pre>{entry.after}</pre></div>
                      </Grid>
                    </Card>
                  )) : <div className="empty-page"><strong>两个版本没有差异</strong><span>选择不同版本后可查看新增、删除和修改的检查项。</span></div>}
                </div>
                <VersionSignoffRelations project={project} versionId={leftVersion} title="基准版本签认关系" />
                <VersionSignoffRelations project={project} versionId={rightVersion} title="比较版本签认关系" />
              </div>
            </Tabs.Content>

            <Tabs.Content value="print">
              <div className="content-page">
                <Flex justify="between" align="center" mb="4">
                  <div><Heading size="7">打印预览</Heading><Text color="gray" as="p">{project.name} · r{project.revision} · 只读排版</Text></div>
                  <Flex gap="2"><Button variant="soft" onClick={exportPrintableHtml}>导出 HTML</Button><Button onClick={() => window.print()}>打印 / PDF</Button></Flex>
                </Flex>
                <PrintableChecklist project={project} />
              </div>
            </Tabs.Content>
          </Tabs.Root>
        </main>
      </div>

      <Dialog.Root open={showPreview} onOpenChange={setShowPreview}>
        <Dialog.Content maxWidth="850px" className="preview-dialog">
          <Dialog.Title>只读检查单预览</Dialog.Title>
          <Dialog.Description size="2" color="gray">{project.name} · r{project.revision} · {statusMeta[project.status].label}</Dialog.Description>
          <div className="dialog-scroll"><PrintableChecklist project={project} compact /></div>
          <Flex gap="3" justify="end" mt="4"><Dialog.Close><Button variant="soft">关闭</Button></Dialog.Close><Button onClick={() => window.print()}>打印</Button></Flex>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={freezeOpen} onOpenChange={setFreezeOpen}>
        <Dialog.Content maxWidth="620px">
          <Dialog.Title>冻结 r{project.revision}</Dialog.Title>
          <Dialog.Description size="2" color="gray">冻结后不可直接编辑，只能通过创建新修订继续修改；签认关系随快照一并留存。</Dialog.Description>
          <Box mt="4" className="freeze-signoff">
            <Flex justify="between" align="center" mb="2">
              <Text size="2" weight="bold">关键项签认核对</Text>
              <Badge color={criticalGaps.length ? 'red' : 'green'}>{coveredCriticalCount}/{criticalItems.length} 有效</Badge>
            </Flex>
            <div className="freeze-signoff-list">
              {criticalItems.map((item) => {
                const result = coverage.get(item.id)!;
                const ok = result.state === 'covered';
                return (
                  <div key={item.id} className={`freeze-signoff-row ${ok ? 'ok' : 'bad'}`}>
                    <span>{ok ? '✓' : '✕'} {item.challenge}</span>
                    <Text size="1" color={ok ? 'green' : 'red'}>{ok ? `${result.signoff!.sheetNo} · 截止 ${formatDeadline(result.signoff!.deadline)}` : coverageReason(result)}</Text>
                  </div>
                );
              })}
            </div>
          </Box>
          <TextArea mt="4" value={freezeNote} onChange={(event) => setFreezeNote(event.target.value)} placeholder="复核意见或版本说明" />
          <Flex gap="3" justify="end" mt="4">
            <Dialog.Close><Button variant="soft">取消</Button></Dialog.Close>
            <Button color="green" disabled={criticalGaps.length > 0} title={criticalGaps.length ? '存在未有效签认的关键项' : undefined} onClick={() => { store.freezeRevision(freezeNote); setFreezeOpen(false); setFreezeNote(''); }}>确认冻结</Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={registerOpen} onOpenChange={setRegisterOpen}>
        <Dialog.Content maxWidth="640px">
          <Dialog.Title>登记机务签认单</Dialog.Title>
          <Dialog.Description size="2" color="gray">填写签认号与截止时间，勾选本单覆盖的检查项。系统留存登记时每项的内容与前置条件快照；之后某项变化只使本单在该项失效。</Dialog.Description>
          <Grid columns="2" gap="3" mt="4">
            <label className="dialog-field"><span>签认号</span><TextField.Root value={signoffNo} onChange={(event) => setSignoffNo(event.target.value)} placeholder="如 JW-2026-0928-A" /></label>
            <label className="dialog-field"><span>截止时间</span><TextField.Root type="datetime-local" value={signoffDeadline} onChange={(event) => setSignoffDeadline(event.target.value)} /></label>
          </Grid>
          <Box mt="4">
            <Text size="2" weight="bold" as="p" mb="2">覆盖项（关键项必签，普通项可选）</Text>
            <div className="register-item-list">
              {project.stages.slice().sort((a, b) => a.order - b.order).map((stage) => {
                const stageItems = project.items.filter((item) => item.stageId === stage.id).sort((a, b) => a.order - b.order);
                if (!stageItems.length) return null;
                return (
                  <div key={stage.id}>
                    <Text size="1" color="gray" weight="bold">{stage.name}</Text>
                    {stageItems.map((item) => {
                      const checked = signoffItemIds.includes(item.id);
                      return (
                        <label key={item.id} className="register-item-row">
                          <Checkbox checked={checked} onCheckedChange={(value) => toggleSignoffItem(item.id, value === true)} />
                          <span>{item.challenge || '未命名'}</span>
                          {item.critical && <Badge color="red" size="1">关键</Badge>}
                          {coverage.get(item.id)?.state === 'covered' && <Badge color="green" size="1">已由 {coverage.get(item.id)!.signoff!.sheetNo} 覆盖</Badge>}
                        </label>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </Box>
          <Flex gap="3" justify="end" mt="4">
            <Dialog.Close><Button variant="soft">取消</Button></Dialog.Close>
            <Button color="blue" disabled={!signoffNo.trim() || !signoffDeadline || signoffItemIds.length === 0} onClick={submitSignoff}>登记并覆盖 {signoffItemIds.length} 项</Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={showHelp} onOpenChange={setShowHelp}>
        <Dialog.Content maxWidth="560px">
          <Dialog.Title>键盘快速操作</Dialog.Title>
          <div className="help-list">
            <div><kbd>⌘/Ctrl + K</kbd><span>聚焦全局搜索</span></div>
            <div><kbd>/</kbd><span>聚焦快速录入挑战语</span></div>
            <div><kbd>⌘/Ctrl + Enter</kbd><span>新增检查项</span></div>
            <div><kbd>Alt + ↑ / ↓</kbd><span>移动当前选中检查项</span></div>
            <div><kbd>⌘/Ctrl + Z</kbd><span>撤销最近一次编辑</span></div>
            <div><kbd>⇧ + ⌘/Ctrl + Z</kbd><span>重做编辑</span></div>
            <div><kbd>⌘/Ctrl + S</kbd><span>立即保存到浏览器</span></div>
          </div>
          <Flex justify="end" mt="4"><Dialog.Close><Button>了解了</Button></Dialog.Close></Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Theme>
  );
}

function VersionSignoffRelations({ project, versionId, title }: { project: ChecklistProject; versionId: string; title: string }) {
  const view = versionProject(project, versionId);
  if (!view) return null;
  const instant = viewAtInstant(view);
  const results = evaluateCoverage(view.items, view.signoffs, instant);
  const criticals = view.items.filter((item) => item.critical);
  const gaps = criticals.filter((item) => results.get(item.id)?.state !== 'covered');
  return (
    <Card mt="5" className="version-signoff">
      <Flex justify="between" align="center" mb="3">
        <Heading size="4">{title}</Heading>
        <Badge color={gaps.length ? 'amber' : 'green'}>关键项 {criticals.length - gaps.length}/{criticals.length} 已签认</Badge>
      </Flex>
      {view.signoffs.length === 0 ? (
        <Text size="2" color="gray">该版本未保留签认单（早于签认功能的历史冻结版本）。</Text>
      ) : (
        <div className="signoff-ledger">
          {view.signoffs.map((signoff) => (
            <div key={signoff.id} className="version-signoff-sheet">
              <Flex justify="between" wrap="wrap" gap="2">
                <strong>{signoff.sheetNo}</strong>
                <Text size="1" color="gray">登记 {formatDeadline(signoff.createdAt)} · 截止 {formatDeadline(signoff.deadline)}</Text>
              </Flex>
              <div className="sheet-coverage">
                {signoff.coverages.map((entry) => {
                  const item = view.items.find((candidate) => candidate.id === entry.itemId);
                  const valid = results.get(entry.itemId)?.signoff?.id === signoff.id;
                  return (
                    <div key={entry.itemId} className={`sheet-coverage-row ${valid ? 'ok' : 'bad'}`}>
                      <span>{item ? item.challenge : '（检查项已删除）'}</span>
                      <Text size="1">{valid ? '有效' : '该项失效/过期'}</Text>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SignoffSheetCard({ signoff, project, coverage, frozen, onDelete }: {
  signoff: MaintenanceSignoff;
  project: ChecklistProject;
  coverage: Map<string, CoverageResult>;
  frozen: boolean;
  onDelete: () => void;
}) {
  const expired = Date.parse(signoff.deadline) < Date.now();
  const activeCount = signoff.coverages.filter((entry) => coverage.get(entry.itemId)?.signoff?.id === signoff.id).length;
  const invalidCount = signoff.coverages.length - activeCount;
  return (
    <Card className="signoff-sheet">
      <Flex justify="between" align="start" gap="3">
        <div>
          <Flex gap="2" align="center" wrap="wrap">
            <Heading size="4">{signoff.sheetNo}</Heading>
            {expired ? <Badge color="red">已过截止</Badge> : <Badge color="green">有效</Badge>}
            {invalidCount > 0 && <Badge color="amber">{invalidCount} 项已失效</Badge>}
          </Flex>
          <Text size="1" color="gray" as="p">登记 {formatDeadline(signoff.createdAt)} · 截止 {formatDeadline(signoff.deadline)} · 覆盖 {signoff.coverages.length} 项（{activeCount} 项仍有效）</Text>
        </div>
        {!frozen && <Button size="1" color="red" variant="soft" onClick={() => { if (window.confirm(`删除签认单 ${signoff.sheetNo}？相关关键项将变为未覆盖。`)) onDelete(); }}>删除</Button>}
      </Flex>
      <div className="sheet-coverage">
        {signoff.coverages.map((entry) => {
          const item = project.items.find((candidate) => candidate.id === entry.itemId);
          const stillValid = coverage.get(entry.itemId)?.signoff?.id === signoff.id;
          const itemExpired = !stillValid && expired;
          return (
            <div key={entry.itemId} className={`sheet-coverage-row ${stillValid ? 'ok' : 'bad'}`}>
              <span>{item ? item.challenge : '（检查项已删除）'}{item?.critical ? ' ◆' : ''}</span>
              <Text size="1" color={stillValid ? 'green' : undefined}>
                {stillValid ? '有效' : itemExpired ? '已过截止' : '该项内容/前置条件已变化，此项失效'}
              </Text>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function PrintableChecklist({ project, compact = false }: { project: ChecklistProject; compact?: boolean }) {
  const stages = project.stages.slice().sort((a, b) => a.order - b.order);
  // 签认状态按当前时刻判定；签认关系本身持久化，浏览器重开后仍可核对。
  const coverage = evaluateCoverage(project.items, project.signoffs);
  return (
    <article className={`print-sheet ${compact ? 'compact' : ''}`}>
      <header><div><Heading size="7">{project.name}</Heading><Text color="gray" as="p">{project.aircraft} · r{project.revision} · {statusMeta[project.status].label}</Text></div><Badge color={statusMeta[project.status].color}>{project.items.length} 项</Badge></header>
      {stages.map((stage, index) => (
        <section key={stage.id}>
          <div className="print-stage-title"><span>{String(index + 1).padStart(2, '0')}</span><div><Heading size="5">{stage.name}</Heading><Text color="gray" size="1">{stage.description}</Text></div></div>
          <table>
            <thead><tr><th style={{ width: '30%' }}>挑战语</th><th style={{ width: '20%' }}>预期回应</th><th style={{ width: '30%' }}>异常处理</th><th style={{ width: '20%' }}>机务签认</th></tr></thead>
            <tbody>
              {project.items.filter((item) => item.stageId === stage.id).sort((a, b) => a.order - b.order).map((item) => {
                const result = coverage.get(item.id);
                const signoffText = !item.critical ? '—' : result?.state === 'covered' && result.signoff
                  ? `${result.signoff.sheetNo}\n截止 ${formatDeadline(result.signoff.deadline)}`
                  : `缺有效签认：${coverageReason(result!)}`;
                return (
                  <tr key={item.id} className={item.critical && result?.state !== 'covered' ? 'signoff-missing-row' : ''}>
                    <td>{item.critical && <span className="critical-mark">◆</span>} {item.challenge}</td>
                    <td><strong>{item.response || '未填写'}</strong></td>
                    <td>{item.abnormalProcedure || '—'}</td>
                    <td className="signoff-cell">{signoffText.split('\n').map((line, lineIndex) => <span key={lineIndex}>{line}</span>)}</td>
                  </tr>
                );
              })}
              {!project.items.some((item) => item.stageId === stage.id) && <tr><td colSpan={4}>本阶段暂无检查项</td></tr>}
            </tbody>
          </table>
        </section>
      ))}
      {project.signoffs.length > 0 && (
        <section className="print-signoff-index">
          <div className="print-stage-title"><span>签</span><div><Heading size="5">机务签认单索引</Heading><Text color="gray" size="1">签认关系随冻结快照留存，重开浏览器后仍可核对</Text></div></div>
          <table>
            <thead><tr><th style={{ width: '22%' }}>签认号</th><th style={{ width: '20%' }}>截止时间</th><th style={{ width: '20%' }}>登记时间</th><th>覆盖项（含逐项状态）</th></tr></thead>
            <tbody>
              {project.signoffs.map((signoff) => (
                <tr key={signoff.id}>
                  <td><strong>{signoff.sheetNo}</strong></td>
                  <td>{formatDeadline(signoff.deadline)}</td>
                  <td>{formatDeadline(signoff.createdAt)}</td>
                  <td>
                    {signoff.coverages.map((entry) => {
                      const item = project.items.find((candidate) => candidate.id === entry.itemId);
                      const valid = coverage.get(entry.itemId)?.signoff?.id === signoff.id;
                      return <span key={entry.itemId} className="print-coverage-tag">{item?.challenge ?? '已删除检查项'}：{valid ? '有效' : '该项失效/过期'}</span>;
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </article>
  );
}

export default App;
