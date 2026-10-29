"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { faNumber } from "@/components/share/shareDialog";

interface VersePickerProps {
  lines: string[];
  /** Indices into `lines`, ascending. */
  selected: number[];
  onToggleLine: (index: number) => void;
  onSelectedChange: (next: number[]) => void;
}

/** Step one: tap the mesras to put on the card. */
export default function VersePicker({
  lines,
  selected,
  onToggleLine,
  onSelectedChange,
}: VersePickerProps) {
  const allSelected = lines.length > 0 && selected.length === lines.length;

  return (
    <section className="share-pane share-pane--verses" aria-label="انتخاب مصرع‌ها">
      <div className="share-pane__bar">
        <span className="share-count" aria-live="polite">
          <motion.b key={selected.length} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
            {faNumber.format(selected.length)}
          </motion.b>{" "}
          مصرع انتخاب شده
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="share-link-button"
          onClick={() => onSelectedChange(allSelected ? [] : lines.map((_, index) => index))}
        >
          {allSelected ? "لغو همه" : "انتخاب همه"}
        </Button>
      </div>
      <div className="share-lines">
        {lines.map((line, index) => {
          const isSelected = selected.includes(index);
          return (
            <button
              key={`${index}-${line}`}
              type="button"
              aria-pressed={isSelected}
              className="share-line"
              data-beyt-end={index % 2 === 1 || undefined}
              onClick={() => onToggleLine(index)}
            >
              <span className="share-line__text">{line}</span>
              <span className="share-line__check" aria-hidden="true">
                <AnimatePresence initial={false}>
                  {isSelected && (
                    <motion.span
                      initial={{ scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.4, opacity: 0 }}
                      transition={{ type: "spring", stiffness: 600, damping: 30 }}
                    >
                      <Check />
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
