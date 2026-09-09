import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { finishOnboarding, Onboarding, onboardingDone } from "../Onboarding";

const progress = {
  hasItem: false,
  hasGeminiKey: false,
  googleConnected: false,
};

function renderOnboarding() {
  const onOpenForm = vi.fn();
  const onOpenSettings = vi.fn();
  const onDismiss = vi.fn();

  render(
    <Onboarding
      progress={progress}
      onOpenForm={onOpenForm}
      onOpenSettings={onOpenSettings}
      onDismiss={onDismiss}
    />,
  );

  return { onDismiss, onOpenForm, onOpenSettings };
}

describe("Onboarding", () => {
  test("starts with one focused first step", () => {
    renderOnboarding();

    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip tutorial" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  test("moves through the tutorial and finishes", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderOnboarding();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 3 of 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Finish and get started" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test("lets a person skip from the first step", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderOnboarding();

    await user.click(screen.getByRole("button", { name: "Skip tutorial" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test("keeps an optional Ask step skippable", async () => {
    const user = userEvent.setup();
    const { onDismiss, onOpenSettings } = renderOnboarding();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Optional")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Settings" }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  test("leaves calendar connection optional on the final step", async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByRole("heading", { name: "Connect a calendar" })).toBeInTheDocument();
    expect(screen.getByText("Optional")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish and get started" })).toBeInTheDocument();
  });

  test("remembers a completed tutorial for one signed-in person", () => {
    expect(onboardingDone("friend")).toBe(false);

    finishOnboarding("friend");

    expect(onboardingDone("friend")).toBe(true);
    expect(onboardingDone("someone-else")).toBe(false);
  });
});
