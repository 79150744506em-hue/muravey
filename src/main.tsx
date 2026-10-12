import '@gravity-ui/uikit/styles/styles.css';
import './styles.css';

import React from 'react';
import {createRoot} from 'react-dom/client';
import {ThemeProvider, configure} from '@gravity-ui/uikit';
import type {Theme} from '@gravity-ui/uikit';
import {App} from './App';

configure({lang: 'ru'});

function hostTheme(): Theme {
    const t = document.documentElement.getAttribute('data-theme');
    return t === 'dark' || t === 'light' ? t : 'system';
}

function Root() {
    const [theme, setTheme] = React.useState<Theme>(hostTheme);
    React.useEffect(() => {
        const mo = new MutationObserver(() => setTheme(hostTheme()));
        mo.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
        return () => mo.disconnect();
    }, []);
    return (
        <ThemeProvider theme={theme}>
            <App />
        </ThemeProvider>
    );
}

createRoot(document.getElementById('root')!).render(<Root />);
