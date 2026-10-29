import '@gravity-ui/uikit/styles/styles.css';
import './styles.css';

import React from 'react';
import {createRoot} from 'react-dom/client';
import {ThemeProvider, Toaster, ToasterComponent, ToasterProvider, configure} from '@gravity-ui/uikit';
import type {Theme} from '@gravity-ui/uikit';
import {configure as configureEditor} from '@gravity-ui/markdown-editor';
import {App} from './App';
import {SharedRoadmap} from './Roadmaps';
import logo from './assets/logo.png';

configure({lang: 'ru'});
configureEditor({lang: 'ru'});

const toaster = new Toaster();

// значок вкладки; картинка встраивается в итоговый HTML при сборке
const icon = document.createElement('link');
icon.rel = 'icon';
icon.type = 'image/png';
icon.href = logo;
document.head.appendChild(icon);

// установка на телефон как приложение: офлайн-кэш страницы (на localhost при разработке не нужен)
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

function hostTheme(): Theme {
    const t = document.documentElement.getAttribute('data-theme');
    return t === 'dark' || t === 'light' ? t : 'system';
}

// ссылка «посмотреть дорожную карту» открывается без входа
const sharedId = new URLSearchParams(window.location.search).get('roadmap');

function Root() {
    const [theme, setTheme] = React.useState<Theme>(hostTheme);
    React.useEffect(() => {
        const mo = new MutationObserver(() => setTheme(hostTheme()));
        mo.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
        return () => mo.disconnect();
    }, []);
    return (
        <ThemeProvider theme={theme}>
            <ToasterProvider toaster={toaster}>
                {sharedId ? <SharedRoadmap id={sharedId} /> : <App />}
                <ToasterComponent />
            </ToasterProvider>
        </ThemeProvider>
    );
}

createRoot(document.getElementById('root')!).render(<Root />);
