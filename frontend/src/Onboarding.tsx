import type { ReactNode } from "react";

const DONE_PREFIX = "cooper.onboarding.done.v1:";

export interface OnboardingProgress {
  hasItem: boolean;
  hasGeminiKey: boolean;
  googleConnected: boolean;
}

export function onboardingDone(uid: string): boolean {
  try {
    return localStorage.getItem(`${DONE_PREFIX}${uid}`) === "1";
  } catch {
    return false;
  }
}

export function finishOnboarding(uid: string): void {
  try {
    localStorage.setItem(`${DONE_PREFIX}${uid}`, "1");
  } catch {
    // A blocked store only makes dismissal last for this page session.
  }
}

interface OnboardingProps {
  progress: OnboardingProgress;
  onOpenForm: () => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
}

function ChecklistRow({
  complete,
  title,
  body,
  action,
}: {
  complete: boolean;
  title: string;
  body: string;
  action: ReactNode;
}) {
  return (
    <li className={`getting-started__item${complete ? " getting-started__item--complete" : ""}`}>
      <span className="getting-started__mark" aria-hidden="true">
        {complete ? "Done" : "Next"}
      </span>
      <div className="getting-started__copy">
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
      {!complete && action}
    </li>
  );
}

export function Onboarding({ progress, onOpenForm, onOpenSettings, onDismiss }: OnboardingProps) {
  return (
    <section className="getting-started group" aria-labelledby="getting-started-title">
      <div className="getting-started__header">
        <div>
          <p className="group__label">A small start</p>
          <h2 id="getting-started-title">Let’s make your first day useful</h2>
          <p className="getting-started__intro">
            Form captures the structured version. Ask is the conversation when your Gemini key is
            ready.
          </p>
        </div>
        <button type="button" className="btn btn--quiet" onClick={onDismiss}>
          Dismiss
        </button>
      </div>

      <ol className="getting-started__list">
        <ChecklistRow
          complete={progress.hasItem}
          title="Add your first item"
          body="Give Cooper one real thing to remember."
          action={
            <button type="button" className="btn btn--quiet" onClick={onOpenForm}>
              Open Form
            </button>
          }
        />
        <ChecklistRow
          complete={progress.hasGeminiKey}
          title="Set up Ask"
          body="Optional. Add your own Gemini key in Settings when you want natural language."
          action={
            <button type="button" className="btn btn--quiet" onClick={onOpenSettings}>
              Open Settings
            </button>
          }
        />
        <ChecklistRow
          complete={progress.googleConnected}
          title="Connect Google Calendar"
          body="Optional. Cooper works without it; connected events help it route around meetings."
          action={
            <button type="button" className="btn btn--quiet" onClick={onOpenSettings}>
              Open Settings
            </button>
          }
        />
      </ol>
    </section>
  );
}
