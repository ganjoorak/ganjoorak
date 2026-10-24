'use client';

import { FaEnvelope, FaTelegramPlane } from 'react-icons/fa';
import '../styles/FAQ.css';
import AppPage from '@/components/AppPage';
import AccordionItem from '@/components/AccordionItem';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const FAQ = () => {
    const faqs = [
        {
            question: 'گنجورک چیست؟',
            answer: (
                <>
                    گنجورک یک درگاه برای مطالعه و گوش دادن به اشعار فارسی است که به صورت تصادفی از گنجور انتخاب می‌شوند.
                    ممکن است درآینده منابع دیگری نیز به گنجورک اضافه شوند.
                </>
            )
        },
        {
            question: 'دلیل انتخاب نام گنجورک چیست؟',
            answer: 'گنجورک از ترکیب کلمه گنجور و پسوند تصغیر «ک» ساخته شده است. به این دلیل که اشعار به صورت تصادفی و در یک حالت  کوچک نمایش داده می‌شوند.'
        },
        {
            question: 'گنجورک به گنجور مرتبط است؟',
            answer: 'خیر، گنجورک یک پروژه مستقل است.'
        },
        {
            question: 'آیا همه اشعار گنجور در گنجورک موجود است؟',
            answer: 'بله، اشعار به صورت تصادفی از مجموعه کامل گنجور انتخاب می‌شوند.'
        },
        {
            question: 'مشکل، پیشنهاد و یا ایده‌ای دارید؟',
            answer: (
                <>
                    لطفاً از طریق ایمیل{' '}
                    <a href="mailto:contact@ganjoorak.ir" className="link">
                        contact@ganjoorak.ir
                    </a>{' '}
                    یا در <a href="https://t.me/hadi7546" target="_blank" rel="noopener noreferrer" className="link">
                        تلگرام
                    </a> در تماس باشید.
                </>
            )
        },
        {
            question: 'گنجورک توسط چه کسی توسعه داده شده است؟',
            answer: (
                <>
                    گنجورک توسط هادی آذرنسب در هفته‌‌های پایانی سال ۱۴۰۳ توسعه داده شده است. می‌توانید در این شبکه‌ها من را دنبال کنید:{' '}
                    <a href="https://t.me/hadi_7546" target="_blank" rel="noopener noreferrer" className="link">کانال تلگرام</a>،{' '}
                    <a href="https://twitter.com/hadi_7546" target="_blank" rel="noopener noreferrer" className="link">توییتر</a> و یا{' '}
                    <a href="https://hadi7546.ir" target="_blank" rel="noopener noreferrer" className="link">وبسایت</a>.
                </>
            )
        }
    ];

    return (
        <AppPage
            title="پرسش‌های متداول"
            subtitle="دربارهٔ گنجورک، منبع شعرها و راه تماس."
            width="narrow"
        >
            <ul className="app-list app-accordion-list">
                {faqs.map((faq, index) => (
                    <li key={index}>
                        <AccordionItem
                            title={faq.question}
                            defaultOpen={index === 0}
                            containerClassName="app-accordion"
                            questionClassName="app-accordion-q"
                            answerClassName="app-accordion-a"
                        >
                            {faq.answer}
                        </AccordionItem>
                    </li>
                ))}
            </ul>

            <Card className="faq-contact px-4">
                <h2>جواب‌تان را پیدا نکردید؟</h2>
                <p>مشکل، پیشنهاد یا ایده‌ای دارید، خوشحال می‌شوم بشنوم.</p>
                <div className="app-actions">
                    <a href="mailto:contact@ganjoorak.ir" className={buttonVariants({ className: 'faq-contact-btn' })}>
                        <FaEnvelope aria-hidden="true" />
                        ایمیل
                    </a>
                    <a
                        href="https://t.me/hadi7546"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonVariants({ variant: 'outline', className: 'faq-contact-btn' })}
                    >
                        <FaTelegramPlane aria-hidden="true" />
                        تلگرام
                    </a>
                </div>
            </Card>
        </AppPage>
    );
};

export default FAQ;
