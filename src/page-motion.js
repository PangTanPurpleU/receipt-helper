// Follow native scrolling without changing layout height or delaying gestures.
export function introFrame(scrollY) {
  const progress = Math.min(1, Math.max(0, scrollY) / 140);
  return {
    scale: 1 - progress * 0.14,
    opacity: 1 - progress * 0.85,
    y: progress === 0 ? 0 : -progress * 10,
  };
}
export function createPageMotion({ intro, overview, list, win = window }) {
  const reduced = win.matchMedia("(prefers-reduced-motion: reduce)"),
    seen = new Set();
  let frame = 0;
  const easing =
    getComputedStyle(intro).getPropertyValue("--ease-out").trim() ||
    "cubic-bezier(.23,1,.32,1)";
  function update() {
    frame = 0;
    if (reduced.matches) {
      intro.style.transform = "none";
      intro.style.opacity = "1";
      return;
    }
    const pose = introFrame(win.scrollY);
    intro.style.transform = `translateY(${pose.y}px) scale(${pose.scale})`;
    intro.style.opacity = String(pose.opacity);
  }
  function queue() {
    if (!frame) frame = win.requestAnimationFrame(update);
  }
  const observer =
    "IntersectionObserver" in win
      ? new win.IntersectionObserver(
          (entries) => {
            let index = 0;
            for (const entry of entries) {
              const node = entry.target,
                id = node.dataset.id;
              if (!node.isConnected || !entry.isIntersecting) continue;
              observer.unobserve(node);
              if (seen.has(id)) continue;
              seen.add(id);
              if (!reduced.matches)
                node.animate(
                  [
                    { opacity: 0.82, transform: "translateY(8px)" },
                    { opacity: 1, transform: "none" },
                  ],
                  { duration: 220, delay: Math.min(index++ * 30, 60), easing },
                );
            }
          },
          { threshold: 0.12 },
        )
      : null;
  function observeReceipts() {
    observer?.disconnect();
    for (const node of list.querySelectorAll("[data-id]")) {
      if (reduced.matches || !observer) seen.add(node.dataset.id);
      else if (!seen.has(node.dataset.id)) observer.observe(node);
    }
  }
  function preference() {
    if (reduced.matches) {
      for (const node of [
        intro,
        overview,
        ...list.querySelectorAll("[data-id]"),
      ])
        for (const animation of node.getAnimations()) animation.cancel();
    }
    update();
    observeReceipts();
  }
  win.addEventListener("scroll", queue, { passive: true });
  win.addEventListener("resize", queue, { passive: true });
  reduced.addEventListener("change", preference);
  update();
  if (!reduced.matches)
    overview.animate(
      [
        { opacity: 0.85, transform: "translateY(6px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 240, easing },
    );
  return {
    observeReceipts,
    dispose() {
      observer?.disconnect();
      if (frame) win.cancelAnimationFrame(frame);
      win.removeEventListener("scroll", queue);
      win.removeEventListener("resize", queue);
      reduced.removeEventListener("change", preference);
    },
  };
}
