import { useState } from "react";

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

interface OnboardingStep {
  title: string;
  body: string;
  actionLabel: string;
  optional?: boolean;
  complete: (progress: OnboardingProgress) => boolean;
  onAction: () => void;
}

export function Onboarding({ progress, onOpenForm, onOpenSettings, onDismiss }: OnboardingProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const steps: OnboardingStep[] = [
    {
      title: "Add your first item",
      body: "Start with one real thing you want Cooper to remember.",
      actionLabel: "Open Form",
      complete: (value) => value.hasItem,
      onAction: onOpenForm,
    },
    {
      title: "Set up Ask",
      body: "Add your own Gemini key when you want natural-language help. Form works without it.",
      actionLabel: "Open Settings",
      optional: true,
      complete: (value) => value.hasGeminiKey,
      onAction: onOpenSettings,
    },
    {
      title: "Connect a calendar",
      body: "Optional. Cooper works on its own, and a calendar helps it protect your existing time.",
      actionLabel: "Open Settings",
      optional: true,
      complete: (value) => value.googleConnected,
      onAction: onOpenSettings,
    },
  ];
  const step = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;

  return (
    <section className="getting-started group" aria-labelledby="getting-started-title">
      <div className="getting-started__header">
        <div>
          <p className="group__label">Getting started</p>
          <p className="getting-started__progress" aria-live="polite">
            Step {stepIndex + 1} of {steps.length}
          </p>
        </div>
        <button type="button" className="btn btn--quiet" onClick={onDismiss}>
          Skip tutorial
        </button>
      </div>

      <div
        className="getting-started__track"
        aria-label={`Tutorial progress: step ${stepIndex + 1} of ${steps.length}`}
      >
        {steps.map((item, index) => (
          <span
            className={`getting-started__dot${index === stepIndex ? " getting-started__dot--active" : ""}${
              item.complete(progress) ? " getting-started__dot--complete" : ""
            }`}
            key={item.title}
          />
        ))}
      </div>

      <div className="getting-started__step">
        <div className="getting-started__step-copy">
          {step.optional && <span className="getting-started__optional">Optional</span>}
          {step.complete(progress) && <span className="getting-started__complete">Complete</span>}
          <h2 id="getting-started-title">{step.title}</h2>
          <p>{step.body}</p>
        </div>
        <button type="button" className="btn btn--quiet" onClick={step.onAction}>
          {step.actionLabel}
        </button>
      </div>

      <div className="getting-started__nav">
        <div>
          {stepIndex > 0 && (
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => setStepIndex(stepIndex - 1)}
            >
              Back
            </button>
          )}
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => (isLastStep ? onDismiss() : setStepIndex(stepIndex + 1))}
        >
          {isLastStep ? "Finish and get started" : "Next"}
        </button>
      </div>
    </section>
  );
}
