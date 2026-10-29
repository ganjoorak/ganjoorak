"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FaBookOpen, FaChevronLeft, FaRegStar, FaSlidersH, FaUserPlus } from "react-icons/fa";
import AppPage from "@/components/AppPage";
import { Button, buttonVariants } from "@/components/ui/button";
import { usePreferredPoetKeys } from "@/hooks/usePreferredPoet";
import { useSettings } from "@/context/SettingsContext";
import {
  findDirectoryPoet,
  getDirectoryPoetDisplayName,
  loadPoetDirectory,
  subscribePoetDirectory,
} from "@/utils/poetDirectory";
import "../styles/PoemLibrary.css";
import { Empty, EmptyDescription, EmptyIcon } from "@/components/ui/empty";
import PoetPlaceholder from "@/components/PoetPlaceholder";
import { isPlaceholderPoetImage } from "@/utils/poetImages";

const SOURCE_LABELS: Record<string, string> = {
  ganjoor: "گنجور",
  custom: "گنجورک",
  echolalia: "اکولالیا",
};

const persianNumber = new Intl.NumberFormat("fa-IR");

const PreferredPoetsPage = () => {
  const [, setDirectoryVersion] = useState(0);
  const { keys, remove } = usePreferredPoetKeys();
  const { setFeedMode } = useSettings();

  useEffect(() => {
    const unsubscribe = subscribePoetDirectory(() =>
      setDirectoryVersion((value) => value + 1),
    );
    void loadPoetDirectory();
    return unsubscribe;
  }, []);

  const poets = keys.map((key) => {
    const separator = key.indexOf(":");
    const source = separator > 0 ? key.slice(0, separator) : "ganjoor";
    const slug = key.slice(separator + 1);
    const poet = findDirectoryPoet(slug);
    return {
      key,
      slug,
      source,
      name: poet ? getDirectoryPoetDisplayName(poet) : slug,
      fullName: poet && poet.nickname && poet.nickname !== poet.name ? poet.name : null,
      imageUrl: poet?.imageUrl ?? null,
      href: `/${poet?.urlSlug ?? slug}`,
    };
  });

  return (
    <AppPage
      title="شاعران مورد علاقه"
      backHref="/poets"
      width="narrow"
      subtitle={
        keys.length > 0
          ? `${persianNumber.format(keys.length)} شاعر. حالت «علاقه‌مندی‌ها» در صفحهٔ اصلی از همین شاعران و کتاب‌هایی که دوست دارید شعر می‌آورد.`
          : "شاعرانی که به علاقه‌مندی‌ها می‌افزایید اینجا جمع می‌شوند و حالت «علاقه‌مندی‌ها» در صفحهٔ اصلی از آن‌ها شعر می‌آورد."
      }
      actions={
        keys.length > 0 ? (
          <Link
            href="/poets"
            className={buttonVariants({ variant: "ghost", size: "icon-lg", className: "app-page-bar-icon" })}
            aria-label="افزودن شاعر به علاقه‌مندی‌ها"
          >
            <FaUserPlus />
          </Link>
        ) : null
      }
    >
      {poets.length > 0 ? (
        <>
          <Link
            href="/"
            className={buttonVariants({ size: "lg", className: "preferred-read" })}
            onClick={() => setFeedMode("preferred")}
          >
            <FaBookOpen aria-hidden="true" />
            خواندن از علاقه‌مندی‌ها
          </Link>

          <section className="app-section">
            <h2 className="app-section-title">شاعران</h2>
            <ul className="app-list">
              {poets.map((poet) => (
                <li key={poet.key} className="preferred-item">
                  <Link href={poet.href} className="app-row preferred-link" prefetch={false}>
                    <span className="app-avatar" aria-hidden="true">
                      {!poet.imageUrl || isPlaceholderPoetImage(poet.imageUrl) ? (
                        <PoetPlaceholder seed={poet.key} />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={poet.imageUrl} alt="" loading="lazy" />
                      )}
                    </span>
                    <span className="app-row-body">
                      <span className="app-row-title">{poet.name}</span>
                      <span className="app-row-meta">
                        {[poet.fullName, SOURCE_LABELS[poet.source]].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <FaChevronLeft className="app-row-chevron" aria-hidden="true" />
                  </Link>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="preferred-remove"
                    onClick={() => remove(poet.key)}
                    aria-label={`حذف ${poet.name} از علاقه‌مندی‌ها`}
                  >
                    حذف
                  </Button>
                </li>
              ))}
            </ul>
          </section>

          <section className="app-section">
            <h2 className="app-section-title">بیشتر</h2>
            <ul className="app-list">
              <li>
                <Link href="/poets" className="app-row">
                  <span className="app-row-icon" aria-hidden="true"><FaUserPlus /></span>
                  <span className="app-row-body">
                    <span className="app-row-title">پیدا کردن شاعر تازه</span>
                    <span className="app-row-meta">فهرست همهٔ شاعران با جست‌وجو</span>
                  </span>
                  <FaChevronLeft className="app-row-chevron" aria-hidden="true" />
                </Link>
              </li>
              <li>
                <Link href="/?feed=1" className="app-row">
                  <span className="app-row-icon" aria-hidden="true"><FaSlidersH /></span>
                  <span className="app-row-body">
                    <span className="app-row-title">ویرایش گروهی</span>
                    <span className="app-row-meta">انتخاب چند شاعر یکجا در صفحهٔ اصلی</span>
                  </span>
                  <FaChevronLeft className="app-row-chevron" aria-hidden="true" />
                </Link>
              </li>
            </ul>
          </section>
        </>
      ) : (
        <Empty>
          <EmptyIcon>
            <FaRegStar />
          </EmptyIcon>
          <EmptyDescription>هنوز شاعری را به علاقه‌مندی‌ها نیفزوده‌اید. در فهرست شاعران یا صفحهٔ هر شاعر «علاقه‌مندم» را بزنید.</EmptyDescription>
          <Link href="/poets" className={buttonVariants({ size: "lg" })}>
            <FaUserPlus aria-hidden="true" />
            دیدن شاعران
          </Link>
        </Empty>
      )}
    </AppPage>
  );
};

export default PreferredPoetsPage;
