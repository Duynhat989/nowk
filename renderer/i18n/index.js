import { createI18n } from 'vue-i18n';
import vi from './locales/vi.json';
import en from './locales/en.json';

export const LOCALE_OPTIONS = [
    { value: 'vi', label: 'Tiếng Việt' },
    { value: 'en', label: 'English' },
];

export function createAppI18n(locale = 'vi') {
    return createI18n({
        legacy: false,
        locale,
        fallbackLocale: 'vi',
        messages: { vi, en },
    });
}
