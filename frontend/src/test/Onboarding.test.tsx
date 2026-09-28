import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { finishOnboarding, Onboarding, onboardingDone } from "../Onboarding";

const progress = {
  hasItem: false,
  hasAsked: false,
  googleConnected: false,
  icloudConnected: false,
};

function renderOnboarding(tab: "home" | "chat" | "settings" = "home") {
  const onOpenForm = vi.fn();
  const onOpenSettings = vi.fn();
  const onDismiss = vi.fn();

  render(
    <Onboarding
      progress={progress}
      tab={tab}
      mode="manual"
      onOpenForm={onOpenForm}
      onOpenAsk={vi.fn()}
      onOpenSettings={onOpenSettings}
      onDismiss={onDismiss}
    />,
  );

  return { onDismiss, onOpenForm, onOpenSettings };
}

describe("Onboarding", () => {
  test("shows the backend pilot timezone without offering a timezone selector", async () => {
    render(
      <Onboarding
        timezone="Asia/Manila"
        progress={progress}
        tab="settings"
        mode="manual"
        onOpenForm={vi.fn()}
        onOpenAsk={vi.fn()}
        onOpenSettings={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/This pilot uses Asia\/Manila/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
  test("starts with one focused first step", () => {
    renderOnboarding();

    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Add your first item" })).toBeInTheDocument();
    expect(screen.queryByText("Getting started")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip tutorial" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  test("moves through the tutorial and finishes", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderOnboarding();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Set availability" })).toBeInTheDocument();
    expect(screen.getByText(/timezone selection is not available yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 3 of 4")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 4 of 4")).toBeInTheDocument();

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
    const { onDismiss } = renderOnboarding();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Optional")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Ask" }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  test("Try Ask targets the composer and completes after an answer", async () => {
    const props = {
      progress,
      tab: "chat" as const,
      mode: "ai" as const,
      onOpenAsk: vi.fn(),
      onOpenForm: vi.fn(),
      onOpenSettings: vi.fn(),
      onDismiss: vi.fn(),
    };
    const { rerender, container } = render(<Onboarding {...props} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Try Ask" })).toBeInTheDocument();
    expect(container.querySelector(".tour")).toHaveAttribute("data-tour-target", "ask-composer");
    expect(screen.queryByText("Complete")).not.toBeInTheDocument();
    rerender(<Onboarding {...props} progress={{ ...progress, hasAsked: true }} />);
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  test("opens the real Form from the first step", async () => {
    const user = userEvent.setup();
    const { onOpenForm } = renderOnboarding();
    await user.click(screen.getByRole("button", { name: "Open Form" }));
    expect(onOpenForm).toHaveBeenCalledTimes(1);
  });

  test("points to the current control as the user moves through the app", async () => {
    const user = userEvent.setup();
    const props = {
      progress,
      mode: "manual" as const,
      onOpenForm: vi.fn(),
      onOpenSettings: vi.fn(),
      onOpenAsk: vi.fn(),
      onDismiss: vi.fn(),
    };
    const { rerender, container } = render(<Onboarding {...props} tab="home" />);
    expect(container.querySelector(".tour")).toHaveAttribute("data-tour-target", "nav-chat");

    rerender(<Onboarding {...props} tab="chat" />);
    expect(container.querySelector(".tour")).toHaveAttribute("data-tour-target", "form-title");

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(container.querySelector(".tour")).toHaveAttribute("data-tour-target", "nav-settings");

    rerender(<Onboarding {...props} tab="settings" />);
    expect(container.querySelector(".tour")).toHaveAttribute("data-tour-target", "availability");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(container.querySelector(".tour")).toHaveAttribute("data-tour-target", "nav-chat");

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(container.querySelector(".tour")).toHaveAttribute(
      "data-tour-target",
      "calendar-connections",
    );
  });

  test("advances when the first item is saved", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Onboarding
        progress={progress}
        tab="chat"
        mode="manual"
        onOpenForm={vi.fn()}
        onOpenAsk={vi.fn()}
        onOpenSettings={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    rerender(
      <Onboarding
        progress={{ ...progress, hasItem: true }}
        tab="chat"
        mode="manual"
        onOpenForm={vi.fn()}
        onOpenAsk={vi.fn()}
        onOpenSettings={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText("Step 2 of 4")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
  });

  test("leaves calendar connection optional on the final step", async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await user.click(screen.getByRole("button", { name: "Next" }));
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
