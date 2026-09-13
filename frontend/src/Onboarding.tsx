import { useEffect, useRef, useState } from "react";

import type { Mode } from "./Chat";
import { Mascot } from "./Mascot";
import type { Tab } from "./Nav";

const DONE_PREFIX = "cooper.onboarding.done.v1:";

export interface OnboardingProgress {
  hasItem: boolean;
  hasGeminiKey: boolean;
  googleConnected: boolean;
  icloudConnected: boolean;
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
  tab: Tab;
  mode: Mode;
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

interface TargetBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function Onboarding({
  progress,
  tab,
  mode,
  onOpenForm,
  onOpenSettings,
  onDismiss,
}: OnboardingProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetBox, setTargetBox] = useState<TargetBox | null>(null);
  const [cardPosition, setCardPosition] = useState({
    top: 16,
    left: 16,
    maxHeight: 300,
    transform: "none",
  });
  const cardRef = useRef<HTMLElement>(null);
  const hadItem = useRef(progress.hasItem);
  const steps: OnboardingStep[] = [
    {
      title: "Add your first item",
      body:
        tab === "chat" && mode === "manual"
          ? "Type one real task in What, then save it. Add a duration if you want a calendar block."
          : "Open Form to add one real thing you want Cooper to remember.",
      actionLabel: "Open Form",
      complete: (value) => value.hasItem,
      onAction: onOpenForm,
    },
    {
      title: "Set up Ask",
      body: "Add your Gemini key here if you want to talk to Cooper. Form works without it.",
      actionLabel: "Open Settings",
      optional: true,
      complete: (value) => value.hasGeminiKey,
      onAction: onOpenSettings,
    },
    {
      title: "Connect a calendar",
      body: "Choose Google or iCloud below. Cooper reads existing events; new work stays here.",
      actionLabel: "Open Settings",
      optional: true,
      complete: (value) => value.googleConnected || value.icloudConnected,
      onAction: onOpenSettings,
    },
  ];
  const step = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;
  const targetName =
    stepIndex === 0
      ? tab === "chat" && mode === "manual"
        ? "form-title"
        : "nav-chat"
      : tab === "settings"
        ? stepIndex === 1
          ? "gemini-key"
          : "calendar-connections"
        : "nav-settings";
  const actionVisible = stepIndex === 0 ? tab !== "chat" || mode !== "manual" : tab !== "settings";

  useEffect(() => {
    if (!hadItem.current && progress.hasItem && stepIndex === 0) setStepIndex(1);
    hadItem.current = progress.hasItem;
  }, [progress.hasItem, stepIndex]);

  useEffect(() => {
    const target = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-tour="${targetName}"]`),
    ).find((element) => element.getClientRects().length > 0);
    if (!target) {
      setTargetBox(null);
      setCardPosition({ top: 16, left: 16, maxHeight: window.innerHeight - 32, transform: "none" });
      return;
    }

    if (
      targetName === "form-title" ||
      targetName === "gemini-key" ||
      targetName === "calendar-connections"
    ) {
      target.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }

    function measure() {
      if (!target) return;
      const rect = target.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= window.innerHeight) {
        setTargetBox(null);
        return;
      }
      const padding = 6;
      const top = Math.max(0, rect.top - padding);
      const left = Math.max(0, rect.left - padding);
      setTargetBox({
        top,
        left,
        width: Math.max(0, Math.min(window.innerWidth - left, rect.width + padding * 2)),
        height: Math.max(0, Math.min(window.innerHeight - top, rect.height + padding * 2)),
      });

      const cardWidth = cardRef.current?.offsetWidth || Math.min(360, window.innerWidth - 32);
      const cardHeight = cardRef.current?.offsetHeight || 250;
      const cardLeft = Math.max(16, Math.min(rect.left, window.innerWidth - cardWidth - 16));
      const belowSpace = window.innerHeight - rect.bottom - 34;
      const aboveSpace = rect.top - 34;
      const preferAbove =
        targetName === "calendar-connections" ||
        (targetName === "form-title" && window.innerWidth < 640);
      const placeBelow =
        !preferAbove &&
        (belowSpace >= cardHeight || (aboveSpace < cardHeight && belowSpace >= aboveSpace));
      const space = Math.max(0, placeBelow ? belowSpace : aboveSpace);
      setCardPosition({
        top: placeBelow ? rect.bottom + 18 : rect.top - 18,
        left: cardLeft,
        maxHeight: space,
        transform: placeBelow ? "none" : "translateY(-100%)",
      });
    }

    const frame = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(target);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      observer?.disconnect();
    };
  }, [targetName]);

  return (
    <div className="tour" data-tour-target={targetName}>
      {targetBox && <div className="tour__spotlight" style={targetBox} aria-hidden="true" />}
      <section
        ref={cardRef}
        className="tour__card"
        role="region"
        aria-labelledby="tour-title"
        style={cardPosition}
      >
        <div className="tour__header">
          <Mascot name="cooper_reading" size="xs" decorative />
          <span className="tour__eyebrow">Cooper guide</span>
          <button type="button" className="btn btn--quiet" onClick={onDismiss}>
            Skip tutorial
          </button>
        </div>
        <p className="tour__step" aria-live="polite">
          Step {stepIndex + 1} of {steps.length}
        </p>
        <div className="tour__badges">
          {step.optional && <span className="tour__badge">Optional</span>}
          {step.complete(progress) && (
            <span className="tour__badge tour__badge--complete">Complete</span>
          )}
        </div>
        <h2 id="tour-title">{step.title}</h2>
        <p className="tour__body">{step.body}</p>
        {actionVisible && (
          <button type="button" className="btn btn--accent tour__action" onClick={step.onAction}>
            {step.actionLabel}
          </button>
        )}
        <div className="tour__footer">
          <div
            className="tour__dots"
            aria-label={`Tutorial progress: step ${stepIndex + 1} of ${steps.length}`}
          >
            {steps.map((item, index) => (
              <span
                className={`tour__dot${index === stepIndex ? " tour__dot--active" : ""}${item.complete(progress) ? " tour__dot--complete" : ""}`}
                key={item.title}
              />
            ))}
          </div>
          <div className="tour__actions">
            {stepIndex > 0 && (
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => setStepIndex(stepIndex - 1)}
              >
                Back
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => (isLastStep ? onDismiss() : setStepIndex(stepIndex + 1))}
            >
              {isLastStep ? "Finish and get started" : "Next"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
