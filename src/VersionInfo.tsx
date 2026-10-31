const updatedAt = new Date(__APP_UPDATED_AT__);
const updateDate = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
}).format(updatedAt);

export function VersionInfo() {
    return (
        <footer className="mv-version">
            Версия {__APP_VERSION__} · обновлено <time dateTime={__APP_UPDATED_AT__}>{updateDate}</time>
        </footer>
    );
}
