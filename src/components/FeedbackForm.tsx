"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { FaBug, FaCheck, FaCommentDots, FaLightbulb } from "react-icons/fa";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";
import { FieldHint, Label } from "@/components/ui/label";
import { AccountError, sendFeedback, type FeedbackKind } from "@/utils/accountApi";
import "@/styles/Feedback.css";

// Same limits as validateFeedback in backend/account.go.
const MIN_MESSAGE = 3;
const MAX_MESSAGE = 4000;
const MAX_CONTACT = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const KINDS: Array<{
  value: FeedbackKind;
  label: string;
  icon: React.ReactNode;
  placeholder: string;
}> = [
  {
    value: "suggestion",
    label: "پیشنهاد",
    icon: <FaLightbulb aria-hidden="true" />,
    placeholder: "چه چیزی گنجورک را برایتان بهتر می‌کند؟",
  },
  {
    value: "bug",
    label: "مشکل",
    icon: <FaBug aria-hidden="true" />,
    placeholder: "چه اتفاقی افتاد و انتظار داشتید چه شود؟",
  },
  {
    value: "other",
    label: "دیگر",
    icon: <FaCommentDots aria-hidden="true" />,
    placeholder: "هر چه می‌خواهید بگویید…",
  },
];

const persianNumber = new Intl.NumberFormat("fa-IR");

type Status = "idle" | "sending" | "sent";

interface FeedbackFormProps {
  /** Called from the success screen's close button. */
  onDone: () => void;
}

const FeedbackForm: React.FC<FeedbackFormProps> = ({ onDone }) => {
  const reduceMotion = useReducedMotion();
  const id = useId();
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const [kind, setKind] = useState<FeedbackKind>("suggestion");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  // Only flag a malformed email once the field is left, not mid-typing.
  const [contactTouched, setContactTouched] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  const trimmedLength = message.trim().length;
  const contactInvalid = contact.trim() !== "" && !EMAIL_PATTERN.test(contact.trim());
  const canSend = trimmedLength >= MIN_MESSAGE && !contactInvalid && status === "idle";
  const showContactError = contactInvalid && contactTouched;
  const placeholder = KINDS.find((option) => option.value === kind)?.placeholder;

  useEffect(() => {
    if (status === "sent") doneRef.current?.focus({ preventScroll: true });
  }, [status]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    setStatus("sending");
    setError("");
    try {
      await sendFeedback({
        kind,
        message: message.trim(),
        contact: contact.trim(),
        page: window.location.pathname,
      });
      setStatus("sent");
    } catch (err) {
      setError(
        err instanceof AccountError ? err.message : "ارسال نشد. دوباره امتحان کنید.",
      );
      setStatus("idle");
    }
  };

  const startOver = () => {
    setMessage("");
    setContact("");
    setContactTouched(false);
    setKind("suggestion");
    setStatus("idle");
    window.requestAnimationFrame(() => messageRef.current?.focus());
  };

  const swap = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -8 },
      };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {status === "sent" ? (
        <motion.div
          key="feedback-sent"
          className="feedback-sent"
          role="status"
          {...swap}
          transition={{ duration: 0.2 }}
        >
          <motion.span
            className="feedback-sent-badge"
            initial={reduceMotion ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 22, delay: 0.05 }}
            aria-hidden="true"
          >
            <FaCheck />
          </motion.span>
          <p className="feedback-sent-title">ممنون! پیامتان رسید.</p>
          <p className="feedback-sent-text">
            هر پیام را می‌خوانیم و برای بهتر کردن گنجورک به کار می‌بریم.
          </p>
          <div className="feedback-sent-actions">
            <Button ref={doneRef} type="button" size="lg" onClick={onDone}>
              بستن
            </Button>
            <Button type="button" size="lg" variant="ghost" onClick={startOver}>
              پیام دیگر
            </Button>
          </div>
        </motion.div>
      ) : (
        <motion.form
          key="feedback-form"
          className="feedback-form"
          onSubmit={handleSubmit}
          noValidate
          {...swap}
          transition={{ duration: 0.2 }}
        >
          <p className="feedback-intro">
            پیشنهادی دارید یا جایی درست کار نمی‌کند؟ برایمان بنویسید.
          </p>

          <div
            className="feedback-kinds"
            role="radiogroup"
            aria-label="نوع بازخورد"
          >
            {KINDS.map((option) => {
              const active = kind === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`feedback-kind${active ? " is-active" : ""}`}
                  onClick={() => setKind(option.value)}
                  disabled={status === "sending"}
                >
                  {active && (
                    <motion.span
                      layoutId={`${id}-kind-pill`}
                      className="feedback-kind-pill"
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { type: "spring", stiffness: 500, damping: 38 }
                      }
                      aria-hidden="true"
                    />
                  )}
                  <span className="feedback-kind-icon">{option.icon}</span>
                  <span className="feedback-kind-label">{option.label}</span>
                </button>
              );
            })}
          </div>

          <Label htmlFor={`${id}-message`}>
            <span className="feedback-label-row">
              متن پیام
              <span
                className={`feedback-count${message.length > MAX_MESSAGE * 0.9 ? " is-near" : ""}`}
                aria-hidden="true"
              >
                {persianNumber.format(message.length)} / {persianNumber.format(MAX_MESSAGE)}
              </span>
            </span>
            <textarea
              ref={messageRef}
              id={`${id}-message`}
              className="feedback-textarea"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={placeholder}
              maxLength={MAX_MESSAGE}
              rows={5}
              required
              disabled={status === "sending"}
            />
          </Label>

          <Label htmlFor={`${id}-contact`}>
            <span>
              ایمیل <span className="feedback-optional">(اختیاری)</span>
            </span>
            <Input
              id={`${id}-contact`}
              type="email"
              inputMode="email"
              autoComplete="email"
              dir="ltr"
              className="text-left"
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              onBlur={() => setContactTouched(true)}
              placeholder="you@example.com"
              maxLength={MAX_CONTACT}
              aria-invalid={showContactError || undefined}
              aria-describedby={`${id}-contact-hint`}
              disabled={status === "sending"}
            />
            <FieldHint
              id={`${id}-contact-hint`}
              className={showContactError ? "text-destructive" : undefined}
            >
              {showContactError
                ? "نشانی ایمیل درست به نظر نمی‌رسد."
                : "اگر می‌خواهید پاسخ بگیرید. اگر وارد حساب شده باشید، نام کاربری‌تان هم همراه پیام می‌رود."}
            </FieldHint>
          </Label>

          {error && <FormError>{error}</FormError>}

          <Button
            type="submit"
            size="lg"
            className="feedback-submit"
            loading={status === "sending"}
            disabled={!canSend && status !== "sending"}
          >
            {status === "sending" ? "در حال ارسال…" : "ارسال بازخورد"}
          </Button>
        </motion.form>
      )}
    </AnimatePresence>
  );
};

export default FeedbackForm;
