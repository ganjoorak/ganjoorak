"use client";

import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FaCheck, FaChevronDown, FaFeatherAlt, FaSearch, FaTimes } from "react-icons/fa";
import { PoetAvatar, SOURCE_LABELS } from "@/components/SearchHits";
import { getDirectoryPoetDisplayName, type DirectoryPoet } from "@/utils/poetDirectory";
import { matchPoets } from "@/utils/searchClient";
import { normalizeSearchText } from "@/utils/searchText";

export const PoetCombobox = memo(function PoetCombobox({
  poets,
  value,
  onChange,
}: {
  poets: DirectoryPoet[];
  value: DirectoryPoet | null;
  onChange: (poet: DirectoryPoet | null) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const listboxId = useId();

  const options = useMemo(
    () => (normalizeSearchText(filter) ? matchPoets(filter, poets, 60) : poets.slice(0, 60)),
    [filter, poets],
  );

  useEffect(() => {
    if (!isOpen) return;
    setFilter("");
    setActiveIndex(0);
    window.setTimeout(() => inputRef.current?.focus(), 20);
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isOpen]);

  useEffect(() => setActiveIndex(0), [filter]);

  useEffect(() => {
    if (!isOpen) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen]);

  const select = (poet: DirectoryPoet | null) => {
    onChange(poet);
    setIsOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (options[activeIndex]) select(options[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div className="search-poet-filter" ref={rootRef}>
      <button
        type="button"
        className={`search-chip search-poet-trigger${value ? " is-active" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        onClick={() => setIsOpen((open) => !open)}
      >
        {value ? (
          <PoetAvatar src={value.imageUrl} name={getDirectoryPoetDisplayName(value)} size={18} />
        ) : (
          <FaFeatherAlt aria-hidden="true" />
        )}
        <span>{value ? getDirectoryPoetDisplayName(value) : "شاعر"}</span>
        <FaChevronDown className="search-poet-trigger-chevron" aria-hidden="true" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="search-poet-popover"
            role="presentation"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <div className="search-poet-search">
              <FaSearch aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="نام شاعر…"
                aria-label="جست‌وجوی شاعر"
                aria-controls={listboxId}
                aria-activedescendant={
                  options[activeIndex] ? `${listboxId}-${options[activeIndex].key}` : undefined
                }
                role="combobox"
                aria-expanded="true"
                autoComplete="off"
              />
            </div>
            <ul className="search-poet-list modern-scrollbar" role="listbox" id={listboxId} ref={listRef}>
              {value && !filter && (
                <li role="option" aria-selected={false} className="search-poet-option" onClick={() => select(null)}>
                  <span className="search-avatar search-avatar-fallback" aria-hidden="true">
                    <FaTimes />
                  </span>
                  <span className="search-poet-option-name">همهٔ شاعران</span>
                </li>
              )}
              {options.map((poet, index) => {
                const isSelected = value?.key === poet.key;
                return (
                  <li
                    key={poet.key}
                    id={`${listboxId}-${poet.key}`}
                    role="option"
                    aria-selected={isSelected}
                    data-index={index}
                    className={`search-poet-option${index === activeIndex ? " is-active" : ""}${
                      isSelected ? " is-selected" : ""
                    }`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => select(poet)}
                  >
                    <PoetAvatar src={poet.imageUrl} name={getDirectoryPoetDisplayName(poet)} size={28} />
                    <span className="search-poet-option-name">
                      {getDirectoryPoetDisplayName(poet)}
                      <small>{SOURCE_LABELS[poet.source]}</small>
                    </span>
                    {isSelected && <FaCheck className="search-poet-option-check" aria-hidden="true" />}
                  </li>
                );
              })}
              {options.length === 0 && <li className="search-poet-empty">شاعری با این نام پیدا نشد.</li>}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
