export type WorkflowStatus = 'draft' | 'review' | 'frozen';
export type IssueLevel = 'error' | 'warning' | 'info';
export type IssueType = 'duplicate' | 'missing-response' | 'unreachable-precondition' | 'stage-order' | 'orphan-stage' | 'missing-signoff';

/** 一条机务签认对单个检查项的覆盖；fingerprint 为登记时该项内容与前置条件的快照。 */
export interface SignoffCoverage {
  itemId: string;
  fingerprint: string;
}

/** 机务签认单：一次可覆盖多个检查项，逐项判定是否仍有效。 */
export interface MaintenanceSignoff {
  id: string;
  /** 签认号 */
  sheetNo: string;
  /** 截止时间（ISO） */
  deadline: string;
  /** 登记时间（ISO） */
  createdAt: string;
  /** 本单覆盖的检查项 */
  coverages: SignoffCoverage[];
}

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
  /** 冻结时刻保留的机务签认关系 */
  signoffs: MaintenanceSignoff[];
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
  /** 机务签认单（含逐项覆盖与登记时快照） */
  signoffs: MaintenanceSignoff[];
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
}
