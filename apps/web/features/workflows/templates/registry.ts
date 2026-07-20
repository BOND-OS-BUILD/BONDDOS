import type { TriggerType } from '@bond-os/database';

import type { WorkflowGraphDefinition } from '../lib/workflow-graph';

/**
 * Built-in Workflow Templates (Phase 8) — organization-agnostic starting
 * points a user instantiates into their own editable `DRAFT`
 * `WorkflowDefinition` via `workflow-template.service.ts`. A template is
 * plain developer-owned data (mirrors `ALL_HANDLERS` in `../registry.ts` and
 * every other fixed catalog in this codebase — Tools, Agents), not a
 * database row, so it never needs an `organizationId`.
 *
 * Every `graph` here is deliberately conservative about what can be wired
 * via `$steps.<key>.output.<path>` (see `dag.ts`'s `resolveStepParams`):
 * that resolver only substitutes a reference when it is the ENTIRE value of
 * a top-level `params` key (never a reference nested inside an array/object
 * value, e.g. inside a `GENERATE_REPORT` section's `content`), and there is
 * no equivalent `$trigger.*` syntax for pulling fields out of the event that
 * started the run — only prior step OUTPUTs are reachable. Two consequences
 * baked into every template below:
 *   1. A `READ_DATA` step's `id` is always a literal `REPLACE_WITH_*`
 *      placeholder, never a reference — there is no "list all X" step type
 *      and no way to thread "the record that triggered this run" into
 *      params, so the org must fill in the concrete id after instantiating
 *      (this is a DRAFT precisely so that editing can happen before
 *      publish).
 *   2. Only references that resolve to the exact type a step validates are
 *      used as a top-level param value (e.g. `NOTIFICATION.subject` <-
 *      `GENERATE_REPORT.output.title`, a string <- a string). A few
 *      templates additionally nest a `$steps...` reference inside a
 *      `GENERATE_REPORT` section's `content` to show the intended
 *      data-shape wiring for a human reviewing/editing the draft, even
 *      though today's shallow `resolveStepParams` won't substitute it at
 *      runtime — harmless (that field is untyped `unknown`) and left as
 *      documentation for the next pass on `dag.ts`.
 */
export interface WorkflowTemplateDefinition {
  /** Stable slug — looked up by `instantiateWorkflowTemplateService`. Never changes once shipped; a template's internals may evolve, its `templateKey` doesn't. */
  templateKey: string;
  name: string;
  description: string;
  triggerType: TriggerType;
  /** `{ type, config }` — `config` is what `event-bus.service.ts`'s `matchesTriggerConfig` actually filters on (`source`/`eventType`); for `SCHEDULED`/`MANUAL` triggers `config` is empty since a `WorkflowSchedule` row (cron + timezone) is attached separately once the user activates the workflow. */
  trigger: Record<string, unknown>;
  graph: WorkflowGraphDefinition;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplateDefinition[] = [
  {
    templateKey: 'weekly-project-report',
    name: 'Weekly Project Report',
    description:
      'Reads a project, assembles a status report, and emails it out on a schedule. After instantiating, set the project id, recipient email, and attach a cron schedule to activate.',
    triggerType: 'SCHEDULED',
    trigger: { type: 'SCHEDULED', config: {} },
    graph: {
      steps: [
        {
          key: 'read_project',
          stepType: 'READ_DATA',
          dependsOn: [],
          params: { entityType: 'project', id: 'REPLACE_WITH_PROJECT_ID' },
        },
        {
          key: 'build_report',
          stepType: 'GENERATE_REPORT',
          dependsOn: ['read_project'],
          params: {
            title: 'Weekly Project Status Report',
            sections: [{ label: 'Project Snapshot', content: '$steps.read_project.output.record' }],
          },
        },
        {
          key: 'notify_report',
          stepType: 'NOTIFICATION',
          dependsOn: ['build_report'],
          params: {
            to: 'REPLACE_WITH_RECIPIENT_EMAIL',
            subject: '$steps.build_report.output.title',
            body: 'The weekly project status report has been generated. Open this workflow run in Bond OS to review the full summary.',
          },
        },
      ],
    },
  },
  {
    templateKey: 'new-employee-onboarding',
    name: 'New Employee Onboarding',
    description:
      'Sends a welcome email, proposes an onboarding checklist task for approval, and notifies the manager once it is ready to review. Triggered manually when a new hire starts.',
    triggerType: 'MANUAL',
    trigger: { type: 'MANUAL', config: {} },
    graph: {
      steps: [
        {
          key: 'welcome_email',
          stepType: 'NOTIFICATION',
          dependsOn: [],
          params: {
            to: 'REPLACE_WITH_NEW_EMPLOYEE_EMAIL',
            subject: 'Welcome to the team!',
            body: 'Welcome aboard! We are excited to have you join us. Your manager and IT will reach out shortly with your first-week schedule and account access.',
          },
        },
        {
          key: 'create_onboarding_task',
          stepType: 'INVOKE_TOOL',
          dependsOn: [],
          params: {
            __toolKey: 'create_task',
            __version: '1',
            title: 'Complete new-hire onboarding checklist',
            description: 'Set up accounts, equipment, and a first-week schedule for the new employee.',
            projectId: 'REPLACE_WITH_ONBOARDING_PROJECT_ID',
            assigneeId: 'REPLACE_WITH_MANAGER_USER_ID',
            status: 'TODO',
            priority: 'HIGH',
          },
        },
        {
          key: 'notify_manager',
          stepType: 'NOTIFICATION',
          dependsOn: ['create_onboarding_task'],
          params: {
            to: 'REPLACE_WITH_MANAGER_EMAIL',
            subject: 'New employee onboarding started',
            body: 'An onboarding checklist task has been proposed and is awaiting your approval. Please review it in Bond OS.',
          },
        },
      ],
    },
  },
  {
    templateKey: 'customer-follow-up-reminder',
    name: 'Customer Follow-Up Reminder',
    description:
      'Waits three days after a customer record changes, then reminds the assigned salesperson to follow up. Set the salesperson email after instantiating.',
    triggerType: 'ENTITY_UPDATED',
    trigger: { type: 'ENTITY_UPDATED', config: { source: 'CUSTOMER' } },
    graph: {
      steps: [
        {
          key: 'wait_before_followup',
          stepType: 'DELAY',
          dependsOn: [],
          params: { durationMs: 259_200_000 }, // 3 days
        },
        {
          key: 'remind_salesperson',
          stepType: 'NOTIFICATION',
          dependsOn: ['wait_before_followup'],
          params: {
            to: 'REPLACE_WITH_SALESPERSON_EMAIL',
            subject: 'Customer follow-up reminder',
            body: 'It has been 3 days since this customer record was last updated. Reach out to check in and keep the relationship moving forward.',
          },
        },
      ],
    },
  },
  {
    templateKey: 'meeting-action-item-generator',
    name: 'Meeting Action Item Generator',
    description:
      'Reads a newly logged meeting, asks the Project Agent to draft action items from it, and emails the draft to the project lead. Set the meeting id and recipient after instantiating.',
    triggerType: 'ENTITY_CREATED',
    trigger: { type: 'ENTITY_CREATED', config: { source: 'MEETING' } },
    graph: {
      steps: [
        {
          key: 'read_meeting',
          stepType: 'READ_DATA',
          dependsOn: [],
          params: { entityType: 'meeting', id: 'REPLACE_WITH_MEETING_ID' },
        },
        {
          key: 'draft_action_items',
          stepType: 'INVOKE_AGENT',
          dependsOn: ['read_meeting'],
          params: {
            agentKey: 'project_agent',
            question:
              'Review the meeting that was just logged and draft a clear list of action items, each with a suggested owner and due date.',
          },
        },
        {
          key: 'notify_action_items',
          stepType: 'NOTIFICATION',
          dependsOn: ['draft_action_items'],
          params: {
            to: 'REPLACE_WITH_PROJECT_LEAD_EMAIL',
            subject: 'Action items drafted from your recent meeting',
            body: '$steps.draft_action_items.output.answer',
          },
        },
      ],
    },
  },
  {
    templateKey: 'document-approval-flow',
    name: 'Document Approval Flow',
    description:
      'Reads a newly uploaded document, asks the Operations Agent to review it, and notifies the approver with the recommendation. Set the document id and approver email after instantiating.',
    triggerType: 'ENTITY_CREATED',
    trigger: { type: 'ENTITY_CREATED', config: { source: 'DOCUMENT' } },
    graph: {
      steps: [
        {
          key: 'read_document',
          stepType: 'READ_DATA',
          dependsOn: [],
          params: { entityType: 'document', id: 'REPLACE_WITH_DOCUMENT_ID' },
        },
        {
          key: 'review_document',
          stepType: 'INVOKE_AGENT',
          dependsOn: ['read_document'],
          params: {
            agentKey: 'operations_agent',
            question:
              'Review the newly uploaded document and recommend whether it should be approved, noting any concerns that should block approval.',
          },
        },
        {
          key: 'notify_approval_outcome',
          stepType: 'NOTIFICATION',
          dependsOn: ['review_document'],
          params: {
            to: 'REPLACE_WITH_APPROVER_EMAIL',
            subject: 'Document review complete',
            body: '$steps.review_document.output.answer',
          },
        },
      ],
    },
  },
];
