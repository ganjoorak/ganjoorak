import type { Variants } from "framer-motion";

// RTL: moving forward slides the new step in from the left.
export const stepVariants: Variants = {
  enter: (direction: number) => ({ x: direction * -48, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction * 48, opacity: 0 }),
};

export const stepTransition = { type: "spring", stiffness: 420, damping: 38, mass: 0.9 } as const;

export const barSpring = { type: "spring", stiffness: 520, damping: 38 } as const;

export const fade = {
  initial: { opacity: 0, scale: 0.6 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.6 },
  transition: { duration: 0.16 },
};
