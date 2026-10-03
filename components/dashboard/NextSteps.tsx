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
        <p className="text-sm text-muted-foreground">Steps appear as you talk things through.</p>
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
      {waiting > 0 && <p className="mt-2 text-xs text-muted-foreground">+{waiting} more waiting</p>}
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
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex gap-2.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAction({ type: "complete_step", actionId: step.id })}
          aria-label={`Mark done: ${step.title}`}
          className="group mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-forest/50 transition-colors hover:border-forest hover:bg-leaf-tint disabled:opacity-50"
        >
          <Check className="size-3 text-forest opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-snug font-medium">{step.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {step.status === "suggested" && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onAction({ type: "adopt_step", actionId: step.id })}
                className="btn btn-active btn-sm"
              >
                Take this on
              </button>
            )}
            {dueDate && <span className="text-dawn">Due {formatIsoDate(dueDate)}</span>}
          </div>

          <details className="group/more mt-1 text-sm">
            <summary className="w-fit cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
              <span className="group-open/more:hidden">More</span>
              <span className="hidden group-open/more:inline">Less</span>
            </summary>
            <div className="mt-2 space-y-2">
              {step.why && <p className="text-muted-foreground">{step.why}</p>}
              {step.how && <p className="text-muted-foreground">{step.how}</p>}

              <div className="flex items-center gap-2">
                <label htmlFor={dueId} className="text-xs font-medium">
                  Due
                </label>
                <input
                  id={dueId}
                  type="date"
                  value={dueDate}
                  disabled={disabled}
                  // Partially typed dates report "" mid-entry; clearing is only via the button below.
                  onChange={(e) => e.target.value && onAction({ type: "set_step_due", actionId: step.id, dueDate: e.target.value })}
                  className="field field-sm w-auto text-muted-foreground"
                  aria-describedby={dueDate ? undefined : `${dueId}-none`}
                />
                {dueDate ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onAction({ type: "set_step_due", actionId: step.id, dueDate: null })}
                    aria-label={`Clear due date ${formatIsoDate(dueDate)}`}
                    className="btn btn-ghost btn-icon size-6"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                ) : (
                  <span id={`${dueId}-none`} className="sr-only">
                    No due date
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1 text-xs">
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
          </details>
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
      className="btn btn-ghost btn-icon"
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
      className="btn btn-ghost btn-sm"
    >
      {children}
    </button>
  );
}
