import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type Lenis from "lenis";

import { Landing } from "../landing/LandingPage";

const scroll = vi.hoisted(() => ({
  create: vi.fn<(options: NonNullable<ConstructorParameters<typeof Lenis>[0]>) => void>(),
  move: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("lenis", () => ({
  default: class {
    isScrolling = false;
    prefersReducedMotion = false;
    scrollTo = scroll.move;
    destroy = scroll.destroy;
    constructor(options: NonNullable<ConstructorParameters<typeof Lenis>[0]>) {
      scroll.create(options);
    }
    on() {
      return () => {};
    }
    raf() {}
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("public landing", () => {
  test("shows the value proposition and both account intents", () => {
    render(<Landing busy={false} error={null} onSignIn={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Hi, I’m Cooper." })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Create your account" })[0]).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(screen.getAllByRole("link", { name: "Log in" })).not.toHaveLength(0);
    expect(
      screen.getByRole("heading", { name: "One thought in. A clear day out." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ready for a calmer day?" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Messy thought in. Realistic time out." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Say it naturally" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Busy time stays protected" })).toBeInTheDocument();
    expect(screen.getByText("Private by design")).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) => element?.textContent?.replace(/\s+/g, " ").trim() === "Cooper © 2026",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Legal" })).toBeInTheDocument();
    expect(
      screen.getByText("Cooper is currently in public beta · The app is still under construction"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Landing sections" })).not.toBeInTheDocument();
    expect(document.querySelector("#landing-meet .landing__hero-cooper")).toHaveAttribute(
      "src",
      "/assets/mascot/cooper_landing_hero.webp",
    );
    expect(
      screen.getByRole("img", { name: "Cooper calendar showing protected working hours" }),
    ).toBeInTheDocument();
  });

  test("links each account intent to its dedicated public route", () => {
    const onSignIn = vi.fn();
    render(<Landing busy={false} error={null} onSignIn={onSignIn} />);

    expect(screen.getAllByRole("link", { name: "Log in" })[0]).toHaveAttribute("href", "/login");
    expect(screen.getAllByRole("link", { name: "Create your account" })[0]).toHaveAttribute(
      "href",
      "/signup",
    );
  });

  test("does not render a first-panel scroll cue", () => {
    render(<Landing busy={false} error={null} onSignIn={vi.fn()} />);

    expect(screen.queryByText("Keep going")).not.toBeInTheDocument();
  });

  test("keeps each source label with its own connector and separates the caption from the mascot", () => {
    render(<Landing busy={false} error={null} onSignIn={vi.fn()} />);
    const section = document.getElementById("landing-uses");
    if (!section) throw new Error("Missing sources chapter");
    const notes = section.querySelectorAll(".landing__source-note");
    expect(notes).toHaveLength(4);
    const markerIds = new Set<string>();
    for (const note of notes) {
      expect(note.querySelectorAll("article")).toHaveLength(1);
      const connector = note.querySelector(".landing__source-arrow");
      expect(connector).toHaveAttribute("aria-hidden", "true");
      const marker = connector?.querySelector("marker");
      const markerId = marker?.id;
      if (!markerId) throw new Error("Source connector needs its own marker");
      markerIds.add(markerId);
      expect(connector?.querySelector("path[marker-end]")).toHaveAttribute(
        "marker-end",
        `url(#${markerId})`,
      );
    }
    expect(markerIds.size).toBe(4);
    expect(section.querySelector(".landing__service-connectors")).not.toBeInTheDocument();
    const caption = section.querySelector(".landing__source-caption");
    expect(caption?.querySelector(".landing__hand-note--connected")).toBeInTheDocument();
    expect(caption?.querySelector(".mascot")).toBeInTheDocument();
  });

  test("keeps the product proof before the final account invitation", () => {
    render(<Landing busy={false} error={null} onSignIn={vi.fn()} />);

    const sections = Array.from(document.querySelectorAll(".landing__panel")).map(
      (section) => section.id,
    );

    expect(sections).toEqual([
      "landing-meet",
      "landing-features",
      "landing-uses",
      "landing-proof",
      "landing-plans",
      "landing-start",
    ]);
  });

  test("pairs expandable FAQs with clearly proposed subscription choices", () => {
    render(<Landing busy={false} error={null} onSignIn={vi.fn()} />);

    const section = screen.getByRole("region", { name: "Plans and FAQs" });
    const content = within(section);
    expect(
      content.getByRole("heading", { name: "Frequently asked questions" }),
    ).toBeInTheDocument();
    expect(content.getByRole("heading", { name: "Subscription choices" })).toBeInTheDocument();
    expect(content.getByRole("heading", { name: "Free" })).toBeInTheDocument();
    expect(content.getByRole("heading", { name: "Plus" })).toBeInTheDocument();
    expect(content.getByText(/Proposed plans/)).toBeInTheDocument();
    expect(content.getByRole("link", { name: "Try the public beta" })).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(content.getByRole("button", { name: "Plus is coming soon" })).toBeDisabled();

    const question = content.getByText("Do I need my own AI key?");
    const disclosure = question.closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    fireEvent.click(question);
    expect(disclosure).toHaveAttribute("open");
    expect(content.getByText(/Gemini with Groq fallback/)).toBeVisible();
    fireEvent.click(question);
    expect(disclosure).not.toHaveAttribute("open");
  });

  test("keeps account forms on the dedicated auth pages", () => {
    render(<Landing busy={false} error={null} onSignIn={vi.fn()} />);

    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Create your password")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Register with Google" })).not.toBeInTheDocument();
  });

  test.each([
    [390, 844, "vertical"],
    [900, 600, "horizontal"],
    [1024, 768, "horizontal"],
    [1199, 1000, "horizontal"],
    [1440, 700, "horizontal"],
    [1440, 900, "horizontal"],
    [3840, 2160, "horizontal"],
  ])("uses %s × %s space for %s scrolling", (width, height, orientation) => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query.includes("min-width") && width >= 900,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("matchMedia", matchMedia);
    render(<Landing busy={false} error={null} onSignIn={vi.fn()} />);

    expect(matchMedia).toHaveBeenCalledWith("(min-width: 900px)");
    expect(scroll.create).toHaveBeenCalledWith(expect.objectContaining({ orientation }));
    expect(scroll.create).toHaveBeenCalledWith(
      expect.objectContaining({
        gestureOrientation: orientation === "horizontal" ? "both" : "vertical",
        smoothWheel: true,
        lerp: 0.075,
        autoRaf: false,
        respectReducedMotion: true,
      }),
    );
    expect(scroll.create.mock.calls[0]?.[0].allowNestedScroll).not.toBe(true);
    if (orientation === "vertical") {
      fireEvent.keyDown(screen.getByRole("region", { name: "Cooper overview" }), {
        key: "ArrowRight",
      });
      expect(scroll.move).not.toHaveBeenCalled();
    }
  });

  test("vertical wheels over an overflowing FAQ still drive real horizontal smooth scrolling", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(min-width: 900px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    render(<Landing busy={false} error={null} onSignIn={vi.fn()} />);
    const track = document.querySelector(".landing__track");
    const faq = screen.getByRole("region", { name: "Plans and FAQs" });
    if (!(track instanceof HTMLElement)) throw new Error("Missing landing track");
    Object.defineProperties(track, {
      clientWidth: { value: 1000, configurable: true },
      clientHeight: { value: 600, configurable: true },
      scrollWidth: { value: 6000, configurable: true },
      scrollHeight: { value: 600, configurable: true },
      scrollTo: {
        value: (options: ScrollToOptions) => {
          track.scrollLeft = options.left ?? 0;
        },
        configurable: true,
      },
    });
    Object.defineProperties(faq, {
      clientHeight: { value: 600, configurable: true },
      scrollHeight: { value: 900, configurable: true },
    });
    faq.style.overflowY = "auto";
    const { default: RealLenis } = await vi.importActual<typeof import("lenis")>("lenis");
    const instance = new RealLenis({ ...scroll.create.mock.calls[0]?.[0], autoResize: false });
    try {
      const wheel = new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });
      screen.getByText("Do I need my own AI key?").dispatchEvent(wheel);
      expect(wheel.defaultPrevented).toBe(true);
      expect(instance.targetScroll).toBe(120);
      instance.raf(1000);
      instance.raf(1016);
      expect(track.scrollLeft).toBeGreaterThan(0);
      expect(track.scrollLeft).toBeLessThan(120);
      expect(faq.scrollTop).toBe(0);
      const planWheel = new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });
      screen.getByRole("button", { name: "Plus is coming soon" }).dispatchEvent(planWheel);
      expect(planWheel.defaultPrevented).toBe(true);
      expect(instance.targetScroll).toBe(240);
      const reverseWheel = new WheelEvent("wheel", {
        deltaY: -60,
        bubbles: true,
        cancelable: true,
      });
      screen.getByText("Do I need my own AI key?").dispatchEvent(reverseWheel);
      expect(instance.targetScroll).toBe(180);
    } finally {
      instance.destroy();
    }
  });

  test("groups the FAQs into one native accordion without a default expanded answer", () => {
    render(<Landing busy={false} error={null} onSignIn={vi.fn()} />);
    const disclosures = screen
      .getByRole("region", { name: "Plans and FAQs" })
      .querySelectorAll("details");
    expect(disclosures).toHaveLength(6);
    for (const disclosure of disclosures) {
      expect(disclosure).toHaveAttribute("name", "cooper-faq");
      expect(disclosure).not.toHaveAttribute("open");
    }
    const section = within(screen.getByRole("region", { name: "Plans and FAQs" }));
    fireEvent.click(section.getByText("What does Cooper actually do?"));
    expect(disclosures[0]).toHaveAttribute("open");
    fireEvent.click(section.getByText("Do I need my own AI key?"));
    expect(disclosures[0]).not.toHaveAttribute("open");
    expect(disclosures[3]).toHaveAttribute("open");
  });

  test("switches scrolling only when the window crosses the original width breakpoint", () => {
    let change = () => {};
    const media = {
      matches: true,
      addEventListener: (_name: string, listener: () => void) => {
        change = listener;
      },
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", () => media);
    const page = render(<Landing busy={false} error={null} onSignIn={vi.fn()} />);
    expect(scroll.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ orientation: "horizontal" }),
    );

    media.matches = false;
    act(() => change());
    expect(scroll.destroy).toHaveBeenCalledTimes(1);
    expect(scroll.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ orientation: "vertical", wrapper: window }),
    );
    page.unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith("change", change);
    expect(scroll.destroy).toHaveBeenCalledTimes(2);
  });

  test("keeps horizontal chapter shortcuts off FAQ controls", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    render(<Landing busy={false} error={null} onSignIn={vi.fn()} />);
    fireEvent.keyDown(screen.getByText("Do I need my own AI key?"), { key: "ArrowRight" });
    expect(scroll.move).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("region", { name: "Cooper overview" }), {
      key: "ArrowRight",
    });
    expect(scroll.move).toHaveBeenCalledWith(document.getElementById("landing-features"), {
      immediate: false,
    });
  });
});
