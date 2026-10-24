"use client";

import { useEffect } from "react";
import { FaStar } from "react-icons/fa";
import "../styles/Updates.css";
import AppPage from "@/components/AppPage";
import AccordionItem from "@/components/AccordionItem";
import { updates, type Update } from "@/data/updates";
import { useUpdateNotification } from "@/hooks/useUpdateNotification";
import { Card } from "@/components/ui/card";

const UpdateBody = ({ update }: { update: Update }) => (
  <div className="update-details">
    <ul className="update-changes">
      {update.changes.map((change, changeIndex) => (
        <li key={changeIndex}>{change}</li>
      ))}
    </ul>
    {update.video && (
      <div className="update-media">
        <video className="update-video" controls preload="metadata">
          <source src={update.video} type="video/mp4" />
          مرورگر شما از ویدیو پشتیبانی نمی‌کند.
        </video>
      </div>
    )}
    {update.image && (
      <div className="update-media">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="update-image" src={update.image} alt={`عکس نسخه ${update.version}`} />
      </div>
    )}
  </div>
);

const Updates = () => {
  const { markAsRead } = useUpdateNotification();
  const [latest, ...older] = updates;

  useEffect(() => {
    markAsRead();
  }, [markAsRead]);

  return (
    <AppPage
      title="بروزرسانی‌ها"
      subtitle="تازه‌های گنجورک، نسخه به نسخه."
      width="narrow"
    >
      {latest && (
        <Card role="article" className="update-latest">
          <header className="update-latest-head">
            <span className="update-badge">
              <FaStar aria-hidden="true" />
              تازه‌ترین
            </span>
            <h2>نسخهٔ {latest.version}</h2>
            <span className="update-date">{latest.date}</span>
          </header>
          <UpdateBody update={latest} />
        </Card>
      )}

      {older.length > 0 && (
        <section className="app-section">
          <h2 className="app-section-title">نسخه‌های قبلی</h2>
          <ul className="app-list app-accordion-list">
            {older.map((update) => (
              <li key={update.version}>
                <AccordionItem
                  title={
                    <span className="update-row-title">
                      <span className="update-version">نسخهٔ {update.version}</span>
                      <span className="update-date">{update.date}</span>
                    </span>
                  }
                  titleTag="span"
                  containerClassName="app-accordion"
                  questionClassName="app-accordion-q"
                  answerClassName="app-accordion-a"
                >
                  <UpdateBody update={update} />
                </AccordionItem>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppPage>
  );
};

export default Updates;
