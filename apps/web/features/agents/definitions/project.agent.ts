import { ROLES } from '@bond-os/shared';

import type { ToolName } from '@/features/bond/services/tool-calling.service';

import { BaseAgent } from '../lib/base-agent';
import type { AgentDescriptor } from '../lib/agent-definition';

const SUPPORTED_TOOLS: readonly ToolName[] = ['projects', 'timeline', 'graph', 'search'];

/** Knows: Projects, Tasks, Roadmaps, Milestones, Sprint Planning, Dependencies. See docs/multi-agent.md. */
const descriptor: AgentDescriptor = {
  agentKey: 'project_agent',
  version: '1',
  name: 'project_agent',
  displayName: 'Project Agent',
  description: 'Specialist in projects, tasks, roadmaps, milestones, sprint planning, and dependencies.',
  avatar: 'FolderKanban',
  category: 'PROJECT',
  capabilities: ['project_planning', 'task_tracking', 'dependency_analysis'],
  supportedTools: SUPPORTED_TOOLS,
  supportedKnowledge: ['Projects', 'Tasks', 'Roadmaps', 'Milestones', 'Sprint Planning', 'Dependencies'],
  priority: 50,
  minimumRole: ROLES.MEMBER,
};

export class ProjectAgent extends BaseAgent {
  readonly descriptor = descriptor;
}

export const projectAgent = new ProjectAgent();
