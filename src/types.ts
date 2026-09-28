export type WorkflowStatus = 'draft' | 'review' | 'frozen';
export type IssueLevel = 'error' | 'warning' | 'info';
export type IssueType =
  | 'duplicate'
  | 'missing-response'
  | 'unreachable-precondition'
  | 'stage-order'
  | 'orphan-stage'
  | 'missing-signoff'
  | 'stale-signoff'
  | 'expired-signoff';

/**
 * 机务签认单。一张单可一次覆盖多个关键检查项；每项在登记时记录内容指纹，
 * 之后该检查项内容或前置条件变化，只让本单对该项失效，其余覆盖项沿用。
 */
export interface Signoff {
  id: string;
  /** 签认号（纸质/电子工单号），如 JQ-2026-001 */
  number: string;
  /** 签认人/机务 */
  inspector: string;
  /** 签认截止时间（ISO 字符串），过期后整单失效 */
  deadline: string;
  /** 登记时间 */
  registeredAt: string;
  /** 备注 */
  note: string;
  /** 覆盖项快照：检查项 id -> 登记时内容指纹 */
  covered: Record<string, string>;
}

/** 某个检查项在一张签认单上的覆盖状态 */
export type SignoffState = 'valid' | 'stale' | 'expired';

export interface FlightStage {
  id: string;
  name: string;
  order: number;
  description: string;
}

export interface ChecklistItem {
  id: string;
  stageId: string;
  order: number;
  challenge: string;
  response: string;
  critical: boolean;
  preconditionIds: string[];
  abnormalProcedure: string;
  updatedAt: string;
}

export interface ChecklistRevision {
  id: string;
  revision: number;
  status: WorkflowStatus;
  createdAt: string;
  note: string;
  stages: FlightStage[];
  items: ChecklistItem[];
  /** 冻结快照保留当时的签认关系 */
  signoffs: Signoff[];
}

export interface ChecklistProject {
  id: string;
  name: string;
  aircraft: string;
  revision: number;
  status: WorkflowStatus;
  updatedAt: string;
  reviewNote: string;
  stages: FlightStage[];
  items: ChecklistItem[];
  revisions: ChecklistRevision[];
  /** 复核阶段登记的机务签认单（逐项覆盖） */
  signoffs: Signoff[];
}

export interface WorkspaceState {
  schemaVersion: 1;
  selectedProjectId: string;
  projects: ChecklistProject[];
}

export interface ValidationIssue {
  id: string;
  type: IssueType;
  level: IssueLevel;
  stageId?: string;
  itemId?: string;
  title: string;
  detail: string;
}

export interface VersionOption {
  id: string;
  label: string;
}

export interface DiffEntry {
  type: 'added' | 'removed' | 'changed' | 'stage' | 'signoff';
  key: string;
  stage: string;
  before: string;
  after: string;
  /** 该项在基准/比较版本中被哪些签认单覆盖（保留签认关系） */
  beforeSignoffs?: string[];
  afterSignoffs?: string[];
}
