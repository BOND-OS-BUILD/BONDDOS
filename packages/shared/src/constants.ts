/** Organization-scoped role. Mirrors the Prisma `Role` enum in @bond-os/database. */
export const ROLES = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_HIERARCHY: Record<Role, number> = {
  OWNER: 3,
  ADMIN: 2,
  MEMBER: 1,
};

/** Returns true when `role` grants at least the privilege level of `required`. */
export function roleSatisfies(role: Role, required: Role): boolean {
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[required];
}

export const ROUTES = {
  home: '/',
  login: '/login',
  signup: '/signup',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  dashboard: '/dashboard',
  search: '/search',
  memory: '/memory',
  company: '/company',
  projects: '/projects',
  tasks: '/tasks',
  documents: '/documents',
  meetings: '/meetings',
  customers: '/customers',
  library: '/library',
  libraryFolders: '/library/folders',
  connectors: '/connectors',
  sync: '/sync',
  graph: '/graph',
  graphSearch: '/graph/search',
  graphRelationships: '/graph/relationships',
  graphTimeline: '/graph/timeline',
  ai: '/ai',
  aiModels: '/ai/models',
  aiEmbeddings: '/ai/embeddings',
  aiRetrieval: '/ai/retrieval',
  aiCost: '/ai/cost',
  bond: '/bond',
  executionHistory: '/execution',
  agents: '/agents',
  agentGoals: '/agents/goals',
  agentInsights: '/agents/insights',
  agentDelegation: '/agents/delegation',
  agentDashboard: '/agents/dashboard',
  workflows: '/workflows',
  workflowBuilder: '/workflows/builder',
  workflowRuns: '/workflows/runs',
  workflowApprovals: '/workflows/approvals',
  workflowEvents: '/workflows/events',
  people: '/people',
  integrations: '/integrations',
  settings: '/settings',
  settingsProfile: '/settings/profile',
  settingsOrganization: '/settings/organization',
  settingsMembers: '/settings/members',
  settingsBilling: '/settings/billing',
  settingsApiKeys: '/settings/api-keys',
  settingsPreferences: '/settings/preferences',
} as const;

/** Routes that don't require an authenticated session. */
export const PUBLIC_ROUTES: string[] = [ROUTES.login, ROUTES.signup, ROUTES.forgotPassword, ROUTES.resetPassword];

export const AUTH_COOKIE_PREFIX = 'bondos';
