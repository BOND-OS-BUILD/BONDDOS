'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Circle, MinusCircle, XCircle } from 'lucide-react';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, Spinner, toast } from '@bond-os/ui';

import { streamExecutionApproval } from '../lib/use-execution-stream';

export interface ApprovalCardStep {
  key: string;
  toolKey: string;
  displayName: string;
  summary: string;
}

export interface ApprovalCardProps {
  planId: string;
  summary: string;
  steps: ApprovalCardStep[];
  requiredRole: string;
  estimatedTimeMs: number;
  rollbackStrategy: string;
  expiresAt: string;
}

/** Terminal once `approved`, `rejected`, or `error` — the card never allows a second Approve/Cancel click past that point (re-approving is also blocked server-side by `ApprovalService`'s atomic status transition, but the UI shouldn't let a click silently no-op). */
type CardStatus = 'pending' | 'approving' | 'approved' | 'rejected' | 'error';

type StepRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

interface StepRunState {
  key: string;
  toolKey: string;
  displayName: string;
  summary: string;
  status: StepRunStatus;
  detail?: string;
}

interface RollbackState {
  status: 'running' | 'succeeded' | 'failed';
  error?: string;
}

function toStepRunStates(steps: ApprovalCardStep[]): StepRunState[] {
  return steps.map((step) => ({ ...step, status: 'pending' }));
}

function StepIcon({ status }: { status: StepRunStatus }) {
  switch (status) {
    case 'pending':
      return <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
    case 'running':
      return <Spinner size="sm" className="shrink-0" />;
    case 'succeeded':
      return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />;
    case 'failed':
      return <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />;
    case 'skipped':
      return <MinusCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/** The live step-by-step status list shown once Approve has been clicked — no existing Stepper/Timeline component in `@bond-os/ui` to reuse, so this is a small local list built from Badge/Spinner + lucide icons. */
function StepStatusList({ steps }: { steps: StepRunState[] }) {
  return (
    <ul className="space-y-2">
      {steps.map((step) => (
        <li key={step.key} className="flex items-start gap-2 text-sm">
          <span className="mt-0.5">
            <StepIcon status={step.status} />
          </span>
          <span className="min-w-0 flex-1">
            <span className={cn(step.status === 'failed' && 'text-destructive')}>{step.displayName}</span>
            {step.detail ? <span className="block text-xs text-muted-foreground">{step.detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * The confirmation surface Mr. Bond's chat shows when it proposes a write
 * (Phase 6, spec: "Mr. Bond wants to: Create Project… [Approve] [Cancel]").
 * Idle: header + bulleted step summaries + Approve/Cancel. Approving: a
 * live per-step status list driven by `streamExecutionApproval`'s SSE
 * events. Terminal (approved/rejected/error): a banner, both buttons
 * disabled, and `router.refresh()` already called so the conversation's
 * persisted outcome message shows up alongside this card.
 */
export function ApprovalCard({
  planId,
  summary,
  steps,
  requiredRole,
  estimatedTimeMs,
  rollbackStrategy,
  expiresAt,
}: ApprovalCardProps) {
  const router = useRouter();
  const [status, setStatus] = React.useState<CardStatus>('pending');
  const [stepStates, setStepStates] = React.useState<StepRunState[]>(() => toStepRunStates(steps));
  const [rollback, setRollback] = React.useState<RollbackState | null>(null);
  const [outcomeMessage, setOutcomeMessage] = React.useState<string | null>(null);
  // A short-lived guard for the Cancel request's own round trip — distinct
  // from `status`, which only reflects settled outcomes (approving is a real
  // in-progress state with its own UI; a plain reject is a single fetch with
  // nothing to render mid-flight, so it doesn't need its own CardStatus).
  const [isRejecting, setIsRejecting] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const disabled = status !== 'pending' || isRejecting;
  const isTerminal = status === 'approved' || status === 'rejected' || status === 'error';

  function updateStep(stepKey: string, patch: Partial<StepRunState>) {
    setStepStates((prev) => prev.map((step) => (step.key === stepKey ? { ...step, ...patch } : step)));
  }

  async function handleApprove() {
    if (disabled) return;
    setStatus('approving');
    setStepStates(toStepRunStates(steps));
    setRollback(null);
    setOutcomeMessage(null);

    const controller = new AbortController();
    abortRef.current = controller;

    await streamExecutionApproval(
      planId,
      {
        onStepStarted: (event) => updateStep(event.step.stepKey, { status: 'running' }),
        onStepSucceeded: (event) =>
          updateStep(event.step.stepKey, { status: 'succeeded', detail: `${event.durationMs}ms` }),
        onStepFailed: (event) => updateStep(event.step.stepKey, { status: 'failed', detail: event.error }),
        onStepSkipped: (event) => updateStep(event.step.stepKey, { status: 'skipped', detail: event.reason }),
        onRollbackStarted: () => setRollback({ status: 'running' }),
        onRollbackSucceeded: () => setRollback({ status: 'succeeded' }),
        onRollbackFailed: (event) => setRollback({ status: 'failed', error: event.error }),
        onExecutionDone: (event) => {
          setStatus('approved');
          setOutcomeMessage(`Done — ${event.summary}`);
          toast.success(`Done — ${event.summary}`);
          router.refresh();
        },
        onExecutionFailed: (event) => {
          setStatus('error');
          setOutcomeMessage(event.error);
          toast.error(event.error);
          router.refresh();
        },
        onError: (message) => {
          setStatus('error');
          setOutcomeMessage(message);
          toast.error(message);
        },
      },
      controller.signal,
    );

    abortRef.current = null;
  }

  async function handleReject() {
    if (disabled) return;
    setIsRejecting(true);

    let response: Response;
    try {
      response = await fetch(`/api/execution/${encodeURIComponent(planId)}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch {
      setIsRejecting(false);
      toast.error('Could not reach the server. Check your connection and try again.');
      return;
    }

    const result = (await response.json().catch(() => null)) as
      | { success: true; data: unknown }
      | { success: false; error: { message: string } }
      | null;

    setIsRejecting(false);

    if (!result) {
      toast.error(`Request failed with status ${response.status}.`);
      return;
    }
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }

    setStatus('rejected');
    toast.success('Cancelled.');
    router.refresh();
  }

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Mr. Bond wants to: {summary}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{requiredRole} approval</Badge>
          <Badge variant="secondary">{rollbackStrategy} rollback</Badge>
          <span className="text-xs text-muted-foreground">~{formatSeconds(estimatedTimeMs)}</span>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        {status === 'pending' ? (
          <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
            {steps.map((step) => (
              <li key={step.key}>{step.summary}</li>
            ))}
          </ul>
        ) : (
          <StepStatusList steps={stepStates} />
        )}

        {rollback ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {rollback.status === 'running' ? <Spinner size="sm" /> : null}
            {rollback.status === 'running' ? 'Rolling back completed steps…' : null}
            {rollback.status === 'succeeded' ? 'Rolled back completed steps.' : null}
            {rollback.status === 'failed' ? `Rollback failed: ${rollback.error}` : null}
          </div>
        ) : null}

        {status === 'approved' ? (
          <div className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{outcomeMessage}</span>
          </div>
        ) : null}

        {status === 'error' ? (
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{outcomeMessage}</span>
          </div>
        ) : null}

        {status === 'rejected' ? (
          <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            <MinusCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Cancelled.</span>
          </div>
        ) : null}

        {!isTerminal ? (
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs text-muted-foreground">
              Expires {new Date(expiresAt).toLocaleTimeString()}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={handleReject}>
                {isRejecting ? <Spinner size="sm" className="mr-2" /> : null}
                Cancel
              </Button>
              <Button type="button" variant="default" size="sm" disabled={disabled} onClick={handleApprove}>
                {status === 'approving' ? <Spinner size="sm" className="mr-2" /> : null}
                {status === 'approving' ? 'Approving…' : 'Approve'}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
