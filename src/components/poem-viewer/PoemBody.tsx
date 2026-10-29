"use client";

import type { Ref } from "react";
import { motion } from "framer-motion";
import type { Poem } from "@/types/poem";
import { useSettings } from "@/context/SettingsContext";
import { buildPoemSegments, chunk } from "./poemSegments";

const persianNumberFormatter = new Intl.NumberFormat("fa-IR");

interface PoemBodyProps {
  poem: Poem;
  isModern: boolean;
  /** false renders the final state directly, with no entrance animations. */
  animate: boolean;
  verseClass: (lineIndex: number) => string;
  isPoetPage: boolean;
  /** Leave room for the pinned chip above the title (see usePinnedEyebrow). */
  hasEyebrow: boolean;
  eyebrowSpacerRef?: Ref<HTMLDivElement>;
}

/**
 * Title + verses of a poem. Shared by the live view and the pull-to-next sheet so the sheet is pixel-for-pixel
 * the poem that will land.
 */
export default function PoemBody({
  poem,
  isModern,
  animate,
  verseClass,
  isPoetPage,
  hasEyebrow,
  eyebrowSpacerRef,
}: PoemBodyProps) {
  const { settings } = useSettings();
  const { showLineNumbers } = settings;
  const { titleSection: showTitleSection, titleBreadcrumbs: showTitleBreadcrumbs } =
    settings.poemViewerVisibility;

  const titleParts = poem.fullTitle
    ? poem.fullTitle.split(" » ").filter((part) => part.trim())
    : [];
  const intermediateParts =
    titleParts.length > 2 ? titleParts.slice(1, -1) : [];
  const allLines = poem.plainText.split("\n");
  const filledLines = allLines.filter((line) => line.trim());
  const segments = isModern
    ? null
    : buildPoemSegments(filledLines, poem.lineKinds);
  const from = <T,>(value: T): T | false => (animate ? value : false);
  const pairClassName = `verse-pair ${showLineNumbers ? "verse-pair-numbered" : ""}`;
  const coupletNumber = (pairIndex: number) =>
    showLineNumbers ? persianNumberFormatter.format(pairIndex + 1) : undefined;

  return (
    <>
      {/* Title scrolls with the poem: visible only at the very top. */}
      {showTitleSection && (
        <motion.div className="title-section">
          {hasEyebrow && (
            // The chip itself is the pinned layer (see usePinnedEyebrow); here, and in the pull sheet, only its room.
            <div
              className="poem-eyebrow poem-eyebrow--spacer"
              ref={eyebrowSpacerRef}
              aria-hidden="true"
            />
          )}
          <motion.h2
            className="poem-title"
            initial={from({ opacity: 0, y: -20 })}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            style={{
              fontSize:
                "clamp(1.45rem, var(--poem-title-font-size, 2.25rem), 3.1rem)",
              lineHeight: 1.18,
              maxWidth: "100%",
              marginInline: "auto",
            }}
          >
            {poem.title}
          </motion.h2>
          {!isPoetPage && (
            <motion.div
              className="poet-line"
              initial={from({ opacity: 0, y: -10 })}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              style={{
                fontSize: "clamp(0.85rem, 2.4vw, 1rem)",
                lineHeight: 1.45,
                maxWidth: "100%",
              }}
            >
              <span className="poet-name">
                {poem.poet}
                {showTitleBreadcrumbs && intermediateParts.length > 0 && (
                  <span>{"، " + intermediateParts.join("، ")}</span>
                )}
              </span>
            </motion.div>
          )}
        </motion.div>
      )}
      {isModern ? (
        <motion.div
          className="modern-poem"
          initial={from({ opacity: 0, y: 20 })}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {allLines.map((line, index) => (
            <div key={index} className={verseClass(index)}>
              {showLineNumbers && (
                <span className="verse-number">{index + 1}</span>
              )}
              <span className="verse-text">{line}</span>
            </div>
          ))}
        </motion.div>
      ) : segments ? (
        segments.map((segment, segmentIndex) => {
          const entrance = {
            initial: from({ opacity: 0, y: 20 }),
            animate: { opacity: 1, y: 0 },
            transition: {
              duration: 0.3,
              delay: Math.min(segmentIndex, 6) * 0.1,
            },
          };
          return segment.type === "prose" ? (
            <motion.div key={`p-${segment.index}`} className="prose-block" {...entrance}>
              <p className={`${verseClass(segment.index)} prose-paragraph`}>
                <span className="verse-text">{segment.line}</span>
              </p>
            </motion.div>
          ) : segment.type === "centered" ? (
            <motion.div key={`c-${segment.index}`} className="verse-centered" {...entrance}>
              <div className={verseClass(segment.index)}>
                <span className="verse-text">{segment.line}</span>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={`v-${segment.lines[0].index}`}
              className={pairClassName}
              data-couplet-number={coupletNumber(segment.pairIndex)}
              {...entrance}
            >
              {segment.lines.map(({ line, index }) => (
                <div key={index} className={verseClass(index)}>
                  <span className="verse-text">{line}</span>
                </div>
              ))}
            </motion.div>
          );
        })
      ) : (
        chunk(filledLines, 2).map((pair, index) => (
          <motion.div
            key={index}
            className={pairClassName}
            data-couplet-number={coupletNumber(index)}
            initial={from({ opacity: 0, y: 20 })}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.1 }}
          >
            {pair.map((line, lineIndex) => (
              <div
                key={lineIndex}
                className={verseClass(index * 2 + lineIndex)}
              >
                <span className="verse-text">{line}</span>
              </div>
            ))}
          </motion.div>
        ))
      )}
    </>
  );
}
