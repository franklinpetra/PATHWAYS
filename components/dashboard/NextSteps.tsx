"use client";

import { ArrowDown, ArrowUp, Check, X } from "lucide-react";
import { useState } from "react";
import type { Action } from "@/lib/db/types";
import { formatIsoDate } from "@/lib/client/format";
import type { UserAction } from "@/lib/validation/state-guard";
import { Card } from "./Card";

const MAX_SHOWN = 3;

interface NextStepsProps {
  pathwayId: string;
  /** Visible open steps in display order. Only the first three are shown. */
  steps: Action[];
  busy: boolean;
  onAction: (actions: UserAction[], optimistic?: Action[]) => void;
}

export function NextSteps({ pathwayId, steps, busy, onAction }: NextStepsProps) {
  const shown = steps.slice(0, MAX_SHOWN);
  const waiting = steps.length - shown.length;

  function move(index: number, delta: -1 | 1) {
    const order = [...steps];
    const [step] = order.splice(index, 1);
    order.splice(index + delta, 0, step);
    onAction([{ type: "reorder_steps", pathwayId, actionIds: order.map((s) => s.id) }], order);
  }

  return (
    <Card title="Next steps" id="next-steps-heading">
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing here yet. Steps will appear as you talk things through.
        </p>
      ) : (
        <ol className="divide-y divide-border" aria-busy={busy}>
          {shown.map((step, index) => (
            <StepItem
              key={step.id}
              step={step}
              disabled={busy}
              canMoveUp={index > 0}
              canMoveDown={index < shown.length - 1}
              onMove={(delta) => move(index, delta)}
              onAction={(action) =>
                onAction(
                  [action],
                  action.type === "set_step_due" || action.type === "adopt_step"
                    ? undefined
                    : steps.filter((s) => s.id !== step.id),
                )
              }
            />
          ))}
        </ol>
      )}
      {waiting > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {waiting} more {waiting === 1 ? "step is" : "steps are"} waiting behind these.
        </p>
      )}
    </Card>
  );
}

function StepItem({
  step,
  disabled,
  canMoveUp,
  canMoveDown,
  onMove,
  onAction,
}: {
  step: Action;
  disabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (delta: -1 | 1) => void;
  onAction: (action: UserAction) => void;
}) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const dueDate = step.due_at?.slice(0, 10) ?? "";
  const dueId = `due-${step.id}`;

  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAction({ type: "complete_step", actionId: step.id })}
          aria-label={`Mark done: ${step.title}`}
          className="group mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-primary/50 transition-colors hover:bg-primary/10 disabled:opacity-50"
        >
          <Check className="size-3 text-primary opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
        </button>

        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug">{step.title}</p>
          {step.status === "suggested" && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Suggested ·{" "}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onAction({ type: "adopt_step", actionId: step.id })}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Take this on
              </button>
            </p>
          )}

          {step.why && (
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Why </span>
              {step.why}
            </p>
          )}
          {step.how && (
            <details className="mt-1.5 text-sm">
              <summary className="cursor-pointer font-medium text-primary marker:text-primary/60">How</summary>
              <p className="mt-1 text-muted-foreground">{step.how}</p>
            </details>
          )}

          <div className="mt-2 flex items-center gap-2 text-sm">
            <label htmlFor={dueId} className="font-medium">
              Due
            </label>
            <input
              id={dueId}
              type="date"
              value={dueDate}
              disabled={disabled}
              // Partially typed dates report "" mid-entry; clearing is only via the button below.
              onChange={(e) => e.target.value && onAction({ type: "set_step_due", actionId: step.id, dueDate: e.target.value })}
              className="rounded-md border border-border bg-transparent px-1.5 py-0.5 text-sm text-muted-foreground"
              aria-describedby={dueDate ? undefined : `${dueId}-none`}
            />
            {dueDate ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onAction({ type: "set_step_due", actionId: step.id, dueDate: null })}
                aria-label={`Clear due date ${formatIsoDate(dueDate)}`}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            ) : (
              <span id={`${dueId}-none`} className="sr-only">
                No due date
              </span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1 text-xs">
            <IconButton label={`Move up: ${step.title}`} disabled={disabled || !canMoveUp} onClick={() => onMove(-1)}>
              <ArrowUp className="size-3.5" aria-hidden />
            </IconButton>
            <IconButton label={`Move down: ${step.title}`} disabled={disabled || !canMoveDown} onClick={() => onMove(1)}>
              <ArrowDown className="size-3.5" aria-hidden />
            </IconButton>
            <TextButton disabled={disabled} onClick={() => onAction({ type: "postpone_step", actionId: step.id })}>
              Not now
            </TextButton>
            {confirmingRemove ? (
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">Remove?</span>
                <TextButton disabled={disabled} onClick={() => onAction({ type: "remove_step", actionId: step.id })}>
                  Yes
                </TextButton>
                <TextButton disabled={disabled} onClick={() => setConfirmingRemove(false)}>
                  Keep
                </TextButton>
              </span>
            ) : (
              <TextButton disabled={disabled} onClick={() => setConfirmingRemove(true)}>
                Remove
              </TextButton>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function TextButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
    >
      {children}
    </button>
  );
}
